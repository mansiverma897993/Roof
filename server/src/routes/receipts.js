import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Product, Receipt } from '../models.js';
import { deleteReceiptFile, receiptBucket, receiptFileExists } from '../db.js';
import { asyncRoute, escapeRegex, HttpError, objectId, publicRecord } from '../lib/http.js';
import { config } from '../config.js';

const router = Router();
const categories = new Set([
  'receipt',
  'invoice',
  'warranty_card',
  'manual',
  'service_record',
  'other',
]);

function fileType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

const invalidType = () => new HttpError(400, 'Upload a PDF, PNG or JPEG document.');

// Streams uploads straight into GridFS, checking the file signature from the first bytes,
// so memory per upload stays at one chunk instead of the whole file.
const gridFsStorage = {
  _handleFile(_req, file, cb) {
    const bucket = receiptBucket();
    const safeName = file.originalname.replace(/[\r\n\\/]/g, '_').slice(0, 180) || 'document';
    const target = bucket.openUploadStream(safeName);
    let head = Buffer.alloc(0);
    let contentType = null;
    let size = 0;
    const check = new Transform({
      transform(chunk, _encoding, next) {
        size += chunk.length;
        if (contentType) return next(null, chunk);
        head = Buffer.concat([head, chunk]);
        if (head.length < 8) return next();
        contentType = fileType(head);
        return contentType ? next(null, head) : next(invalidType());
      },
      flush(next) {
        if (contentType) return next();
        contentType = fileType(head);
        return contentType ? next(null, head) : next(invalidType());
      },
    });
    pipeline(file.stream, check, target).then(
      () => cb(null, { id: target.id, size, contentType, safeName }),
      async (error) => {
        await bucket.delete(target.id).catch(() => {});
        cb(error);
      },
    );
  },
  _removeFile(_req, file, cb) {
    receiptBucket()
      .delete(file.id)
      .then(
        () => cb(),
        () => cb(),
      );
  },
};
const upload = multer({
  storage: gridFsStorage,
  defParamCharset: 'utf8',
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
const uploadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => config.limits.uploadsPer15Min,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please try again in a few minutes.' },
});

function metadata(body = {}) {
  const category = body.category || 'receipt';
  if (!categories.has(category)) throw new HttpError(400, 'Choose a valid document type.');
  const note = body.note || '';
  if (typeof note !== 'string' || note.length > 300)
    throw new HttpError(400, 'Document note must be 300 characters or fewer.');
  return { category, note: note.trim() };
}

function serialize(document, productName) {
  const result = {
    ...publicRecord(document),
    category: document.category || 'receipt',
    note: document.note || '',
  };
  if (productName !== undefined) result.productName = productName;
  return result;
}

async function ownedProduct(req, id) {
  const product = await Product.findOne({ _id: objectId(id), userId: req.user._id }).lean();
  if (!product) throw new HttpError(404, 'Product not found.');
  return product;
}

async function ownedDocument(req, id) {
  const document = await Receipt.findOne({ _id: objectId(id), userId: req.user._id });
  if (!document) throw new HttpError(404, 'Document not found.');
  await ownedProduct(req, document.productId);
  return document;
}

// Runs before multer reads any bytes, so strangers and full accounts cannot push data.
const uploadAllowed = asyncRoute(async (req, _res, next) => {
  await ownedProduct(req, req.params.productId);
  const [count, [usage]] = await Promise.all([
    Receipt.countDocuments({ userId: req.user._id }),
    Receipt.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: null, bytes: { $sum: '$size' } } },
    ]),
  ]);
  if (count >= config.limits.maxDocuments)
    throw new HttpError(403, `You can store up to ${config.limits.maxDocuments} documents.`);
  if ((usage?.bytes || 0) >= config.limits.maxStorageBytes)
    throw new HttpError(403, 'Your document storage is full. Delete documents to upload more.');
  next();
});

router.get(
  '/documents',
  asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    if (search.length > 100) throw new HttpError(400, 'Search must be 100 characters or fewer.');
    if (category !== 'all' && !categories.has(category))
      throw new HttpError(400, 'Choose a valid document type.');

    const conditions = [{ userId: req.user._id }];
    // Documents saved before categories existed count as receipts.
    if (category === 'receipt')
      conditions.push({ $or: [{ category: 'receipt' }, { category: { $exists: false } }] });
    else if (category !== 'all') conditions.push({ category });
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: 'i' };
      const matchingProducts = await Product.distinct('_id', {
        userId: req.user._id,
        name: pattern,
      });
      conditions.push({
        $or: [
          { originalName: pattern },
          { note: pattern },
          { productId: { $in: matchingProducts } },
        ],
      });
    }
    const documents = await Receipt.find({ $and: conditions }).sort({ createdAt: -1 }).lean();
    const products = await Product.find({
      userId: req.user._id,
      _id: { $in: documents.map((document) => document.productId) },
    })
      .select('name')
      .lean();
    const names = new Map(products.map((product) => [String(product._id), product.name]));
    const results = documents
      .filter((document) => names.has(String(document.productId)))
      .map((document) => serialize(document, names.get(String(document.productId))));
    res.json({ documents: results });
  }),
);

router.get(
  '/products/:productId/documents',
  asyncRoute(async (req, res) => {
    await ownedProduct(req, req.params.productId);
    const documents = await Receipt.find({ productId: req.params.productId, userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ documents: documents.map((document) => serialize(document)) });
  }),
);

router.post(
  '/products/:productId/documents',
  uploadLimit,
  uploadAllowed,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a document file.');
    try {
      const { category, note } = metadata(req.body);
      const document = await Receipt.create({
        userId: req.user._id,
        productId: req.params.productId,
        gridFsFileId: req.file.id,
        originalName: req.file.safeName,
        mimeType: req.file.contentType,
        size: req.file.size,
        category,
        note,
      });
      res.status(201).json({ document: serialize(document.toObject()) });
    } catch (error) {
      await receiptBucket()
        .delete(req.file.id)
        .catch(() => {});
      throw error;
    }
  }),
);

router.patch(
  '/documents/:id',
  asyncRoute(async (req, res) => {
    const document = await ownedDocument(req, req.params.id);
    const { category, note } = metadata(req.body);
    document.category = category;
    document.note = note;
    await document.save();
    res.json({ document: serialize(document.toObject()) });
  }),
);

router.get(
  '/documents/:id/file',
  asyncRoute(async (req, res) => {
    const document = await ownedDocument(req, req.params.id);
    if (!(await receiptFileExists(document.gridFsFileId)))
      throw new HttpError(404, 'Document file is unavailable.');
    // Header values must be ASCII; non-Latin names go in the RFC 5987 filename* parameter.
    const asciiName = document.originalName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encodedName = encodeURIComponent(document.originalName).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', document.size);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = receiptBucket().openDownloadStream(document.gridFsFileId);
    stream.on('error', (error) => {
      if (!res.headersSent) res.status(404).json({ error: 'Document file is unavailable.' });
      else res.destroy(error);
    });
    stream.pipe(res);
  }),
);

router.delete(
  '/documents/:id',
  asyncRoute(async (req, res) => {
    const document = await ownedDocument(req, req.params.id);
    await deleteReceiptFile(document.gridFsFileId);
    await document.deleteOne();
    res.status(204).end();
  }),
);

export default router;
