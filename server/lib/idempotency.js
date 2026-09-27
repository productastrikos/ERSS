/**
 * Idempotency-Key replay. docs/04 §1.
 *
 * A retried request with the same key gets the first response back instead of a second
 * execution — so a dispatcher double-clicking DISPATCH on a hotel network, or a phone
 * retrying "acknowledge" after a dropped response, does not act twice.
 *
 * Responses below 500 are remembered for 24 h, per user. A 5xx is not: a server failure
 * should be retryable. Two truly simultaneous first attempts can both execute; the row
 * locks in the services turn the second into a 409 rather than a double dispatch.
 */

import { query } from './db.js';
import { logger } from './logger.js';
import { conflict, validation } from './errors.js';

export function idempotent(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || !req.user) return next();
  if (key.length > 200) return next(validation({ 'Idempotency-Key': ['At most 200 characters'] }));

  (async () => {
    const { rows } = await query(
      `SELECT method, path, status, body FROM idempotency_keys
        WHERE user_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'`,
      [req.user.id, key],
    );
    const seen = rows[0];
    if (seen) {
      if (seen.method !== req.method || seen.path !== req.originalUrl) {
        return next(conflict('This Idempotency-Key was already used for a different request'));
      }
      res.set('Idempotent-Replayed', 'true');
      return res.status(seen.status).json(seen.body);
    }

    const send = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500) {
        query(
          `INSERT INTO idempotency_keys (user_id, key, method, path, status, body)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, key) DO NOTHING`,
          [req.user.id, key, req.method, req.originalUrl, res.statusCode, body],
        ).catch((err) => logger.warn({ err: err.message }, '[idempotency] could not record response'));
      }
      return send(body);
    };
    next();
  })().catch(next);
}

/** Housekeeping — keys are only honoured for 24 h, so older rows are dead weight. */
export function startIdempotencyCleanup() {
  const t = setInterval(() => {
    query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`)
      .catch((err) => logger.warn({ err: err.message }, '[idempotency] cleanup failed'));
  }, 3_600_000);
  t.unref();
}
