import { Hand } from 'lucide-react';
import type { Finger } from './usePilot';

/**
 * The pilot's finger and what it is doing, drawn over the whole app (usePilot.ts).
 *
 * Always mounted, so it can move rather than appear: hidden is a fade, not an unmount, and
 * the next tap glides from where the last one lifted.
 */
export function PilotLayer({ finger, layerRef }: { finger: Finger; layerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pilot" ref={layerRef} aria-hidden>
      {finger.caption && (
        <div className="pilot__caption" key={finger.caption}><Hand /> {finger.caption}</div>
      )}
      <span className={`pilot__finger${finger.shown ? ' is-shown' : ''}${finger.down ? ' is-down' : ''}${finger.drag ? ' is-drag' : ''}`}
            style={{ transform: `translate3d(${finger.x}px, ${finger.y}px, 0)`, ['--move' as string]: `${finger.moveMs}ms` }}>
        <span className="pilot__dot" />
        {finger.ripple > 0 && <span key={finger.ripple} className="pilot__ripple" />}
      </span>
    </div>
  );
}
