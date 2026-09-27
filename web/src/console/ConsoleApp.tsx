/**
 * The command console shell — DCAS, the Dubai Corporation for Ambulance Services.
 *
 * The URL is the page (lib/router.ts): /dashboard, /insights/radial, /command?tab=… — a
 * refresh keeps the page, the back button works, and a link can be opened in a new tab.
 *
 * The sidebar has three parts, in this order: Dashboard (the live overview, standalone);
 * the six promoted Insights subsystems (Overview, Radial search, Comparison, Call
 * centre, Performance, Replay — each its own page now, grouped under one "Insights"
 * label); and Command Centre (the operational workbench — Operations, AI advisories,
 * response time, stations & zones, demand & coverage, executive — consolidated behind
 * ITS OWN tab strip, since those six used to be separate top-level pages themselves).
 *
 * The nav is GENERATED from the signed-in user's capability set — a role without a
 * page's permission sees no item, not a disabled one.
 *
 * Each browser tab holds its own session (lib/authToken.ts), so a dispatcher, a duty
 * officer and a service lead can be signed in side by side in one browser.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, Ambulance, BrainCircuit, Command, Crosshair, Gauge, GitCompare, Headset, History, LayoutDashboard, LayoutGrid, Loader2, Moon, PanelLeft, PanelLeftClose, Radar, RotateCcw, Sparkles, Sun,
} from 'lucide-react';

import { useSession, usePoc, useCan, loadBootstrap, signIn, signOut, setClock } from '../lib/stores/session';
import { useTheme, toggleTheme } from '../lib/stores/theme';
import { useNow } from '../lib/stores/now';
import { toast } from '../lib/stores/toast';
import { useSim, wireLiveFeeds } from '../lib/stores/live';
import { closeDetail } from '../lib/stores/detail';
import { connectSocket, disconnectSocket, onSocket, resyncNow, useSocketStatus } from '../lib/socket';
import { navigate, useLocation } from '../lib/router';
import { t } from '../lib/i18n';
import { demoAccountsFor } from '../lib/demoAccounts';
import { timeSec } from '../lib/format';
import { api } from '../lib/api';
import { Button, Field, ErrorState, Dot, Toaster } from '../shared/ui';
import { AlertBell, AlertPopup } from './shell/AlertCenter';
import { DetectionPanel } from './shell/DetectionPanel';
import { AdvisoryDrawer } from './shell/AdvisoryDrawer';
import './shell/shell.scss';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { LiveOpsPage } from './pages/liveops/LiveOpsPage';
import { IntelligencePage } from './pages/intelligence/IntelligencePage';
import { CommandCentrePage } from './pages/command/CommandCentrePage';
import {
  OverviewPage, RadialSearchPage, ComparisonPage, CallCentrePage, PerformancePage, ReplayPage,
} from './pages/insights/pages';

/** The one grouped nav section left; Dashboard and Command Centre are standalone (see
 *  STANDALONE_BEFORE/AFTER below) and Intelligence is URL-only (section: null, never
 *  rendered by either mechanism). */
type Section = 'insights';

interface Route {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Any one of these grants the page. */
  capabilities: string[];
  /** Which nav block this belongs to; `null` means "not in the sidebar" UNLESS the path
   *  also appears in STANDALONE_BEFORE/AFTER, which render it with no group eyebrow. */
  section: Section | null;
  /** `g` then this key. */
  key?: string;
  render: () => React.ReactElement;
}

