import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/roof',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Roof <no-reply@example.com>',
  },
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS || 60000),
  // Number of reverse proxies in front of Express; client IPs for rate limits depend on it.
  trustProxy: Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : 0)),
  limits: {
    maxProducts: 500,
    maxDocuments: 1000,
    maxStorageBytes: 500 * 1024 * 1024,
    maxContactsPerProduct: 20,
    uploadsPer15Min: 30,
    apiPer15Min: 600,
    authPer15Min: 20,
    loginFailuresBeforeLock: 5,
    loginLockMs: 15 * 60 * 1000,
  },
};
