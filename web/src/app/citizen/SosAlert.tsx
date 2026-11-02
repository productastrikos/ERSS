import { useEffect, useRef, useState } from 'react';
import { HeartPulse, Loader2, Phone, Wind } from 'lucide-react';
import { tone } from '../../lib/sound';
import { CONCERN_TITLE, formatFor, formatValue, type Alarm } from './health';
import { SosSlider } from './SosSlider';

const R = 88;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * The countdown that starts when a reading stays past a limit. Nobody answering is the
 * case this exists for, so silence sends; "I'm OK" is the only way to stop it, and sliding
 * sends straight away.
 */
export function SosAlert({ alarm, seconds, sending, error, onSend, onCancel }: {
  alarm: Alarm;
  seconds: number;
  sending: boolean;
  error: string | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const fired = useRef(false);
  const onSendRef = useRef(onSend);

  useEffect(() => { onSendRef.current = onSend; });

  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (left > 0) {
      tone('critical');
      navigator.vibrate?.([180, 80, 180]);
    } else if (!fired.current) {
      fired.current = true;
      onSendRef.current();
    }
  }, [left]);

  const Icon = alarm.concern === 'low_spo2' ? Wind : HeartPulse;

  return (
    <div className="sos-alert" role="alertdialog" aria-modal="true"
         aria-labelledby="sos-alert-title" aria-describedby="sos-alert-body">
      <div className="sos-alert__top">
        <span className="sos-alert__icon"><Icon aria-hidden /></span>
        <h2 id="sos-alert-title">{CONCERN_TITLE[alarm.concern]}</h2>
        <p id="sos-alert-body">
          {formatValue(alarm.concern, alarm.value)} for {formatFor(alarm.forSec)}. If you don't respond,
          an ambulance will be requested and your location shared with the crew.
        </p>
      </div>

      <div className="sos-alert__count" aria-live="assertive">
        <svg viewBox="0 0 200 200" aria-hidden>
          <circle className="sos-alert__ring-track" cx="100" cy="100" r={R} />
          <circle className="sos-alert__ring" cx="100" cy="100" r={R}
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - left / seconds)}
                  transform="rotate(-90 100 100)" />
        </svg>
        <span className="sos-alert__num">{sending ? <Loader2 className="u-spin" aria-label="Sending" /> : left}</span>
      </div>

      <div className="sos-alert__caption">
        {sending ? 'Requesting an ambulance…' : left > 0 ? `Requesting an ambulance in ${left} s` : 'Could not send automatically'}
      </div>

      {error && (
        <div className="sos-alert__error">
          <span>{error}</span>
          <a href="tel:998"><Phone aria-hidden /> Call 998</a>
        </div>
      )}

      <div className="sos-alert__actions">
        <SosSlider label="Emergency SOS" knob="SOS" onComplete={onSend} disabled={sending} />
        <button type="button" className="sos-alert__ok" onClick={onCancel} disabled={sending}>I'm OK</button>
      </div>
    </div>
  );
}
