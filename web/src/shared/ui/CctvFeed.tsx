/**
 * One CCTV feed, played inline.
 *
 * The reason this is a component rather than a bare `<video>`: a camera feed that is not
 * there must SAY it is not there. A missing clip renders as a black rectangle, which on a
 * video wall is indistinguishable from a working camera pointed at a dark room — the
 * worst possible failure for a surface whose whole job is telling an operator what is
 * happening. An unreachable feed shows the camera's id and the word "no signal", which is
 * what a real control room shows and what a demonstration needs when the media for a
 * scenario has not been dropped in yet.
 */

import { useState } from 'react';
import { VideoOff } from 'lucide-react';
import { t } from '../../lib/i18n';

export function CctvFeed({ src, label, className = '' }: {
  src: string | null | undefined;
  /** The camera's id or name — shown as the fallback's caption, and as the a11y label. */
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`cctv-feed cctv-feed--down ${className}`} role="img" aria-label={`${label} — ${t('cctv.noSignal')}`}>
        <VideoOff aria-hidden />
        <span>{t('cctv.noSignal')}</span>
        <small>{label}</small>
      </div>
    );
  }

  return (
    <video
      className={`cctv-feed ${className}`}
      src={src}
      autoPlay muted loop playsInline
      aria-label={label}
      onError={() => setFailed(true)}
    />
  );
}
