/**
 * Alert centre — the bell in the header, its panel, and the one popup at a time.
 *
 * Every alert carries the action that resolves it, and the action runs from here: open the
 * incident, dispatch the recommended ambulance, relocate a unit into a coverage gap. Reading
 * and doing are one click (server/services/alerts.js explains which alerts interrupt).
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, BellOff, CircleAlert, Info, MapPin, Send, Volume2, VolumeX, X } from 'lucide-react';
import type { AlertItem } from '../../lib/types';
import { t } from '../../lib/i18n';
import { api, ApiError, idempotencyKey } from '../../lib/api';
import { openIncident } from '../../lib/router';
import { toast } from '../../lib/stores/toast';
import { relative } from '../../lib/format';
import { useNow } from '../../lib/stores/now';
import {
  acknowledgeAlert, dismissPopup, setAlertPanel, setAlertSound, useAlerts,
} from '../../lib/stores/live';
import { Button, EmptyState } from '../../shared/ui';

type Action = AlertItem['actions'][number];

/** Run an alert's action. Returns true when the alert is dealt with. */
async function runAction(action: Action): Promise<boolean> {
  const p = action.payload ?? {};
  try {
    switch (action.kind) {
      case 'open_incident':
        openIncident(String(p.incidentRef));
        return true;

      case 'dispatch_recommended': {
        const ref = String(p.incidentRef);
        const rec = await api.incidents.recommendation(ref);
        const top = rec.value?.recommendations[0];
        if (!top) {
          toast({ level: 'warning', title: t('dispatch.none'), body: ref });
          openIncident(ref);
          return false;
        }
        await api.incidents.dispatch(ref, { unitRef: top.unitRef }, idempotencyKey());
        toast({ level: 'success', title: t('alerts.dispatched', { unit: top.callsign, ref }) });
        return true;
      }

      case 'relocate': {
        await api.units.standby(String(p.unitRef), Number(p.lng), Number(p.lat), String(p.reason ?? 'Coverage gap'));
        toast({ level: 'success', title: t('alerts.relocated', { unit: String(p.unitRef) }) });
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    toast({ level: 'danger', title: t('common.error'), body: (err as ApiError).message });
    return false;
  }
}

const LEVEL_ICON = { critical: CircleAlert, warning: AlertTriangle, info: Info } as const;

const CATEGORY_LABEL: Record<string, string> = {
  p1: 'New life-threatening call', waiting: 'Waiting for an ambulance', offer: 'Offer not taken',
  breach: 'Response target', arrival: 'Arrival', coverage: 'Coverage gap', hospital: 'Hospital load',
  redispatch: 'Dispatcher needed',
};
const ACTION_ICON = { open_incident: MapPin, dispatch_recommended: Send, relocate: MapPin } as const;

// ── Bell + panel ─────────────────────────────────────────────────────────────

export function AlertBell() {
  const { items, unread, open, sound } = useAlerts();
  const now = useNow();
  const hasCritical = items.some((a) => a.level === 'critical' && !a.acknowledged && now - Date.parse(a.at) < 5 * 60_000);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAlertPanel(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Button variant="ghost" size="sm" iconOnly aria-label={sound ? 'Mute alert sound' : 'Turn alert sound on'}
        title={t('alerts.sound')} onClick={() => setAlertSound(!sound)}>
        {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
      </Button>
      <button type="button" className={`alert-bell ${hasCritical ? 'is-critical' : ''}`} aria-label={`${t('alerts.title')} (${unread})`}
        aria-expanded={open} onClick={() => setAlertPanel(!open)}>
        <Bell aria-hidden />
        {unread > 0 && <span className="alert-bell__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="alert-panel" role="dialog" aria-label={t('alerts.title')}>
          <div className="alert-panel__head">
            <strong>{t('alerts.title')}</strong>
            <Button variant="ghost" size="sm" iconOnly aria-label={t('common.close')} onClick={() => setAlertPanel(false)}><X aria-hidden /></Button>
          </div>
          <div className="alert-panel__list">
            {!items.length
              ? <EmptyState icon={<BellOff aria-hidden />} title={t('alerts.none')} body={t('alerts.noneBody')} />
              : items.map((a) => <AlertRow key={a.id} alert={a} now={now} />)}
          </div>
        </div>
      )}
    </>
  );
}

function AlertRow({ alert, now }: { alert: AlertItem; now: number }) {
  const Icon = LEVEL_ICON[alert.level];
  const [busy, setBusy] = useState(false);
  return (
    <article className={`alert-row alert-row--${alert.level} ${alert.acknowledged ? 'is-done' : ''}`}>
      <Icon className="alert-row__icon" aria-hidden />
      <div className="alert-row__body">
        <div className="alert-row__title">{alert.title}</div>
        {alert.body && <div className="alert-row__text">{alert.body}</div>}
        <div className="alert-row__foot">
          <span>{relative(alert.at, now)}</span>
          {!alert.acknowledged && alert.actions.map((action) => (
            <button key={action.kind} type="button" className="alert-row__action" disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (await runAction(action)) acknowledgeAlert(alert.id);
                setBusy(false);
                if (action.kind === 'open_incident') setAlertPanel(false);
              }}>
              {action.label}
            </button>
          ))}
          {!alert.acknowledged && (
            <button type="button" className="alert-row__action alert-row__action--quiet" onClick={() => acknowledgeAlert(alert.id)}>
              {t('alerts.done')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── The popup ────────────────────────────────────────────────────────────────

/** How long a popup stays if nobody touches it. A critical alert waits for a person. */
const LINGER_MS = { critical: 45_000, warning: 14_000, info: 8_000 } as const;

export function AlertPopup() {
  const { popup } = useAlerts();
  if (!popup) return null;
  return <PopupCard key={popup.id} alert={popup} />;
}

function PopupCard({ alert }: { alert: AlertItem }) {
  const [busy, setBusy] = useState(false);
  const Icon = LEVEL_ICON[alert.level];

  useEffect(() => {
    const id = setTimeout(dismissPopup, LINGER_MS[alert.level]);
    return () => clearTimeout(id);
  }, [alert.level]);

  return (
    <div className={`alert-popup alert-popup--${alert.level}`} role="alertdialog" aria-live="assertive" aria-label={alert.title}>
      <div className="alert-popup__stripe" aria-hidden />
      <Icon className="alert-popup__icon" aria-hidden />
      <div className="alert-popup__body">
        <div className="alert-popup__eyebrow">{alert.priority ? `${alert.priority} · ` : ''}{CATEGORY_LABEL[alert.category] ?? alert.category.replace(/_/g, ' ')}</div>
        <div className="alert-popup__title">{alert.title}</div>
        {alert.body && <div className="alert-popup__text">{alert.body}</div>}
        <div className="alert-popup__actions">
          {alert.actions.map((action, i) => {
            const ActionIcon = ACTION_ICON[action.kind] ?? MapPin;
            return (
              <Button key={action.kind} size="sm" variant={i === 0 ? 'primary' : 'secondary'} loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const done = await runAction(action);
                  setBusy(false);
                  if (done) { acknowledgeAlert(alert.id); dismissPopup(); }
                }}>
                <ActionIcon aria-hidden /> {action.label}
              </Button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={dismissPopup}>{t('alerts.dismiss')}</Button>
        </div>
      </div>
    </div>
  );
}