const ROUTES: Route[] = [
  { path: '/dashboard',            label: 'nav.dashboard',           icon: LayoutDashboard, capabilities: ['operations.view', 'executive.view'], section: null, key: 'd', render: () => <DashboardPage /> },
  // The wall view: the live map with nothing around it. Sits directly under the
  // Dashboard because it is the same picture given the whole screen.
  { path: '/live',                 label: 'nav.liveops',             icon: Radar,           capabilities: ['operations.view'], section: null, key: 'l', render: () => <LiveOpsPage /> },
  { path: '/insights/overview',    label: 'insights.tab.overview',   icon: LayoutGrid,      capabilities: ['analytics.view'], section: 'insights', key: 'o', render: () => <OverviewPage /> },
  { path: '/insights/radial',      label: 'insights.tab.radial',     icon: Crosshair,       capabilities: ['analytics.view'], section: 'insights', key: 'r', render: () => <RadialSearchPage /> },
  { path: '/insights/compare',     label: 'insights.tab.compare',    icon: GitCompare,      capabilities: ['analytics.view'], section: 'insights', key: 'x', render: () => <ComparisonPage /> },
  { path: '/insights/call-centre', label: 'insights.tab.callcentre', icon: Headset,         capabilities: ['analytics.view'], section: 'insights', key: 'c', render: () => <CallCentrePage /> },
  { path: '/insights/performance', label: 'insights.tab.performance',icon: Gauge,           capabilities: ['analytics.view'], section: 'insights', key: 'p', render: () => <PerformancePage /> },
  { path: '/insights/replay',      label: 'insights.tab.replay',     icon: History,         capabilities: ['analytics.view'], section: 'insights', key: 'y', render: () => <ReplayPage /> },
  {
    path: '/command', label: 'nav.commandCentre', icon: Command, section: null, key: 'k',
    // Any-of: whichever of Command Centre's six internal tabs a role can see, they can
    // open the subsystem — CommandCentrePage itself filters the tab strip per capability.
    capabilities: ['operations.view', 'advisories.view', 'collaborate.view', 'ranking.view', 'analytics.view', 'executive.view'],
    render: () => <CommandCentrePage />,
  },
  // Kept, reachable by URL, but not part of the ambulance service's everyday nav.
  { path: '/intelligence', label: 'nav.intelligence', icon: Gauge, capabilities: ['intelligence.view'], section: null, render: () => <IntelligencePage /> },
];

/** Rendered with no group eyebrow, in this exact order, around the "Insights" group. */
const STANDALONE_BEFORE = ['/dashboard', '/live'];
const STANDALONE_AFTER = ['/command'];

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'insights', label: 'nav.section.insights' },
];

const allowed = (route: Route, capabilities: string[]) => route.capabilities.some((c) => capabilities.includes(c));

