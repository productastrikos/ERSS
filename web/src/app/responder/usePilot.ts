/**
 * The demo pilot — auto-run as a person would do it. A finger moves to the real control,
 * scrolls a list when the control is off-screen, pauses to read, and taps: the tap is an
 * actual click on the button a crew member would press, so everything downstream (the
 * server, the console, the citizen's tracking screen) sees an ordinary crew.
 *
 * Controls are found by `data-demo="…"`; nothing here knows how a screen is built.
 *
 * The finger MOVES like one. It never pops into existence on a button: it stays where it
 * last lifted (faded out), glides from there to the next control on an ease-out curve paced
 * by the distance — a short hop is quick, a cross-screen reach takes longer — then settles,
 * presses (a soft squash and a ripple) and lifts.
 *
 * And it goes at a pace a ROOM can follow. Each tap is a sentence: the caption says what the
 * AI suggests, the finger travels, the button it is about to press lights up, a beat, the
 * press, a beat. `setPace` stretches every one of those — 'slow' (the default) is for an
 * audience reading along; 'normal' is a crew's own speed.
 */

import { useMemo, useRef, useState } from 'react';

export interface Finger {
  x: number;
  y: number;
  shown: boolean;
  down: boolean;
  drag: boolean;
  ripple: number;
  caption: string | null;
  /** How long this move takes — pilot.scss reads it as the transition duration. */
  moveMs: number;
}

const HIDDEN: Finger = { x: 0, y: 0, shown: false, down: false, drag: false, ripple: 0, caption: null, moveMs: 0 };

/** Travel time at normal pace: a base, plus a little per pixel, within bounds — a finger is
 *  quick over a short hop and unhurried across the screen. */
const travelMs = (px: number) => Math.min(780, Math.max(340, 260 + px * 1.1));
const DRAG_MS = 700;

export type PilotPace = 'slow' | 'normal';
/** How much longer everything takes at each pace. */
const PACE: Record<PilotPace, number> = { slow: 1.9, normal: 1 };
/** The target the finger is about to press is outlined, so the room sees it before the tap. */
const TARGET_CLASS = 'is-pilot-target';

export interface Pilot {
  /** Off: any tap in flight is dropped, and nothing more is done until it is on again. */
  setActive: (on: boolean) => void;
  setPace: (pace: PilotPace) => void;
  tap: (name: string, caption?: string) => Promise<boolean>;
  look: (name: string, caption: string, ms: number) => Promise<boolean>;
  toTop: (name: string) => Promise<void>;
  say: (caption: string | null) => void;
  hide: () => void;
  exists: (name: string) => boolean;
  label: (name: string) => string | null;
  sleep: (ms: number) => Promise<void>;
}

const find = (name: string) => document.querySelector<HTMLElement>(`[data-demo="${name}"]`);

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 2) return p;
  }
  return null;
}

