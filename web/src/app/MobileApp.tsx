/**
 * The mobile surface. ONE endpoint: /app.
 *
 * After login the authenticated user's ROLE selects the surface — responder or
 * citizen. No URL reveals which; a responder cannot navigate to a citizen screen and
 * vice versa, because neither route exists. See docs/07-MOBILE-APP-SPEC.md §1.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertTriangle, Phone, Ambulance } from 'lucide-react';

import { useSession, loadBootstrap, signIn, signOut } from '../lib/stores/session';
import { t } from '../lib/i18n';
import { DEMO_ADMIN, demoAccountsFor } from '../lib/demoAccounts';
import { Button, Field, ErrorState } from '../shared/ui';
import { ResponderSurface } from './responder/ResponderSurface';
import { CitizenSurface } from './citizen/CitizenSurface';
import './mobile.scss';
import './mobile-live.scss';

export function MobileApp() {
  const { status, user, error, dbDown } = useSession();

  useEffect(() => { void loadBootstrap(); }, []);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="m-boot">
        <img className="m-boot__logo" src="/brand/Astrikos_solo_logo.png" alt="" />
        <Loader2 className="u-spin" aria-hidden />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="m-boot">
        <ErrorState
          title={dbDown ? t('app.dbDown') : t('common.offline')}
          body={error ?? undefined}
          onRetry={() => void loadBootstrap()}
        />
        {/* The app must NEVER be the only way to get help. */}
        <EmergencyNumbers />
      </div>
    );
  }

  if (!user) return <MobileLogin />;

  switch (user.role) {
    case 'responder': return <ResponderSurface />;
    case 'citizen':   return <CitizenSurface />;
    default:          return <ConsoleAccount />;
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

function MobileLogin() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await signIn(identifier, password);
    } catch {
      setErr(t('auth.failed'));
    } finally {
      setBusy(false);
    }
  }, [identifier, password]);

  return (
    <div className="m-login">
      <form className="m-login__form" onSubmit={submit}>
        <img className="m-login__logo" src="/brand/Astrikos_solo_logo.png" alt="" />
        <h1 className="m-login__title">{t('app.name')}</h1>
        <p className="m-login__client"><Ambulance aria-hidden /> {t('app.client')}</p>

        <Field label={t('auth.identifier')} error={err ?? undefined}>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                 autoComplete="username" autoCapitalize="characters" autoFocus required
                 inputMode="text" />
        </Field>
        <Field label={t('auth.password')}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" required />
        </Field>

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {t('auth.signIn')}
        </Button>

        <DemoCredentials onPick={(a) => { setIdentifier(a.identifier); setPassword(a.password); }} />
      </form>

      {/* Always present, on every screen of the citizen path — including before login. */}
      <EmergencyNumbers />
    </div>
  );
}

/**
 * The seeded accounts, tappable. A phone is the worst place to type `RSP-AMB14` from a
 * slide, so each one fills the form. Only the two MOBILE roles land here — an admin or a
 * dispatcher account signs in fine and then reaches ConsoleAccount below, which is a dead
 * end on a phone — so the console credential is stated as a line of text, not a button.
 */
function DemoCredentials({ onPick }: { onPick: (a: { identifier: string; password: string }) => void }) {
  return (
    <div className="m-demo">
      <span className="m-demo__title">{t('auth.demoAccounts')}</span>
      {demoAccountsFor('mobile').map((a) => (
        <button key={a.identifier} type="button" className="m-demo__btn" onClick={() => onPick(a)}>
          <b>{a.role}{a.note ? ` · ${a.note}` : ''}</b>
          <small>{a.identifier} · {a.password}</small>
        </button>
      ))}
      <span className="m-demo__foot">
        {t('auth.demoConsoleHint', { id: DEMO_ADMIN.identifier, pw: DEMO_ADMIN.password })}
      </span>
    </div>
  );
}

// ── Emergency numbers — never hidden behind the app ──────────────────────────

export function EmergencyNumbers() {
  const numbers = [
    { no: '998', label: 'Ambulance' },
    { no: '999', label: 'Police' },
    { no: '997', label: 'Civil Defence' },
    { no: '996', label: 'Coastguard' },
  ];
  return (
    <div className="m-numbers" role="group" aria-label="Emergency numbers">
      {numbers.map((n) => (
        <a key={n.no} className="m-numbers__btn" href={`tel:${n.no}`}>
          <Phone aria-hidden />
          <span className="m-numbers__no">{n.no}</span>
          <span className="m-numbers__label">{n.label}</span>
        </a>
      ))}
    </div>
  );
}

function ConsoleAccount() {
  return (
    <div className="m-boot">
      <AlertTriangle aria-hidden />
      <div className="m-boot__title">Console account</div>
      <p className="m-boot__msg">{t('auth.consoleOnly')}</p>
      <Button variant="secondary" size="lg" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