export function ConsoleApp() {
  const { status, user, error, dbDown } = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const canSeeAdvisories = useCan('advisories.view');
  const canRestartPoc = useCan('scenario.control');
  const poc = usePoc();
  const [restarting, setRestarting] = useState(false);
  // The header clock ticks on the DOMAIN clock, anchored to the server's.
  const now = useNow();

  // Restart the PoC — clears every simulated call, puts the fleet back at rest, and closes
  // whatever the rail had open (its incident is about to stop existing). Only in the trial
  // build (config/poc.js): the emirate-wide product has no simulation to restart.
  const restartPoc = useCallback(async () => {
    if (!window.confirm(t('poc.restartConfirm'))) return;
    setRestarting(true);
    try {
      await api.sim.reset();
      // The queue, fleet, feed, alerts and any open trace are all stale the instant this
      // resolves — the socket's own deltas only ever ADD to what a store already holds
      // (a feed row, a fresh incident), so without this the room would go on watching
      // ghosts of incidents the reset just deleted until something else forced a refetch.
      resyncNow();
      closeDetail();
      toast({ level: 'success', title: t('poc.restarted') });
    } catch (e) {
      toast({ level: 'danger', title: t('poc.restartFailed'), body: (e as Error).message });
    } finally {
      setRestarting(false);
    }
  }, []);

  useEffect(() => { void loadBootstrap(); }, []);

  // Live updates for a signed-in console user; closed again on sign-out.
  const consoleUser = user?.surface === 'console' ? user.ref : null;
  useEffect(() => {
    if (!consoleUser) return;
    connectSocket();
    wireLiveFeeds();
    const offs = [
      onSocket('run:clock', setClock),
      onSocket('notify', (n) => toast({ level: n.level, title: n.title, body: n.body })),
    ];
    return () => { for (const off of offs) off(); disconnectSocket(); };
  }, [consoleUser]);

  const capabilities = user?.capabilities;
  const visible = capabilities ? ROUTES.filter((r) => allowed(r, capabilities)) : [];
  const current = visible.find((r) => location.path === r.path || location.path.startsWith(`${r.path}/`)) ?? null;
  const fallback = visible[0]?.path ?? null;

  // An unknown path, `/`, or a page this role cannot see → the role's first page.
  useEffect(() => {
    if (!consoleUser || current || !fallback) return;
    navigate(fallback, { replace: true });
  }, [consoleUser, current, fallback]);

  // Keyboard: `g` then a letter jumps between pages.
  useEffect(() => {
    let armed = false;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') { armed = true; setTimeout(() => { armed = false; }, 1200); return; }
      if (!armed) return;
      armed = false;
      const target = ROUTES.find((r) => r.key === e.key && capabilities && allowed(r, capabilities));
      if (target) navigate(target.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capabilities]);

  if (status === 'idle' || status === 'loading') return <BootScreen />;
  if (status === 'error') return <BootError message={error} dbDown={dbDown} />;
  if (!user) return <LoginScreen />;
  if (user.surface !== 'console') return <WrongSurface />;

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-header__brand">
          <BrandLogo />
          <span className="shell-header__wordmark">{t('app.name')}</span>
          <HeartbeatPulse />
          <span className="shell-header__client"><Ambulance aria-hidden /> DCAS</span>
        </div>

        <h1 className="shell-header__title">{current ? t(current.label) : ''}</h1>

        <div className="shell-header__spacer" />

        <span className="shell-header__clock">{timeSec(new Date(now).toISOString())} GST</span>

        {poc.enabled && canRestartPoc && (
          <Button variant="ghost" size="sm" onClick={() => void restartPoc()}
                  loading={restarting} title={t('poc.restartConfirm')}>
            <RotateCcw aria-hidden /> {t('poc.restart')}
          </Button>
        )}

        {canSeeAdvisories && (
          <button type="button" className="shell-header__advisory"
                  aria-expanded={advisoryOpen}
                  onClick={() => setAdvisoryOpen((o) => !o)}
                  title={t('advisory.title')}>
            <Sparkles aria-hidden />
            <span>{t('advisory.headerButton')}</span>
          </button>
        )}

        <AlertBell />

        <Button variant="ghost" size="sm" iconOnly onClick={toggleTheme}
                aria-label="Toggle theme" title="Toggle theme">
          <ThemeIcon />
        </Button>
      </header>

      {canSeeAdvisories && <AdvisoryDrawer open={advisoryOpen} onClose={() => setAdvisoryOpen(false)} />}

      <div className="shell-body" data-collapsed={collapsed}>
        <nav className="shell-nav" aria-label="Main">
          <div className="shell-nav__sections">
            {STANDALONE_BEFORE.map((path) => {
              const item = visible.find((r) => r.path === path);
              if (!item) return null;
              return (
                <div className="shell-nav__section" key={item.path}>
                  <NavLink item={item} active={current?.path === item.path} collapsed={collapsed} />
                </div>
              );
            })}

            {SECTIONS.map((section) => {
              const items = visible.filter((r) => r.section === section.key);
              if (!items.length) return null;
              return (
                <div className="shell-nav__section" key={section.key}>
                  <div className="shell-nav__eyebrow">{t(section.label)}</div>
                  {items.map((item) => (
                    <NavLink key={item.path} item={item} active={current?.path === item.path} collapsed={collapsed} />
                  ))}
                </div>
              );
            })}

            {STANDALONE_AFTER.map((path) => {
              const item = visible.find((r) => r.path === path);
              if (!item) return null;
              return (
                <div className="shell-nav__section" key={item.path}>
                  <NavLink item={item} active={current?.path === item.path} collapsed={collapsed} />
                </div>
              );
            })}
          </div>

          <div className="shell-nav__foot">
            <div className="shell-nav__user">
              <div className="shell-nav__avatar">{initials(user.name)}</div>
              <div className="shell-nav__who">
                <div className="shell-nav__name">{user.name}</div>
                <div className="shell-nav__role">{user.roleLabel} · {user.ref}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-6)', marginTop: 'var(--sp-10)' }}>
              <Button variant="ghost" size="sm" iconOnly onClick={() => setCollapsed((c) => !c)}
                      aria-label="Collapse navigation">
                {collapsed ? <PanelLeft aria-hidden /> : <PanelLeftClose aria-hidden />}
              </Button>
              {!collapsed && (
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                  {t('auth.signOut')}
                </Button>
              )}
            </div>
          </div>
        </nav>

        <main className="shell-main">
          {current ? current.render() : null}
        </main>
      </div>

      <StatusBar />
      <AlertPopup />
      {/* A camera detection arrives wherever the operator already is — same reasoning
          as the alert popup above it. */}
      <DetectionPanel />
      <Toaster />
    </div>
  );
}

