# 07 · Mobile application specification

Surface: `/app` on port 3327, and the same code inside a Capacitor Android APK.
**One endpoint.** After login, the authenticated user's role selects the surface.

---

## 1 · Entry and role resolution

```
  /app
    │
    ├─ no session ──────────────► Login screen
    │                               ├─ ID / phone + password
    │                               └─ [ Create citizen account ]
    │
    └─ session ──► role?
                    ├─ 'responder' ──► Responder surface
                    ├─ 'citizen'   ──► Citizen surface
                    └─ console role ─► "This account is for the command console.
                                         Open ERSS on a desktop." + sign out
```

No URL reveals which surface a user gets. A responder cannot navigate to a citizen
screen and a citizen cannot reach a responder screen, because neither route exists —
the surface is a component choice, not a path.

**Session persistence.** The signed cookie survives app restarts. A responder on shift
signs in once. In the Capacitor build the WebView cookie jar holds it; on the web it is
a normal HTTP-only cookie.

---

## 2 · Design constraints specific to the phone

These are not preferences. They come from where the device is actually used.

| Constraint | Rule |
|---|---|
| One hand, moving vehicle | Every primary action in the bottom third of the screen. Nothing critical in a top corner. |
| Gloves | Minimum touch target **48px**; primary actions 64px tall. |
| Sunlight, Dubai | Dark theme default with a high-contrast toggle that lifts text to `--app-text` on `--app-bg` with no mid-tones. Never rely on a subtle tint to convey state. |
| Glanceable | The single most important fact on any screen is ≥ 24px. On the assignment screen that is the ETA. On the SOS screen it is the status. |
| Poor connectivity | Every write queues locally and syncs; the UI states plainly whether an action has reached the server. |
| Battery | Position reporting backs off when stationary; the map is not rendered when the screen is a form. |
| Accessibility | The citizen surface must be usable by someone with a hearing or visual impairment — this is an explicit DCAS requirement, not an afterthought. See §4.6. |

