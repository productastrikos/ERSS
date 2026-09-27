/**
 * Typed errors with real HTTP statuses and machine-readable codes.
 *
 * Shape on the wire: { error: { code, message, detail? } }
 * The code is for the client to branch on; the message is for a human.
 */

export class AppError extends Error {
  constructor(code, status, message, detail = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}) } };
  }
}

export const unauthorised = (m = 'Sign in required') => new AppError('unauthorised', 401, m);
export const forbidden    = (m = 'Not permitted') => new AppError('forbidden', 403, m);
export const notFound     = (what = 'Resource') => new AppError('not_found', 404, `${what} not found`);
export const conflict     = (m, detail) => new AppError('conflict', 409, m, detail);
export const validation   = (detail) => new AppError('validation_failed', 422, 'Request did not validate', detail);
export const engineFailed = (engine, m) => new AppError('engine_failed', 500, `Engine ${engine} failed: ${m}`);
export const dbUnavailable = (target, detail) =>
  new AppError('db_unavailable', 503, `Database unavailable at ${target}`, detail);

/**
 * Express error handler. A database outage returns 503 with the target, not an opaque
 * 500 — the DSO FastAPI got this right and it is worth preserving: an outage must be
 * distinguishable from an application bug at a glance.
 */
export function errorHandler(logger) {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, path: req.path }, err.code);
      else logger.warn({ code: err.code, path: req.path }, err.message);
      return res.status(err.status).json(err.toJSON());
    }

    // Database-level failures: connection, authentication and missing-object errors are
    // all "the database is not usable", not "the application has a bug". They must be
    // 503 with the target named, so a misconfiguration is self-diagnosing — the DSO
    // FastAPI got this right and it is worth preserving.
    const pgConnCodes = new Set([
      'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
      '57P01', '57P03',           // admin shutdown / cannot connect now
      '08006', '08001', '08003',  // connection failure
      '28000', '28P01',           // invalid authorisation / bad password
      '3D000',                    // database does not exist
      '42P01',                    // undefined table — schema not applied yet
    ]);
    const isPgAuthText = typeof err.message === 'string'
      && /SASL|SCRAM|password must be a string|no pg_hba\.conf entry/i.test(err.message);

    if (pgConnCodes.has(err.code) || isPgAuthText) {
      logger.error({ err, path: req.path, pgCode: err.code }, 'database unavailable');
      const hint = err.code === '42P01'
        ? 'The schema has not been applied. Run: npm run db:schema && npm run db:views && npm run seed'
        : err.code === '3D000'
          ? 'The database does not exist. Run: ops/scripts/setup-db.ps1'
          : 'Check PostgreSQL is running and server/.env is correct — see docs/12-DEPLOYMENT.md §3';
      return res.status(503).json({
        error: {
          code: 'db_unavailable',
          message: 'Database unavailable',
          detail: String(err.message ?? '').trim(),
          hint,
        },
      });
    }

    logger.error({ err, path: req.path }, 'unhandled error');
    res.status(500).json({
      error: {
        code: 'internal',
        message: 'Something went wrong',
        // The stack is useful in development and is a disclosure risk in production.
        ...(process.env.NODE_ENV === 'production' ? {} : { detail: err.message, stack: err.stack?.split('\n').slice(0, 5) }),
      },
    });
  };
}

/** Wrap an async route so a rejected promise reaches the error handler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