// ── Status bar ───────────────────────────────────────────────────────────────

function StatusBar() {
  const { boot, dbDown } = useSession();
  const live = useSocketStatus().status;
  const sim = useSim().state;
  const poc = usePoc();
  const [health, setHealth] = useState<{ database: string } | null>(null);

  useEffect(() => {
    const check = () => api.health().then(setHealth).catch(() => setHealth(null));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const dbOk = health?.database === 'up' && !dbDown;

  return (
    <footer className="shell-status">
      <Dot tone={dbOk ? 'success' : 'danger'} />
      <span>{dbOk ? t('app.systemOnline') : t('app.systemDegraded')}</span>
      <span className="shell-status__sep">|</span>
      <span>DB {dbOk ? 'ok' : 'down'}</span>
      <span className="shell-status__sep">|</span>
      {/* Liveness, stated: a dropped socket degrades liveness, never correctness. */}
      <span title={t(`live.${live}`)}>
        <Dot tone={live === 'live' ? 'success' : live === 'offline' ? 'danger' : 'warning'} />
        {' '}{live === 'live' ? t('live.live') : t(`live.${live}`)}
      </span>

      {boot?.integrations && (
        <>
          <span className="shell-status__sep">|</span>
          <span>
            {Object.entries(boot.integrations).filter(([, v]) => !v.live).length} simulated sources
          </span>
        </>
      )}

      <span className="shell-status__spacer" />

      {/* What this build is scoped to, stated in the chrome on every page. There is no
          simulation control in the trial build (config/poc.js); what the room needs to
          know is that dispatch is automatic and how many ambulances it is choosing from. */}
      {poc.enabled && (
        <span className={`shell-status__sim ${sim?.running ? 'is-running' : ''}`}>
          <BrainCircuit aria-hidden style={{ width: 12, height: 12 }} />
          {t('status.poc', { n: poc.fleetSize })}
        </span>
      )}

      <span className="shell-status__sep">|</span>
      <span>v1.1.0</span>
    </footer>
  );
}

// ── Boot / auth screens ──────────────────────────────────────────────────────

function BootScreen() {
  return (
    <div className="boot">
      <div className="boot__inner">
        <img className="boot__logo" src="/brand/Astrikos_solo_logo.png" alt="" />
        <Loader2 className="u-spin" aria-hidden />
        <div className="boot__msg">{t('common.loading')}</div>
      </div>
    </div>
  );
}

function BootError({ message, dbDown }: { message: string | null; dbDown: boolean }) {
  return (
    <div className="boot">
      <div className="boot__inner">
        <img className="boot__logo" src="/brand/Astrikos_solo_logo.png" alt="" />
        <ErrorState
          title={dbDown ? t('app.dbDown') : t('common.offline')}
          body={message ?? undefined}
          onRetry={() => void loadBootstrap()}
        />
        {dbDown && (
          <div className="boot__hint">
            npm run db:schema &amp;&amp; npm run seed
          </div>
        )}
      </div>
    </div>
  );
}

function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The sign-in screen is the client's front door — a photo of their own ambulance, on
  // a white panel, always in day mode, regardless of what a signed-in user last chose
  // for the console. This flips the DOM attribute only (not the stored preference,
  // theme.ts's setTheme), and restores whatever was there once this screen unmounts.
  useEffect(() => {
    const prev = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    return () => { if (prev) document.documentElement.setAttribute('data-theme', prev); };
  }, []);

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
    <div className="login">
      {/* The art panel — decoration and the client's identity, nothing functional lives
          here. Hidden below 760px (shell.scss) rather than squeezed: a sign-in form
          always wins the space on a phone. The photo is a real <img> at object-fit:
          contain, not a cropped background — the whole vehicle stays in frame — sitting
          on the brand gradient, which shows through as the letterbox either side of it. */}
      <div className="login__art">
        <img className="login__art-photo" src="/brand/ambulance.png" alt="" />
        <img className="login__logo-card" src="/dcas_logo.png" alt="Dubai Corporation for Ambulance Services" />
        <div className="login__caption">
          <span className="login__eyebrow">{t('app.client')}</span>
          <h1 className="login__headline">{t('app.tagline')}</h1>
        </div>
      </div>

      <div className="login__panel">
        <form className="login__form-wrap" onSubmit={submit}>
          <img className="login__logo-mobile" src="/dcas_logo.png" alt="" />
          <h2 className="login__title">{t('auth.signIn')}</h2>
          <div className="login__sub"><Ambulance aria-hidden /> {t('app.name')} · {t('app.tagline')}</div>

          <div className="login__fields">
            <Field label={t('auth.identifier')} error={err ?? undefined}>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                     autoComplete="username" autoFocus required />
            </Field>
            <Field label={t('auth.password')}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                     autoComplete="current-password" required />
            </Field>
            <Button type="submit" variant="primary" className="login__submit" block loading={busy}>
              {t('auth.signIn')}
            </Button>
          </div>

          {/* The seeded accounts, one click each. Shown in the deployed trial too, not only
              in development: this build is demonstrated to a room, and the alternative to a
              credential on the screen is a credential read out loud. Each tab holds its own
              session (lib/authToken.ts), so three roles can be signed in side by side. */}
          <div className="login__demo">
            <span>{t('auth.demoAccounts')}</span>
            <div className="login__demo-grid">
              {demoAccountsFor('console').map((a) => (
                <button key={a.identifier} type="button"
                        title={t('auth.demoFill', { id: a.identifier })}
                        onClick={() => { setIdentifier(a.identifier); setPassword(a.password); }}>
                  <b>{a.role}</b>
                  <small>{a.identifier} · {a.password}</small>
                  {a.note && <em>{a.note}</em>}
                </button>
              ))}
            </div>
            <span className="login__demo-foot">{t('auth.demoMobileHint')}</span>
          </div>
        </form>
      </div>
    </div>
  );
}