export function usePilot() {
  const [finger, setFinger] = useState<Finger>(HIDDEN);
  const layer = useRef<HTMLDivElement>(null);
  /** Where the finger is (or last lifted), so the next move starts from there. */
  const at = useRef<{ x: number; y: number } | null>(null);
  /** False the moment auto-run is switched off: a tap in flight is not delivered. */
  const alive = useRef(false);
  const pace = useRef<number>(PACE.slow);

  const pilot = useMemo<Pilot>(() => {
    /** Every wait the pilot makes is stretched by the pace. */
    const sleep = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms * pace.current); });
    const origin = () => layer.current?.getBoundingClientRect() ?? new DOMRect();
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const o = origin();
      return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
    };

    async function moveTo(x: number, y: number, caption?: string) {
      // The first appearance rises from where a thumb rests: the bottom middle of the screen.
      if (!at.current) {
        const o = origin();
        at.current = { x: o.width / 2, y: o.height - 90 };
        setFinger((f) => ({ ...f, x: at.current!.x, y: at.current!.y, moveMs: 0 }));
        await sleep(30);
      }
      const ms = travelMs(Math.hypot(x - at.current.x, y - at.current.y));
      at.current = { x, y };
      setFinger((f) => ({ ...f, shown: true, x, y, moveMs: Math.round(ms * pace.current), caption: caption ?? f.caption }));
      await sleep(ms + 60);
    }

    /** A swipe on the list the control is in, until the control is comfortably in view. */
    async function swipeTo(el: HTMLElement, where: 'into-view' | 'top') {
      const box = scrollParent(el);
      if (!box) return;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const delta = where === 'top' ? -box.scrollTop : r.top - (b.top + b.height * 0.35);
      if (where === 'into-view' && r.top >= b.top + 12 && r.bottom <= b.bottom - 12) return;
      if (Math.abs(delta) < 8) return;
      const o = origin();
      const x = b.left - o.left + b.width * 0.7;
      const span = Math.min(200, b.height * 0.45);
      const from = delta > 0 ? b.top - o.top + b.height * 0.72 : b.top - o.top + b.height * 0.28;
      await moveTo(x, from);
      setFinger((f) => ({ ...f, down: true, drag: true }));
      await sleep(120);
      box.scrollBy({ top: delta, behavior: 'smooth' });
      const to = delta > 0 ? from - span : from + span;
      at.current = { x, y: to };
      setFinger((f) => ({ ...f, y: to, moveMs: Math.round(DRAG_MS * pace.current) }));
      await sleep(DRAG_MS);
      setFinger((f) => ({ ...f, down: false, drag: false }));
      await sleep(250);
    }

    async function tap(name: string, caption?: string) {
      let el = find(name);
      if (!el || !alive.current) return false;
      // Say what is about to happen first — the AI's suggestion — and let it be read.
      if (caption) {
        setFinger((f) => ({ ...f, caption }));
        await sleep(700);
      }
      await swipeTo(el, 'into-view');
      el = find(name);
      if (!el || !alive.current) return false;
      const c = centre(el);
      await moveTo(c.x, c.y, caption);
      // Settle on the target, lit up, as a thumb does before it presses.
      el.classList.add(TARGET_CLASS);
      await sleep(420);
      if (!alive.current) { el.classList.remove(TARGET_CLASS); return false; }
      setFinger((f) => ({ ...f, down: true, ripple: f.ripple + 1 }));
      await sleep(170);
      const target = find(name);
      el.classList.remove(TARGET_CLASS);
      if (!target || !alive.current || (target as HTMLButtonElement).disabled) {
        setFinger((f) => ({ ...f, down: false }));
        return false;
      }
      target.click();
      setFinger((f) => ({ ...f, down: false }));
      await sleep(550);
      // Lifted off the screen: a finger left resting where the NEXT button appears would
      // read as pressing it.
      setFinger((f) => ({ ...f, shown: false }));
      return true;
    }

    async function look(name: string, caption: string, ms: number) {
      const el = find(name);
      if (!el || !alive.current) return false;
      setFinger((f) => ({ ...f, caption }));
      await swipeTo(el, 'into-view');
      const again = find(name);
      if (again) {
        const r = again.getBoundingClientRect();
        const o = origin();
        await moveTo(r.left - o.left + Math.min(r.width - 24, 48), r.top - o.top + Math.min(r.height - 12, 36), caption);
      }
      await sleep(ms);
      setFinger((f) => ({ ...f, shown: false }));
      return true;
    }

    async function toTop(name: string) {
      const el = find(name);
      const box = el && (el.scrollTop > 0 ? el : scrollParent(el));
      if (!box || box.scrollTop <= 0) return;
      const first = box.firstElementChild as HTMLElement | null;
      if (first) await swipeTo(first, 'top');
      setFinger((f) => ({ ...f, shown: false }));
    }

    return {
      setActive: (on) => { alive.current = on; },
      setPace: (p) => { pace.current = PACE[p]; },
      tap, look, toTop, sleep,
      say: (caption) => setFinger((f) => ({ ...f, caption })),
      // Lifted, not teleported: the finger fades where it is and the next move starts there.
      hide: () => setFinger((f) => ({ ...f, shown: false, down: false, drag: false, caption: null })),
      exists: (name) => Boolean(find(name)),
      label: (name) => find(name)?.getAttribute('data-demo-label') ?? null,
    };
  }, []);

  return { finger, layer, pilot };
}
