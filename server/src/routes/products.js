import { Router } from 'express';
import { z } from 'zod';
import { Product, Receipt, ServiceCenter, ReminderJob } from '../models.js';
import { asyncRoute, escapeRegex, HttpError, objectId, publicRecord } from '../lib/http.js';
import { calculateEndDate, statusFor, todayIn, validDate } from '../lib/dates.js';
import { syncJobsForProduct } from '../lib/reminders.js';
import { deleteReceiptFile } from '../db.js';
import { config } from '../config.js';

const router = Router();
const input = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().min(2).max(100),
  model: z.string().trim().max(100).default(''),
  category: z.string().trim().max(80).default(''),
  serialNumber: z.string().trim().max(120).default(''),
  purchaseDate: z.string(),
  warrantyStartDate: z.string().default(''),
  warrantyMonths: z.number().int().min(1).max(120).nullable().default(null),
  manualEndDate: z.string().default(''),
  terms: z.string().trim().max(2000).default(''),
  notes: z.string().trim().max(2000).default(''),
});

function normalized(body) {
  const data = input.parse(body);
  if (!validDate(data.purchaseDate)) throw new HttpError(400, 'Enter a valid purchase date.');
  const start = data.warrantyStartDate || data.purchaseDate;
  if (!validDate(start)) throw new HttpError(400, 'Enter a valid warranty start date.');
  if (data.manualEndDate && !validDate(data.manualEndDate))
    throw new HttpError(400, 'Enter a valid warranty end date.');
  if (data.manualEndDate && data.manualEndDate < start)
    throw new HttpError(400, 'Warranty end date cannot be before its start date.');
  const warrantyEndDate =
    data.manualEndDate || (data.warrantyMonths ? calculateEndDate(start, data.warrantyMonths) : '');
  const endDateSource = data.manualEndDate
    ? 'manual'
    : data.warrantyMonths
      ? 'calculated'
      : 'incomplete';
  const { manualEndDate, ...safeData } = data;
  return { ...safeData, warrantyStartDate: start, warrantyEndDate, endDateSource };
}

function toResponse(product, today) {
  const p = product.toObject ? product.toObject() : product;
  return { ...publicRecord(p), status: statusFor(p, today) };
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const search = String(req.query.search || '')
      .trim()
      .slice(0, 100);
    const status = String(req.query.status || 'all');
    if (!['all', 'active', 'expiring', 'expired', 'incomplete'].includes(status))
      throw new HttpError(400, 'Invalid status filter.');
    const query = { userId: req.user._id };
    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { brand: { $regex: safe, $options: 'i' } },
        { model: { $regex: safe, $options: 'i' } },
      ];
    }
    const today = todayIn(req.user.timeZone);
    const products = (await Product.find(query).sort({ createdAt: -1 }).lean()).map((p) =>
      toResponse(p, today),
    );
    res.json({
      products: status === 'all' ? products : products.filter((p) => p.status === status),
    });
  }),
);

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const data = normalized(req.body);
    if ((await Product.countDocuments({ userId: req.user._id })) >= config.limits.maxProducts)
      throw new HttpError(403, `You can track up to ${config.limits.maxProducts} products.`);
    const product = await Product.create({ ...data, userId: req.user._id });
    await syncJobsForProduct(product, req.user);
    res.status(201).json({ product: toResponse(product, todayIn(req.user.timeZone)) });
  }),
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const product = await Product.findOne({
      _id: objectId(req.params.id),
      userId: req.user._id,
    }).lean();
    if (!product) throw new HttpError(404, 'Product not found.');
    res.json({ product: toResponse(product, todayIn(req.user.timeZone)) });
  }),
);

router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const product = await Product.findOne({ _id: objectId(req.params.id), userId: req.user._id });
    if (!product) throw new HttpError(404, 'Product not found.');
    Object.assign(product, normalized(req.body));
    await product.save();
    await syncJobsForProduct(product, req.user);
    res.json({ product: toResponse(product, todayIn(req.user.timeZone)) });
  }),
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const product = await Product.findOne({ _id: objectId(req.params.id), userId: req.user._id });
    if (!product) throw new HttpError(404, 'Product not found.');
    const receipts = await Receipt.find({ productId: product._id, userId: req.user._id });
    for (const receipt of receipts) {
      await deleteReceiptFile(receipt.gridFsFileId);
      await receipt.deleteOne();
    }
    await ServiceCenter.deleteMany({ productId: product._id, userId: req.user._id });
    await ReminderJob.deleteMany({ productId: product._id, userId: req.user._id });
    await product.deleteOne();
    res.status(204).end();
  }),
);

export default router;
