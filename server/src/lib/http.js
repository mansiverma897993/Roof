import mongoose from 'mongoose';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function objectId(value) {
  if (!mongoose.isValidObjectId(value)) throw new HttpError(400, 'Invalid record ID.');
  return value;
}

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Strips owner and storage internals before a record is sent to the browser.
export function publicRecord(record) {
  const { userId, __v, gridFsFileId, lockedUntil, ...rest } = record;
  return { ...rest, id: String(record._id) };
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Please correct the highlighted information.',
      details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (error?.code === 11000) return res.status(409).json({ error: 'This record already exists.' });
  if (error?.name === 'MulterError')
    return res.status(400).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'The document must be 10 MB or smaller.'
          : 'Upload failed.',
    });
  if (error?.name === 'CastError') return res.status(400).json({ error: 'Invalid record ID.' });
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res
    .status(status)
    .json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message });
}
