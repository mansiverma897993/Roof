import crypto from 'node:crypto';
import { Session, User } from '../models.js';
import { config } from '../config.js';
import { HttpError } from './http.js';

const COOKIE = 'roof_sid';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await Session.create({
    userId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + WEEK),
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    maxAge: WEEK,
    path: '/',
  });
}

export async function replaceSession(req, res, userId) {
  const previousToken = req.cookies?.[COOKIE];
  if (previousToken) await Session.deleteOne({ tokenHash: tokenHash(previousToken) });
  await createSession(res, userId);
}

export async function removeSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await Session.deleteOne({ tokenHash: tokenHash(token) });
  res.clearCookie(COOKIE, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  });
}

export async function auth(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Please sign in to continue.');
    const session = await Session.findOne({
      tokenHash: tokenHash(token),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    const user = await User.findById(session.userId).select('name email timeZone').lean();
    if (!user) throw new HttpError(401, 'Your account is unavailable.');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  // Browsers send both headers on cross-site writes; non-browser clients carry no victim cookie.
  const site = req.get('sec-fetch-site');
  if ((origin && origin !== config.appOrigin) || (site && site !== 'same-origin'))
    return next(new HttpError(403, 'Request origin is not allowed.'));
  next();
}