function WrongSurface() {
  return (
    <div className="boot">
      <div className="boot__inner">
        <AlertTriangle aria-hidden />
        <div className="boot__title">Mobile account</div>
        <div className="boot__msg">
          This account is for the field application. Open <code>/app</code> on a phone.
        </div>
        <Button variant="secondary" onClick={() => void signOut()}>{t('auth.signOut')}</Button>
      </div>
    </div>
  );
}

/** One sidebar entry — a real `<a>` so middle-click and "open in new tab" work, which is
 *  how three roles get tested side by side in one browser. */
function NavLink({ item, active, collapsed }: { item: Route; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <a href={item.path}
       className="shell-nav__item"
       aria-current={active ? 'page' : undefined}
       onClick={(e) => {
         if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
         e.preventDefault();
         navigate(item.path);
       }}
       title={collapsed ? t(item.label) : undefined}>
      <Icon aria-hidden />
      <span className="shell-nav__label">{t(item.label)}</span>
    </a>
  );
}

function ThemeIcon() {
  const theme = useTheme();
  return theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />;
}

/** The client's lockup is red/blue ink with no white in it, so it always sits on the
 *  white plate (shell.scss `&__logo`) to read clearly. The header now carries the brand
 *  gradient in both themes rather than the theme's own chrome colour, so the plate is
 *  no longer theme-conditional either — this is the one asset (not the lightened
 *  `dcas_logo_dark.png` variant) that was actually drawn for it. */
function BrandLogo() {
  return <img className="shell-header__logo" src="/dcas_logo.png" alt="Dubai Corporation for Ambulance Services" />;
}

/** A small ECG trace beside the wordmark, in the client's own red — decoration, not a
 *  status readout, so it's aria-hidden and switched off under prefers-reduced-motion
 *  (shell.scss). The path is a plain heartbeat shape, nothing measured. */
function HeartbeatPulse() {
  return (
    <span className="shell-header__pulse" aria-hidden>
      <svg viewBox="0 0 64 24" preserveAspectRatio="none">
        <path className="shell-header__pulse-line" d="M0,12 L16,12 L20,6 L24,18 L28,4 L32,16 L36,12 L64,12" />
      </svg>
    </span>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
