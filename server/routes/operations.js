/**
 * Operations reads that are not a single resource: today's KPI strip and the hospital
 * destination recommendation. docs/04 §3, §5, and docs/06 §2.4.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAnyCap } from '../lib/auth.js';
import { actorFrom } from '../services/actor.js';
import { kpisToday } from '../services/kpi.js';
import { hospitalRecommendation } from '../services/dispatch.js';

const router = Router();

router.get('/kpi/today', requireAnyCap('operations.view', 'executive.view'), wrap(async (req, res) => {
  res.json(await kpisToday(actorFrom(req.user)));
}));

router.get('/hospitals/recommend', requireAnyCap('operations.view', 'clinical.view'), wrap(async (req, res) => {
  const q = z.object({ incident: z.string().min(4).max(24) }).safeParse(req.query);
  if (!q.success) throw validation(q.error.flatten().fieldErrors);
  res.json(await hospitalRecommendation(q.data.incident, actorFrom(req.user)));
}));

export default router;
