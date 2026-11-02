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
  AlertTriangle, Ambulance, ArrowRight, BrainCircuit, Command, Crosshair, Eye, EyeOff, FileText, Gauge, GitCompare, Headset, History, LayoutDashboard, LayoutGrid, Loader2, LockKeyhole, LogOut, Moon, PanelRightClose, PanelRightOpen, Radar, RotateCcw, Sparkles, Sun, UserRound,
} from 'lucide-react';

import { useSession, usePoc, useCan, loadBootstrap, signIn, signOut, setClock } from '../lib/stores/session';
import { useTheme, toggleTheme, setTheme } from '../lib/stores/theme';
import { useNow } from '../lib/stores/now';
import { toast } from '../lib/stores/toast';
import { useSim, wireLiveFeeds } from '../lib/stores/live';
import { resetDetail } from '../lib/stores/detail';
import { resetDirector } from '../lib/stores/director';
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
import { ReportStudioHost } from '../shared/report/ReportStudio';
import './shell/shell.scss';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { LiveOpsPage } from './pages/liveops/LiveOpsPage';
import { IntelligencePage } from './pages/intelligence/IntelligencePage';
import { CommandCentrePage } from './pages/command/CommandCentrePage';
import { ReportsPage } from './pages/reports/ReportsPage';
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
  // Every incident, kept — preview, edit and download its report (PDF / Excel).
  { path: '/reports', label: 'nav.reports', icon: FileText, capabilities: ['operations.view', 'analytics.view', 'executive.view'], section: null, key: 'e', render: () => <ReportsPage /> },
  // Kept, reachable by URL, but not part of the ambulance service's everyday nav.
  { path: '/intelligence', label: 'nav.intelligence', icon: Gauge, capabilities: ['intelligence.view'], section: null, render: () => <IntelligencePage /> },
];

/** Rendered with no group eyebrow, in this exact order, around the "Insights" group. */
const STANDALONE_BEFORE = ['/dashboard', '/live'];
const STANDALONE_AFTER = ['/command', '/reports'];

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'insights', label: 'nav.section.insights' },
];

const allowed = (route: Route, capabilities: string[]) => route.capabilities.some((c) => capabilities.includes(c));

/**
 * The sidebar's collapsed state. Remembered per browser on a desktop; a narrow screen always
 * opens on the icon rail (shell.scss), and expanding it there lays the full sidebar over the
 * page as a drawer rather than squeezing the page — so that choice is not remembered.
 */
const NAV_KEY = 'erss.nav.collapsed';
const isNarrow = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches;
function readCollapsed(): boolean {
  if (isNarrow()) return true;
  try { return localStorage.getItem(NAV_KEY) === '1'; } catch { return false; }
}

/** When this tab last pressed Restart PoC — its own `sim:reset` echo is not news to it. */
let lastSelfReset = 0;

