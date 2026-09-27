import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.logLevel,
  base: { svc: 'erss' },
  // Pretty output in dev is worth the dependency-free transport cost; in production
  // structured JSON goes to pm2's log file where it can be grepped and parsed.
  transport: env.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    // A password or token must never reach a log line, including inside an error.
    paths: [
      'password', '*.password', 'req.body.password', 'req.headers.cookie',
      'emiratesId', '*.emiratesId', 'apiKey', '*.apiKey', 'sessionSecret',
    ],
    censor: '[redacted]',
  },
});