Type ramp is the enlarged mobile ramp from
[05 §6](05-DESIGN-SYSTEM.md#6--typography).

---

## 3 · Responder surface

For ambulance crew, police PRV and fire/rescue units. Four tabs plus a full-screen
assignment flow that pre-empts everything.

```
┌─────────────────────────┐
│ AMB-14  ⬤ Available     │   status bar — tap to change duty state
│ Shift ends 18:00        │
├─────────────────────────┤
│                         │
│      tab content        │
│                         │
├─────────────────────────┤
│  ⌂      ⚑      ◷     ☰ │   Home · Job · Shift · More
└─────────────────────────┘
```

### 3.1 Home

Duty state control (Available / Standby / Out of service, with a reason for the last),
the unit's position on a small map, the current standby assignment if a coverage
advisory has placed one — with the reason shown, because a crew told to move deserves
to know why — and today's job count and mean turnout.

### 3.2 Assignment offer — the screen that matters

Arrives as a full-screen takeover with sound, vibration and, in the native build, a
high-priority notification that overrides silent mode.

```
┌─────────────────────────┐
│        ▎ P1             │
│   CARDIAC ARREST        │
│                         │
│   Marina Pinnacle       │
│   Tower A · Floor 75    │
│   Makani 2797 87586     │
│   Entrance 1 (main)     │
│                         │
│   2.4 km · ETA 2:40     │
│                         │
│   ⚠ Lift access via     │
│     service core B      │
│                         │
│  ┌───────────────────┐  │
│  │     ACCEPT        │  │  64px, amber, dark ink
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │     Decline       │  │  ghost
│  └───────────────────┘  │
│        ◷ 38s            │  countdown to timeout
└─────────────────────────┘
```

The countdown is real: at `acknowledgeTimeoutSec` the offer expires, the assignment is
marked `timed_out`, and dispatch re-runs. The timeout is measured and feeds the
acknowledge-drift advisory — so the thing the crew experiences as pressure is the same
thing leadership sees as a metric, which is the point.

Decline requires a reason from a fixed list (already committed · vehicle fault · crew
unavailable · out of area · other + text).

### 3.3 Navigation

Turn-by-turn to the **Makani entrance point**, not the street. The map shows the
building footprint with the correct entrance marked, and the access note is pinned
above the map where it cannot be missed. Voice guidance via the Web Speech API.

On arrival the app detects proximity and surfaces `[ On scene ]` as the primary action;
the responder still taps it, and the server stamps the time
([04 §4](04-API-AND-SOCKET-CONTRACT.md#4--units--assignments)).

Position is reported at 1/3 s while responding, backing off to 1/30 s when stationary.

### 3.4 On scene

The job screen, driven by the incident kind:

- **Vertical access** — floor, unit, lift or stair, arrival-at-patient time. This is a
  separate timestamp from on-scene arrival, because in a 75-floor tower they are not
  the same event and pretending they are is how the "last hundred metres" problem
  stays invisible.
- **Patient** — `[ Scan Emirates ID ]` (camera, or manual entry) → the NABIDH pull
  returns allergies, conditions, medications and recent encounters. Displayed as a
  clinical summary with allergies first and in `--app-danger`.
- **Vitals** — HR, SpO₂, BP, respiratory rate, GCS, rhythm. Entered, or streamed from
  the scenario's simulated monitor. Each sample goes to the incident and, once a
  destination is chosen, to the receiving hospital.
- **Interventions** — a checklist by incident kind.
- **Triage tag** — START/SALT, for mass-casualty incidents only.
- **Destination** — ranked hospitals with capability match, ED load and drive time,
  each with its reasoning. `[ Send pre-alert ]` fires the pre-arrival activation and
  starts the acknowledgement clock.

### 3.5 Transport and handover

`[ Transporting ]` → live ETA to the hospital, telemetry continuing to stream,
pre-alert acknowledgement state visible. `[ At hospital ]` → handover timer starts.
`[ Clear ]` → returns the unit to available, or to a standby point if a coverage
advisory has one waiting.

### 3.6 Shift

Jobs completed, mean turnout, mean on-scene time, distance, the shift timeline. A crew
seeing their own numbers is the feedback loop that makes the organisation's numbers
move.

### 3.7 More

Advisories relevant to this unit or zone, protocol reference cards (offline), unit
equipment checklist, language, high-contrast toggle, sign out.

---

## 4 · Citizen surface

### 4.1 Home — the SOS screen

```
┌─────────────────────────┐
│  ERSS Dubai             │
│                         │
│                         │
│      ╭───────────╮      │
│      │           │      │
│      │    SOS    │      │   240px, amber, dark ink
│      │           │      │   press and hold 2s
│      ╰───────────╯      │
│                         │
│   Hold for 2 seconds    │
│                         │
│  ┌────────┬────────┐    │
│  │ 998    │ 999    │    │   direct dial, always available
│  │Ambulance│Police │    │
│  ├────────┼────────┤    │
│  │ 997    │ 996    │    │
│  │ Civil  │ Coast  │    │
│  │Defence │ Guard  │    │
│  └────────┴────────┘    │
│                         │
│  ⌖ Al Barsha 1          │   live location + Makani, always visible
│    Makani 3125 51422    │
├─────────────────────────┤
│  ⌂      ♡      ☰       │   Home · Medical · More
└─────────────────────────┘
```

Press-and-hold for two seconds prevents pocket dialling; the ring fills as it holds.
The four direct-dial buttons are always present — **the app must never be the only way
to get help**, and a product that hides the phone number is a worse product.

### 4.2 SOS flow

1. **Hold** → haptic confirmation, location captured with accuracy, nearest Makani
   entrance resolved.
2. **Type** (skippable after 5 s, defaulting to "unknown medical") — Medical · Injury ·
   Traffic · Fire · Water · Crime · Other. Large tiles, icon plus label.
3. **Confirm** — shows exactly what will be sent: location, Makani, your medical
   profile, your phone. `[ Send ]` or `[ Cancel ]`.
4. **Sent** → the tracking screen.

### 4.3 Tracking

```
┌─────────────────────────┐
│  HELP IS ON THE WAY     │
│                         │
│      ETA 4:12           │   the one big number
│                         │
│   Ambulance · Medic 14  │
│   assigned 14:32:07     │
│                         │
│  ┌───────────────────┐  │
│  │      map          │  │   your pin + the unit approaching
│  └───────────────────┘  │
│                         │
│  ✓ Call received  14:31 │
│  ✓ Unit assigned  14:32 │
│  ◉ On the way     14:32 │
│  ○ Arrived              │
│                         │
│  ┌───────────────────┐  │
│  │  First aid guide  │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │  Cancel request   │  │  ghost, confirm required
│  └───────────────────┘  │
└─────────────────────────┘
```

The unit's position is shown **only while it is assigned to this caller**, and its
history is never exposed. `/api/sos/:ref/status` returns a deliberately narrow
projection ([04 §8](04-API-AND-SOCKET-CONTRACT.md#8--admin-assistant-citizen)).

### 4.4 First-aid guidance

Offline cards by emergency type — CPR with a metronome at 110 bpm, choking, bleeding,
burns, seizure, stroke (FAST), heat exhaustion. Illustrated, stepped, large type, with
voice output. Available without an active SOS, because that is when people learn them.

Dubai's published bystander-CPR rate of 10.5% is the reason this is a first-class
feature and not a help page.

### 4.5 Medical profile

Blood group, allergies, chronic conditions, current medications, emergency contact,
preferred language. Stored against the citizen's own user record, sent with an SOS,
and surfaced to the responding crew. Editable only by its owner
(`/api/me/medical-profile` is scoped to `self` and nothing else).

### 4.6 Accessibility mode

Not a settings checkbox — a mode the app can be put into permanently, matching the
DCAS requirement that the public app serve people with hearing and visual impairment.

| Impairment | Provision |
|---|---|
| Hearing | **Silent SOS**: no tone, no voice; status conveyed by vibration patterns and large text. A structured text exchange with the control room replaces the voice call: pre-set statements ("I cannot speak", "I am with the patient", "The patient is breathing") plus free text. |
| Visual | Full screen-reader labelling; the SOS control reachable as the first focusable element; voice output of every status change; high-contrast mode. |
| Motor | 64px targets on every citizen action; press-and-hold duration configurable; no gesture is ever the only way to do something. |
| Language | Interface strings via `t()`; the first-aid guidance carries the illustration set, which is language-independent. |

---

## 5 · Offline behaviour

| State | Behaviour |
|---|---|
| Online | Normal |
| Degraded (socket down, REST up) | A persistent "live updates paused" bar; the app polls every 10 s; all actions still work |
| Offline | Actions queue locally with a visible pending count and an explicit "not yet sent" state per item; position buffers; the first-aid guidance and protocol cards remain fully available |
| Reconnect | Queue drains oldest-first with idempotency keys; conflicts surface as a review list, never silently resolved |

**One thing never queues.** An SOS is not queued silently. If it cannot reach the
server, the app says so in unmistakable terms and puts the 998 dialler on screen. A
queued emergency call is worse than no app.

---

## 6 · Native build

`capacitor.config.ts`:

```ts
export default {
  appId: 'ae.astrikos.erss',
  appName: 'ERSS Dubai',
  webDir: '../web/dist',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen:      { launchShowDuration: 1200, backgroundColor: '#121212' },
    StatusBar:         { style: 'DARK', backgroundColor: '#171717' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Geolocation:       { },
  },
};
```

| Concern | Detail |
|---|---|
| Entry | The APK opens at `/app`. The console entry remains in the bundle; `VITE_BUILD_SURFACE=app` trims it if size becomes a problem. |
| Plugins | `app`, `filesystem`, `geolocation`, `push-notifications`, `camera`, `share`, `splash-screen`, `status-bar`, `haptics` |
| Permissions | `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (responder only, with the required rationale screen), `CAMERA`, `POST_NOTIFICATIONS`, `VIBRATE` |
| Background location | Responder role only, only while on duty, with a persistent foreground notification. A citizen's location is captured only during an active SOS. |
| Toolchain | JDK 21 Temurin · Android SDK platform 36 · build-tools 36.0.0 · Gradle 8.14.3 · `minSdk 24`, `compileSdk`/`targetSdk 36` |
| Cleartext | The dev LAN IP is allowed via a debug-only network security config; the release build is HTTPS-only |
| Icons | `@capacitor/assets` from a 1024px source |
| Distribution | Debug APK by direct install for the demo. No Play Store. |

**`native.ts` is the only Capacitor-aware module.** Everything else runs identically in
a browser. Each capability has a web fallback, so the entire app can be demonstrated in
Chrome on a phone without installing anything:

| Capability | Native | Web fallback |
|---|---|---|
| Position | `@capacitor/geolocation` | `navigator.geolocation` |
| Camera (Emirates ID) | `@capacitor/camera` | `getUserMedia` (needs HTTPS — hence `basic-ssl` in dev) |
| Push | FCM | Socket + in-app banner |
| Haptics | `@capacitor/haptics` | `navigator.vibrate` |
| Share / save | `@capacitor/share`, `filesystem` | Download link |

---

## 7 · Demo accounts

Seeded by `npm run seed`, listed on the login screen in development only.

| Role | Account | Notes |
|---|---|---|
| Responder | `AMB-14` | The Tier-1 scenario's primary unit |
| Responder | `PRV-221` | Police unit, for the multi-agency scenario |
| Responder | `FIRE-07` | Civil Defence unit |
| Citizen | `CIT-DEMO-1` | Has a full medical profile — the cardiac scenario's caller |
| Citizen | `CIT-DEMO-2` | No medical profile, tests the empty path |
