import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/** How far the knob must travel before letting go counts. */
const DONE_AT = 0.85;
const INSET = 4;

/**
 * Slide-to-act. Sliding is deliberate in a way a tap is not, so a phone in a pocket cannot
 * call an ambulance — the same job the old two-second hold did, with the knob showing
 * exactly how close the person is to sending.
 */
export function SosSlider({ label, knob, tone = 'sos', onComplete, disabled }: {
  label: string;
  knob: ReactNode;
  tone?: 'sos' | 'light';
  onComplete: () => void;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; max: number } | null>(null);
  const [x, setX] = useState(0);
  const [max, setMax] = useState(1);
  const [dragging, setDragging] = useState(false);

  function complete(m: number) {
    setX(m);
    navigator.vibrate?.(30);
    onComplete();
    // If sending fails the screen stays, and the knob goes home for another try.
    window.setTimeout(() => setX(0), 1500);
  }

  function down(e: PointerEvent<HTMLButtonElement>) {
    if (disabled || !track.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = track.current.clientWidth - e.currentTarget.offsetWidth - INSET * 2;
    drag.current = { from: e.clientX - x, max: m };
    setMax(m);
    setDragging(true);
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    setX(Math.max(0, Math.min(drag.current.max, e.clientX - drag.current.from)));
  }

  function up() {
    if (!drag.current) return;
    const m = drag.current.max;
    drag.current = null;
    setDragging(false);
    if (x >= m * DONE_AT) complete(m);
    else setX(0);
  }

  function key(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const m = track.current ? track.current.clientWidth - e.currentTarget.offsetWidth - INSET * 2 : max;
    setMax(m);
    complete(m);
  }

  const progress = max > 0 ? x / max : 0;

  return (
    <div ref={track} className={`sos-slider sos-slider--${tone}${disabled ? ' is-disabled' : ''}`}>
      <span className="sos-slider__label" style={{ opacity: Math.max(0, 1 - progress * 1.6) }}>{label}</span>
      <button
        type="button"
        className={`sos-slider__knob${dragging ? ' is-dragging' : ''}`}
        style={{ transform: `translateX(${x}px)` }}
        aria-label={`Slide for ${label}`}
        disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {knob}
      </button>
    </div>
  );
}
