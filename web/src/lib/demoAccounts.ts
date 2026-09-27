/**
 * The demo accounts, in ONE place.
 *
 * These are exactly the credentials the seed writes (server/db/seed/reference.js
 * seedUsers) and exactly what both login screens offer. One list, so the console, the
 * field app and the database can never disagree about what signs in — and so changing a
 * demo credential is one edit in two files, not a hunt through three screens.
 *
 * They are shown in the UI on purpose: this is a trial build seeded with invented people
 * (docs/09 §1), demonstrated to a room that should not have to be handed a password on
 * paper. Nothing here reaches a production deployment with real accounts in it, because a
 * production deployment does not run this seed.
 */

export interface DemoAccount {
  /** What a visitor types into the ID field — a username for the administrator, the
   *  operational ref (`<rolecode>-<4 hex>`, docs/03 §1) for everyone else. */
  identifier: string;
  password: string;
  /** Where the account lands after signing in, chosen by its role (server lib/auth.js
   *  ROLES) — `/` for the console, `/app` for the field app. */
  surface: 'console' | 'mobile';
  /** The role as a person would say it. */
  role: string;
  /** One short qualifier: what this account is for, or which unit it drives. */
  note?: string;
}

/** Shared by every seeded account except the administrator. */
export const DEMO_PASSWORD = 'erss2026';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  // Full access: the `admin` role holds every capability in server lib/auth.js
  // PERMISSIONS, so this one account opens every page in the console.
  { identifier: 'admin', password: 'Astrikos2026', surface: 'console', role: 'Administrator', note: 'Full access' },
  { identifier: 'DSP-4A1C', password: DEMO_PASSWORD, surface: 'console', role: 'Dispatcher' },
  { identifier: 'DUT-1F09', password: DEMO_PASSWORD, surface: 'console', role: 'Duty officer' },
  { identifier: 'LED-2C55', password: DEMO_PASSWORD, surface: 'console', role: 'Service lead' },
  { identifier: 'RSP-AMB14', password: DEMO_PASSWORD, surface: 'mobile', role: 'Paramedic', note: 'AMB-14' },
  { identifier: 'CIT-71BE', password: DEMO_PASSWORD, surface: 'mobile', role: 'Citizen' },
];

/** The administrator — named separately because both surfaces point at it by name. */
export const DEMO_ADMIN: DemoAccount = DEMO_ACCOUNTS[0];

export const demoAccountsFor = (surface: DemoAccount['surface']): DemoAccount[] =>
  DEMO_ACCOUNTS.filter((a) => a.surface === surface);
