import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { auth, sameOrigin } from './lib/auth.js';
import { errorHandler } from './lib/http.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import dashboardRoutes from './routes/dashboard.js';
import receiptRoutes from './routes/receipts.js';
import contactRoutes from './routes/contacts.js';
import reminderRoutes from './routes/reminders.js';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: () => config.limits.apiPer15Min,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again in a few minutes.' },
    }),
  );
  app.use('/api', sameOrigin);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/products', auth, productRoutes);
  app.use('/api/dashboard', auth, dashboardRoutes);
  app.use('/api', auth, receiptRoutes);
  app.use('/api', auth, contactRoutes);
  app.use('/api', auth, reminderRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../client/dist',
  );
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
