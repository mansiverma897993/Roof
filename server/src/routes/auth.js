import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  Product,
  Receipt,
  ReminderJob,
  ReminderPreference,
  ServiceCenter,
  Session,
  User,
} from '../models.js';
import { asyncRoute, HttpError } from '../lib/http.js';
import { auth, createSession, replaceSession, removeSession } from '../lib/auth.js';
import { validTimeZone } from '../lib/dates.js';
import { deleteReceiptFile } from '../db.js';
import { config } from '../config.js';

const router = Router();
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => config.limits.authPer15Min,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
});
const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
// bcrypt ignores everything after 72 bytes, so longer passwords would be silently truncated.
const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .refine((v) => Buffer.byteLength(v) <= 72, 'Password must be 72 bytes or fewer.');
// Accounts created under the earlier 8-character rule must still be able to sign in.
const currentPassword = z.string().min(1).max(128);
// Compared against when no account matches, so unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('roof-timing-placeholder', 12);

const loginFailed = () =>
  new HttpError(
    401,
    `Incorrect email or password. After repeated failures, sign-in pauses for ${Math.round(config.limits.loginLockMs / 60000)} minutes.`,
  );

async function recordFailedLogin(userId) {
  const { failedLogins } = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { failedLogins: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (failedLogins >= config.limits.loginFailuresBeforeLock)
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          failedLogins: 0,
          loginLockedUntil: new Date(Date.now() + config.limits.loginLockMs),
        },
      },
    );
}

async function confirmPassword(userId, password) {
  const user = await User.findById(userId);
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new HttpError(401, 'Your current password is incorrect.');
  return user;
}

const publicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  timeZone: user.timeZone,
});

router.post(
  '/register',
  authLimit,
  asyncRoute(async (req, res) => {
    const data = z
      .object({
        email,
        password: newPassword,
        name: z.string().trim().min(2).max(80),
        timeZone: z.string().optional(),
      })
      .parse(req.body);
    if (data.timeZone && !validTimeZone(data.timeZone))
      throw new HttpError(400, 'Choose a valid time zone.');
    // Known limitation: this reveals that an email is registered. Hiding it needs email verification.
    if (await User.exists({ email: data.email }))
      throw new HttpError(409, 'An account with this email already exists.');
    const user = await User.create({
      name: data.name,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
      timeZone: data.timeZone || 'Asia/Kolkata',
    });
    await replaceSession(req, res, user._id);
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  '/login',
  authLimit,
  asyncRoute(async (req, res) => {
    const data = z.object({ email, password: currentPassword }).parse(req.body);
    const user = await User.findOne({ email: data.email });
    const locked = user?.loginLockedUntil > new Date();
    const matches = await bcrypt.compare(data.password, user?.passwordHash || DUMMY_HASH);
    // One response for unknown, locked and wrong-password cases, so none can be told apart.
    if (!user || locked || !matches) {
      if (user && !locked) await recordFailedLogin(user._id);
      throw loginFailed();
    }
    if (user.failedLogins || user.loginLockedUntil)
      await User.updateOne(
        { _id: user._id },
        { $set: { failedLogins: 0, loginLockedUntil: null } },
      );
    await replaceSession(req, res, user._id);
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await removeSession(req, res);
    res.status(204).end();
  }),
);

router.get('/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post(
  '/password',
  authLimit,
  auth,
  asyncRoute(async (req, res) => {
    const data = z.object({ currentPassword, newPassword }).parse(req.body);
    const user = await confirmPassword(req.user._id, data.currentPassword);
    user.passwordHash = await bcrypt.hash(data.newPassword, 12);
    await user.save();
    // Signs out every other device; this browser gets a fresh session.
    await Session.deleteMany({ userId: user._id });
    await createSession(res, user._id);
    res.status(204).end();
  }),
);

router.delete(
  '/me',
  authLimit,
  auth,
  asyncRoute(async (req, res) => {
    const { password } = z.object({ password: currentPassword }).parse(req.body);
    const user = await confirmPassword(req.user._id, password);
    const owned = { userId: user._id };
    const documents = await Receipt.find(owned).select('gridFsFileId').lean();
    for (const document of documents) await deleteReceiptFile(document.gridFsFileId);
    await Promise.all([
      Receipt.deleteMany(owned),
      ServiceCenter.deleteMany(owned),
      ReminderJob.deleteMany(owned),
      ReminderPreference.deleteMany(owned),
      Product.deleteMany(owned),
    ]);
    await Session.deleteMany(owned);
    // The account goes last, so a failure part-way leaves it in place to retry.
    await user.deleteOne();
    await removeSession(req, res);
    res.status(204).end();
  }),
);

export default router;
