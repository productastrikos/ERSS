/**
 * /api/assistant — the rules-first, LLM-second seam. docs/08 §5.
 */

import { Router } from 'express';
import { z } from 'zod';
import { wrap, validation } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { ask } from '../lib/llm.js';

const router = Router();

router.post('/assistant/ask', requireAuth, wrap(async (req, res) => {
  const r = z.object({ question: z.string().trim().min(1).max(500), context: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body);
  if (!r.success) throw validation(r.error.flatten().fieldErrors);
  res.json(await ask(r.data.question, r.data.context));
}));

export default router;
