/**
 * The in-process event bus.
 *
 * realtime/fanout.js publishes here at the same moment it publishes to sockets, so server
 * features that react to what happened — the alert watcher, the live feed, the simulator —
 * listen to one place instead of each service calling each other. Listeners must never
 * throw into the publisher: a failed alert cannot be allowed to fail a dispatch.
 */

import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

class Bus extends EventEmitter {
  publish(event, payload) {
    for (const listener of this.listeners(event)) {
      try {
        const out = listener(payload);
        if (out && typeof out.catch === 'function') {
          out.catch((err) => logger.warn({ err: err.message, event }, '[bus] async listener failed'));
        }
      } catch (err) {
        logger.warn({ err: err.message, event }, '[bus] listener failed');
      }
    }
  }
}

export const bus = new Bus();
bus.setMaxListeners(50);
