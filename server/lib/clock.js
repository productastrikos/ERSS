/**
 * The injected clock.
 *
 * NOTHING else in this codebase calls Date.now() or `new Date()` for a domain
 * timestamp. This is the rule that makes scenario replay, seek and speed control
 * possible at all — and retrofitting it later is very expensive, which is why it exists
 * from the first commit (docs/02-ARCHITECTURE §6 rule 4).
 *
 * When no scenario is running the clock is real time and this is a thin wrapper.
 * When a scenario run is active the clock is that run's clock: offset from real time,
 * scalable, seekable, pausable.
 */

import { EventEmitter } from 'node:events';

class Clock extends EventEmitter {
  #runRef = null;
  #state = 'idle';           // idle | running | paused
  #speed = 1;
  /** Real-time ms at which the current segment began. */
  #anchorReal = 0;
  /** Scenario ms at that anchor. */
  #anchorScenario = 0;
  /** Wall-clock instant the scenario represents (its t=0 in real-world terms). */
  #epoch = 0;

  /** Milliseconds since the Unix epoch, as the domain should see them. */
  now() {
    if (this.#state === 'idle') return Date.now();
    return this.#epoch + this.cursorMs();
  }

  /** A Date for the current domain instant. */
  date() {
    return new Date(this.now());
  }

  /** ISO string — what goes into the database and over the wire. */
  iso() {
    return this.date().toISOString();
  }

  /** Milliseconds elapsed within the running scenario. */
  cursorMs() {
    if (this.#state === 'idle') return 0;
    if (this.#state === 'paused') return this.#anchorScenario;
    return this.#anchorScenario + (Date.now() - this.#anchorReal) * this.#speed;
  }

  cursorSec() {
    return Math.floor(this.cursorMs() / 1000);
  }

  get state() { return this.#state; }
  get speed() { return this.#speed; }
  get runRef() { return this.#runRef; }
  get isScenario() { return this.#state !== 'idle'; }

  /**
   * Begin a scenario clock.
   * @param {string} runRef
   * @param {object} [opts]
   * @param {number} [opts.epoch]  wall-clock ms the scenario's t=0 represents (default: now)
   * @param {number} [opts.speed]
   * @param {number} [opts.startSec]
   */
  start(runRef, { epoch = Date.now(), speed = 1, startSec = 0 } = {}) {
    this.#runRef = runRef;
    this.#epoch = epoch;
    this.#speed = speed;
    this.#anchorScenario = startSec * 1000;
    this.#anchorReal = Date.now();
    this.#state = 'running';
    this.#emit();
    return this.snapshot();
  }

  pause() {
    if (this.#state !== 'running') return this.snapshot();
    this.#anchorScenario = this.cursorMs();
    this.#anchorReal = Date.now();
    this.#state = 'paused';
    this.#emit();
    return this.snapshot();
  }

  resume() {
    if (this.#state !== 'paused') return this.snapshot();
    this.#anchorReal = Date.now();
    this.#state = 'running';
    this.#emit();
    return this.snapshot();
  }

  /** Jump to a point in the scenario. Preserves running/paused state. */
  seek(toSec) {
    if (this.#state === 'idle') return this.snapshot();
    this.#anchorScenario = Math.max(0, toSec) * 1000;
    this.#anchorReal = Date.now();
    this.#emit();
    return this.snapshot();
  }

  setSpeed(speed) {
    if (this.#state === 'idle') return this.snapshot();
    // Re-anchor first, or the speed change would retroactively rewrite elapsed time.
    this.#anchorScenario = this.cursorMs();
    this.#anchorReal = Date.now();
    this.#speed = speed;
    this.#emit();
    return this.snapshot();
  }

  stop() {
    this.#state = 'idle';
    this.#runRef = null;
    this.#speed = 1;
    this.#anchorScenario = 0;
    this.#anchorReal = 0;
    this.#epoch = 0;
    this.#emit();
    return this.snapshot();
  }

  snapshot() {
    return {
      runRef: this.#runRef,
      state: this.#state,
      speed: this.#speed,
      cursorSec: this.cursorSec(),
      now: this.iso(),
      isScenario: this.isScenario,
    };
  }

  #emit() {
    this.emit('change', this.snapshot());
  }
}

export const clock = new Clock();

/** Convenience: the current domain instant as an ISO string. */
export const nowIso = () => clock.iso();
/** Convenience: the current domain instant as ms. */
export const nowMs = () => clock.now();
