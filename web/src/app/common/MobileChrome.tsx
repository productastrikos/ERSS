/**
 * Chrome both mobile surfaces share: the light/dark switch, the connection light, and the
 * Appearance setting on the More tab.
 *
 * The app keeps its own theme, separate from the console's (lib/stores/theme.ts), and by
 * default follows the phone's light/dark setting. The connection light is there because both apps are LIVE
 * now — the crew's offer and the caller's ambulance arrive over the socket — and a phone that
 * has silently dropped off the platform must say so, not just look quiet.
 */

import { Moon, Sun } from 'lucide-react';
import { setThemePref, toggleTheme, useTheme, useThemePref, type ThemePref } from '../../lib/stores/theme';
import { useSocketStatus } from '../../lib/socket';
import { Segmented } from '../../shared/ui';

/** The strip at the very top of every app screen: Dubai Ambulance at the start, the
 *  Government of Dubai logo at the end, on white in both themes so each keeps its approved
 *  colours — the console header's logo row (console/ConsoleApp.tsx, shell-header__tile). */
export function MobileLogoBand() {
  return (
    <div className="m-logoband">
      <img className="m-logoband__dcas" src="/brand/dubai-ambulance-logo.png" alt="Dubai Ambulance" />
      <img className="m-logoband__gov" src="/brand/gov-dubai-logo.svg" alt="Government of Dubai" />
    </div>
  );
}

export function ThemeToggle() {
  const dark = useTheme() === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="m-iconbtn" onClick={toggleTheme} aria-label={label} title={label}>
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </button>
  );
}

const LIVE_TEXT = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline', idle: 'Offline' } as const;

/** Whether this phone is connected to the platform right now. */
export function LiveBadge() {
  const { status } = useSocketStatus();
  const tone = status === 'live' ? 'live' : status === 'offline' || status === 'idle' ? 'off' : 'wait';
  return (
    <span className={`m-live m-live--${tone}`} role="status" aria-live="polite" title={tone === 'live' ? 'Connected — updates arrive instantly' : undefined}>
      <span className="m-live__dot" aria-hidden />
      {LIVE_TEXT[status]}
    </span>
  );
}

/** Follow the phone, or pin light or dark — stated as a choice rather than hidden behind
 *  an icon. "Phone" is the default: the app matches the rest of the device. */
export function AppearanceSetting() {
  const pref = useThemePref();
  return (
    <div className="m-setting">
      <span className="m-setting__label">Appearance</span>
      <Segmented<ThemePref> value={pref} ariaLabel="Appearance" onChange={setThemePref}
        options={[{ value: 'system', label: 'Phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
    </div>
  );
}
