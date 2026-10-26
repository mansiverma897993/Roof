import { Router } from 'express';
import { z } from 'zod';
import { ReminderJob, ReminderPreference } from '../models.js';
import { asyncRoute, publicRecord } from '../lib/http.js';
import { getPreferences, syncJobsForUser } from '../lib/reminders.js';
import { config } from '../config.js';

const router = Router();
const input = z.object({
  enabled: z.boolean(),
  offsetsDays: z
    .array(z.number().int().min(0).max(365))
    .min(1)
    .max(5)
    .refine((values) => new Set(values).size === values.length, 'Choose distinct reminder days.'),
});

router.get(
  '/reminder-preferences',
  asyncRoute(async (req, res) => {
    const preferences = await getPreferences(req.user._id);
    res.json({
      preferences: { enabled: preferences.enabled, offsetsDays: preferences.offsetsDays },
      emailConfigured: Boolean(config.smtp.host),
      emailPreviewUrl: config.smtp.previewUrl || null,
    });
  }),
);

router.put(
  '/reminder-preferences',
  asyncRoute(async (req, res) => {
    const data = input.parse(req.body);
    const preferences = await ReminderPreference.findOneAndUpdate(
      { userId: req.user._id },
      { ...data, userId: req.user._id },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    await syncJobsForUser(req.user, preferences);
    res.json({
      preferences: { enabled: preferences.enabled, offsetsDays: preferences.offsetsDays },
    });
  }),
);

router.get(
  '/reminders/history',
  asyncRoute(async (req, res) => {
    const jobs = await ReminderJob.find({ userId: req.user._id, status: { $ne: 'cancelled' } })
      .sort({ scheduledFor: -1 })
      .limit(50)
      .populate('productId', 'name brand')
      .lean();
    res.json({ jobs: jobs.map(publicRecord) });
  }),
);

export default router;
