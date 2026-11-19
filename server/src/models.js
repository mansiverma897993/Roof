import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const objectId = { type: Schema.Types.ObjectId, required: true };

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    timeZone: { type: String, default: 'Asia/Kolkata' },
    failedLogins: { type: Number, default: 0 },
    loginLockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
export const User = model('User', userSchema);

const sessionSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);
export const Session = model('Session', sessionSchema);

const productSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', index: true },
    name: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    model: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true },
    serialNumber: { type: String, default: '', trim: true },
    purchaseDate: { type: String, required: true },
    warrantyStartDate: { type: String, default: '' },
    warrantyMonths: { type: Number, default: null },
    warrantyEndDate: { type: String, default: '' },
    endDateSource: {
      type: String,
      enum: ['calculated', 'manual', 'incomplete'],
      default: 'incomplete',
    },
    terms: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);
productSchema.index({ userId: 1, name: 1 });
productSchema.index({ userId: 1, warrantyEndDate: 1 });
export const Product = model('Product', productSchema);

const receiptSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', index: true },
    productId: { ...objectId, ref: 'Product', index: true },
    gridFsFileId: { ...objectId },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    category: {
      type: String,
      enum: ['receipt', 'invoice', 'warranty_card', 'manual', 'service_record', 'other'],
      default: 'receipt',
    },
    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { timestamps: true },
);
receiptSchema.index({ userId: 1, productId: 1 });
export const Receipt = model('Receipt', receiptSchema);

const serviceCenterSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', index: true },
    productId: { ...objectId, ref: 'Product', index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);
serviceCenterSchema.index({ userId: 1, productId: 1 });
export const ServiceCenter = model('ServiceCenter', serviceCenterSchema);

const preferenceSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', unique: true },
    enabled: { type: Boolean, default: true },
    offsetsDays: { type: [Number], default: [30, 7, 1] },
  },
  { timestamps: true },
);
export const ReminderPreference = model('ReminderPreference', preferenceSchema);

const reminderSchema = new Schema(
  {
    userId: { ...objectId, ref: 'User', index: true },
    productId: { ...objectId, ref: 'Product', index: true },
    warrantyEndDate: { type: String, required: true },
    offsetDays: { type: Number, required: true },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sending', 'retry', 'sent', 'cancelled', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
reminderSchema.index({ productId: 1, warrantyEndDate: 1, offsetDays: 1 }, { unique: true });
reminderSchema.index({ status: 1, scheduledFor: 1 });
export const ReminderJob = model('ReminderJob', reminderSchema);