export function ConsoleApp() {
  const { status, user, error, dbDown } = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleNav = useCallback(() => setCollapsed((c) => !c), []);
  const closeOnNarrow = useCallback(() => { if (isNarrow()) setCollapsed(true); }, []);
  useEffect(() => {
    if (isNarrow()) return;
    try { localStorage.setItem(NAV_KEY, collapsed ? '1' : '0'); } catch { /* a preference, nothing breaks */ }
  }, [collapsed]);
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
    lastSelfReset = Date.now();
    try {
      await api.sim.reset();
      // The queue, fleet, feed, alerts and any open trace are all stale the instant this
      // resolves — the socket's own deltas only ever ADD to what a store already holds
      // (a feed row, a fresh incident), so without this the room would go on watching
      // ghosts of incidents the reset just deleted until something else forced a refetch.
      resyncNow();
      resetDetail();
      resetDirector();
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
      // Restarted from another console: this one's queue, map story and open panel are all
      // about incidents that no longer exist. The phones get the same event and start over too.
      onSocket('sim:reset', () => {
        resyncNow();
        resetDetail();
        resetDirector();
        if (Date.now() - lastSelfReset > 15_000) toast({ level: 'info', title: t('poc.restartedElsewhere') });
      }),
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
      if (e.key === '[') { toggleNav(); return; }
      if (e.key === 'g') { armed = true; setTimeout(() => { armed = false; }, 1200); return; }
      if (!armed) return;
      armed = false;
      const target = ROUTES.find((r) => r.key === e.key && capabilities && allowed(r, capabilities));
      if (target) navigate(target.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capabilities, toggleNav]);

  if (status === 'idle' || status === 'loading') return <BootScreen />;
  if (status === 'error') return <BootError message={error} dbDown={dbDown} />;
  if (!user) return <LoginScreen />;
  if (user.surface !== 'console') return <WrongSurface />;

  // The top chrome is ONE row: the Dubai Ambulance logo in a white box at the left, the
  // Government of Dubai logo in a white box at the right — logos only, as the client's
  // brand guidelines ask — and the toolbar between them: the product and page title at its
  // start, every tool at its end. The sidebar stays on the right, with its own open/close
  // button at its top; the pages themselves are left-to-right.
  return (
    <div className="shell" data-nav={collapsed ? 'collapsed' : 'open'}>
      <header className="shell-header">
        <div className="shell-header__tile">
          <AmbulanceLogo className="shell-header__dcas" />
        </div>

        <div className="shell-header__bar">
          <div className="shell-header__lead">
            <div className="shell-header__brand">
              <HeartbeatPulse />
              <span className="shell-header__wordmark">{t('app.name')}</span>
            </div>
            <h1 className="shell-header__title">{current ? t(current.label) : ''}</h1>
          </div>

          <div className="shell-header__tools">
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
          </div>
        </div>

        <div className="shell-header__tile shell-header__tile--gov">
          <GovLogo className="shell-header__gov" />
        </div>
      </header>

      {canSeeAdvisories && <AdvisoryDrawer open={advisoryOpen} onClose={() => setAdvisoryOpen(false)} />}

      <div className="shell-body" data-collapsed={collapsed}>
        {/* On a narrow screen an expanded sidebar is a drawer over the page; tapping the
            page behind it closes it, as a drawer should. */}
        {!collapsed && <div className="shell-nav__scrim" aria-hidden onClick={() => setCollapsed(true)} />}
        <nav className="shell-nav" id="shell-nav" aria-label="Main">
          {/* The sidebar opens and closes from its own top, just above "Dashboard". */}
          <div className="shell-nav__top">
            <button type="button" className="shell-nav__toggle"
                    onClick={toggleNav}
                    aria-controls="shell-nav" aria-expanded={!collapsed}
                    aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
                    title={`${t(collapsed ? 'nav.expand' : 'nav.collapse')}  [`}>
              {collapsed ? <PanelRightOpen aria-hidden /> : <PanelRightClose aria-hidden />}
            </button>
          </div>

          <div className="shell-nav__sections">
            {STANDALONE_BEFORE.map((path) => {
              const item = visible.find((r) => r.path === path);
              if (!item) return null;
              return (
                <div className="shell-nav__section" key={item.path}>
                  <NavLink item={item} active={current?.path === item.path} collapsed={collapsed} onNavigate={closeOnNarrow} />
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
                    <NavLink key={item.path} item={item} active={current?.path === item.path} collapsed={collapsed} onNavigate={closeOnNarrow} />
                  ))}
                </div>
              );
            })}

            {STANDALONE_AFTER.map((path) => {
              const item = visible.find((r) => r.path === path);
              if (!item) return null;
              return (
                <div className="shell-nav__section" key={item.path}>
                  <NavLink item={item} active={current?.path === item.path} collapsed={collapsed} onNavigate={closeOnNarrow} />
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
              {collapsed ? (
                <Button variant="ghost" size="sm" iconOnly onClick={() => void signOut()}
                        aria-label={t('auth.signOut')} title={t('auth.signOut')}>
                  <LogOut aria-hidden />
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                  <LogOut aria-hidden /> {t('auth.signOut')}
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
      {/* Every download in the console opens here first: preview, edit, then PDF or Excel. */}
      <ReportStudioHost />
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
  const [showPassword, setShowPassword] = useState(false);
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

  // The logo band across the top (the Government of Dubai logo at the left, Dubai Ambulance
  // at the right, on white), then two columns: the sign-in card on the page's one plain
  // background, with the footer carrying the corporation's full name under it, and a
  // plain DCAS-blue right side carrying the whole photo. The page follows the console's
  // theme (dark unless changed); the band stays white in both, so the logos keep their
  // approved colours.
  return (
    <div className="login">
      <LogoBand className="login__band" />

      <div className="login__body">
        <div className="login__panel">
          <form className="login__card" onSubmit={submit}>
            <div className="login__head">
              <span className="login__product"><Ambulance aria-hidden /> {t('app.name')}</span>
            </div>

            <div className="login__intro">
              <h1 className="login__title">{t('auth.signIn')}</h1>
              <div className="login__sub">{t('auth.signInSub')}</div>
            </div>

            <div className="login__fields">
              <Field label={t('auth.identifier')} error={err ?? undefined}>
                <span className="login__input">
                  <UserRound aria-hidden />
                  <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                         autoComplete="username" autoFocus required />
                </span>
              </Field>
              <Field label={t('auth.password')}>
                <span className="login__input login__input--reveal">
                  <LockKeyhole aria-hidden />
                  <input type={showPassword ? 'text' : 'password'} value={password}
                         onChange={(e) => setPassword(e.target.value)}
                         autoComplete="current-password" required />
                  <button type="button" className="login__reveal"
                          aria-pressed={showPassword}
                          aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                          title={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                          onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </button>
                </span>
              </Field>
              <Button type="submit" variant="primary" className="login__submit" block loading={busy}>
                {t('auth.signIn')} {!busy && <ArrowRight aria-hidden />}
              </Button>
            </div>

            {/* The seeded accounts, one click each. Shown in the deployed trial too, not only
                in development: this build is demonstrated to a room, and the alternative to a
                credential on the screen is a credential read out loud. Each tab holds its own
                session (lib/authToken.ts), so three roles can be signed in side by side. */}
            {/* Closed by default, so the front door reads as a sign-in page rather than a
                test harness; one click opens the list for the room. */}
            <details className="login__demo">
              <summary>{t('auth.demoAccounts')}</summary>
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
            </details>
          </form>

          {/* The corporation's full name lives here, at the bottom of the page, not beside
              the logos. The theme switch sits across from it. */}
          <footer className="login__foot">
            <span>{t('auth.copyright', { year: new Date().getFullYear() })}</span>
            <ThemeSwitch />
          </footer>
        </div>

        {/* The right side: plain DCAS blue, the product's full name, and the whole photo
            across its width — never cropped. Decoration only; hidden below 760px
            (shell.scss), where the form wins the room. */}
        <div className="login__art" aria-hidden>
          <div className="login__art-caption">
            <span className="login__art-eyebrow">{t('app.name')}</span>
            <span className="login__art-title">{t('app.tagline')}</span>
          </div>
          <img className="login__art-photo" src="/brand/ambulance.png" alt="" />
        </div>
      </div>
    </div>
  );
}

/** Dark / light, as two options side by side with the current one pressed — rather than a
 *  lone sun or moon that leaves the room guessing which way it flips the screen. */
function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div className="login__theme" role="group" aria-label={t('theme.label')}>
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}
              aria-label={t('theme.useDark')} title={t('theme.useDark')}>
        <Moon aria-hidden /> {t('theme.dark')}
      </button>
      <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}
              aria-label={t('theme.useLight')} title={t('theme.useLight')}>
        <Sun aria-hidden /> {t('theme.light')}
      </button>
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
function NavLink({ item, active, collapsed, onNavigate }: { item: Route; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <a href={item.path}
       className="shell-nav__item"
       aria-current={active ? 'page' : undefined}
       onClick={(e) => {
         if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
         e.preventDefault();
         navigate(item.path);
         onNavigate?.();
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

/** The Government of Dubai logo in its approved colours — always shown on white. The file
 *  is trimmed to its artwork, so a CSS height is the logo's own height, not its padding's. */
function GovLogo({ className }: { className: string }) {
  return <img className={className} src="/brand/gov-dubai-logo.svg" alt="Government of Dubai" />;
}

/** The Dubai Ambulance logo in its approved colours — always shown on white, trimmed to its
 *  artwork like the Government of Dubai's. */
function AmbulanceLogo({ className }: { className: string }) {
  return <img className={className} src="/brand/dubai-ambulance-logo.png" alt="Dubai Ambulance" />;
}

/**
 * The sign-in page's logo band: the Government of Dubai logo at the left and the Dubai
 * Ambulance logo at the right, on white, and nothing else. The Dubai Ambulance logo is 60%
 * of the Government of Dubai's height (shell.scss .logo-band).
 */
function LogoBand({ className = '' }: { className?: string }) {
  return (
    <div className={`logo-band ${className}`}>
      <GovLogo className="logo-band__gov" />
      <AmbulanceLogo className="logo-band__dcas" />
    </div>
  );
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
