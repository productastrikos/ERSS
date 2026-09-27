# 05 · Design system

Derived from `ASTRIKOS-UI-THEME.md` v1.0 with one deliberate, documented divergence:
**the accent hue**. Everything else in that specification — the ten laws, the type
system, the spacing scale, the radius family, the elevation formula, the motion curve,
the forbidden list, the self-audit — is adopted unchanged and is binding here.

---

## 1 · What changed and what did not

| Aspect | Astrikos theme v1.0 | ERSS Dubai | Status |
|---|---|---|---|
| Accent hue | Periwinkle `#A79EDA` / `#A597FF` | **Signal amber `#E0912F`** | **Diverged** — see [D-04](00-DECISIONS.md#d-04--visual-identity-signal-amber-on-graphite) |
| Light-theme neutrals | Violet-cast (`#F4F3F9`, `#E2DFEF`, ink `#353248`) | De-tinted to warm graphite | **Diverged** — same reason: the violet cast is what reads as generated |
| Dark-theme neutrals | True graphite `#121212`–`#272727` | Unchanged | Kept |
| Typography | Lexend Deca + Lato | Unchanged, **self-hosted** | Kept |
| Spacing, radius, elevation, motion | As specified | Unchanged | Kept |
| Status hues | success/warning/danger/info | Unchanged | Kept |
| Law 8 — metallic chrome on logo + one control | As specified | Kept; the one control is the advisory/AI action | Kept |
| Ten laws, §15 bans, §16 audit | As specified | Binding | Kept |

**Self-hosting the fonts** is a change of delivery, not of design. A command room may be
air-gapped and a demo room may have hostile Wi-Fi; a Google Fonts CDN dependency is a
single point of failure for the entire visual identity. Fonts ship in
`web/public/fonts/` with a local `@font-face` block.

---

## 2 · Tokens — dark theme

`web/src/theme/theme.css`. **The only file in the repository permitted to contain a
colour literal.** Enforced by `npm run audit:theme`.

```css
:root {
  /* ── Surface ladder: ground → chrome → panel → raised ───────────────── */
  --app-bg:             #121212;
  --app-chrome-bg:      #171717;
  --app-panel:          #1A1A1A;
  --app-surface:        #1E1E1E;
  --app-surface-soft:   #161616;
  --app-surface-raised: #272727;
  --app-bg-elevated:    #212121;

  /* ── Hairlines ──────────────────────────────────────────────────────── */
  --app-border:         #2B2B2B;
  --app-border-soft:    #232323;
  --app-border-strong:  #3A3A3A;
  --app-panel-border:   #282828;

  /* ── Type ───────────────────────────────────────────────────────────── */
  --app-text:           #ECECEC;
  --app-text-muted:     #A6A6A6;
  --app-text-faint:     #787878;

  /* ── Accent — SIGNAL AMBER (the one divergence) ─────────────────────── */
  --app-accent:         #E0912F;   /* 6.85:1 on --app-panel — AA for all text sizes */
  --app-accent-strong:  #EFA544;
  --app-accent-soft:    #F0B96E;
  --app-accent-deep:    #B87322;
  --app-accent-bg:      rgba(224, 145, 47, 0.10);
  --app-accent-border:  rgba(224, 145, 47, 0.26);
  --app-glow:           rgba(224, 145, 47, 0.20);

  /* ── Primary action — dark ink on amber, 8.3:1 ──────────────────────── */
  --app-btn:            #E0912F;
  --app-btn-hover:      #EFA544;
  --app-btn-active:     #C97F22;
  --app-btn-text:       #1A1200;
  --app-btn-shadow:     rgba(224, 145, 47, 0.24);

  --app-on-accent:        #1A1200;
  --app-on-color:         #FFFFFF;
  --app-accent-chip-text: #1A1200;

  /* ── AI / advisory — the single metallic control (Law 8) ────────────── */
  --app-advisory:        #C08A4A;
  --app-advisory-soft:   #D6A468;
  --app-advisory-strong: #A06F33;
  --app-advisory-deep:   #85591F;
  --app-advisory-panel:  #A06F33;
  --app-advisory-border: rgba(192, 138, 74, 0.42);

  /* ── Status — unchanged from the Astrikos spec ──────────────────────── */
  --app-success:        #22B15C;
  --app-success-strong: #1B9A4E;
  --app-success-soft:   #4CC47E;
  --app-success-bg:     rgba(34, 177, 92, 0.13);
  --app-success-border: rgba(34, 177, 92, 0.30);
  --app-warning:        #D99B3C;
  --app-warning-soft:   #E5B060;
  --app-warning-strong: #B8801F;
  --app-warning-bg:     rgba(217, 155, 60, 0.13);
  --app-warning-border: rgba(217, 155, 60, 0.30);
  --app-danger:         #DC4A4A;
  --app-danger-soft:    #E86D6D;
  --app-danger-strong:  #B93535;
  --app-danger-bg:      rgba(220, 74, 74, 0.13);
  --app-danger-border:  rgba(220, 74, 74, 0.30);
  --app-info:           #5E9BD1;
  --app-info-soft:      #7FB2DF;
  --app-info-strong:    #4179AE;
  --app-info-bg:        rgba(94, 155, 209, 0.13);
  --app-info-border:    rgba(94, 155, 209, 0.30);

  /* ── Data series — validated, see §5. Never used for chrome. ────────── */
  --series-1: #3987E5;  --series-2: #D95926;  --series-3: #199E70;
  --series-4: #C98500;  --series-5: #D55181;  --series-6: #008300;
  --series-7: #9085E9;  --series-8: #E66767;

  /* ── Charts ─────────────────────────────────────────────────────────── */
  --app-chart-surface:        #1A1A1A;
  --app-chart-tooltip-bg:     #212121;
  --app-chart-tooltip-border: #3A3A3A;
  --app-chart-grid:           rgba(255, 255, 255, 0.055);
  --app-chart-axis:           rgba(255, 255, 255, 0.12);

  /* ── Elevation — light, never outline (Law 1) ───────────────────────── */
  --app-shadow-xs:  0 1px 2px rgba(0, 0, 0, 0.55);
  --app-shadow-sm:  0 2px 8px rgba(0, 0, 0, 0.42);
  --app-shadow-md:  0 6px 20px rgba(0, 0, 0, 0.40);
  --app-shadow-lg:  0 18px 48px rgba(0, 0, 0, 0.52);
  --app-edge-light: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  /* ── Tinted callout cards ───────────────────────────────────────────── */
  --app-modal-success-bg:  #102418;  --app-modal-success-border:  #1D4A30;
  --app-modal-warning-bg:  #261C0D;  --app-modal-warning-border:  #4A3717;
  --app-modal-danger-bg:   #271212;  --app-modal-danger-border:   #4D2222;
  --app-modal-info-bg:     #141D26;  --app-modal-info-border:     #26384A;
  --app-modal-accent-bg:   #251A0C;  --app-modal-accent-border:   #4A3517;

  /* ── Layout ─────────────────────────────────────────────────────────── */
  --app-sidebar-w:  248px;
  --app-header-h:   64px;
  --app-footer-h:   32px;

  /* ── §1.0 chrome stops — amber-warmed metal, for dark ground ────────── */
  --astk-metal-1: #FFFFFF;  --astk-metal-2: #E4D9C6;  --astk-metal-3: #A89578;
  --astk-metal-4: #F8F5EE;  --astk-metal-5: #C4B391;  --astk-metal-6: #7A6A4C;
  --astk-metal-7: #D8CBB2;  --astk-metal-8: #94835F;
  --astk-metal-bevel: rgba(255, 255, 255, 0.55);

  --app-pattern-opacity: 0.05;
  --app-pattern-stroke:  #E0912F;
}
```

## 3 · Tokens — light theme

De-tinted from the Astrikos light block: the violet cast is removed and the neutrals
become warm graphite, consistent with the same decision that removed periwinkle.

```css
:root[data-theme='light'] {
  --app-bg:             #F5F4F2;
  --app-chrome-bg:      #FFFFFF;
  --app-panel:          #FFFFFF;
  --app-surface:        #FFFFFF;
  --app-surface-soft:   #FAF9F7;
  --app-surface-raised: #EFEDE9;
  --app-bg-elevated:    #FFFFFF;

  --app-border:         #E4E1DC;
  --app-border-soft:    #EEECE8;
  --app-border-strong:  #CFCBC4;
  --app-panel-border:   #E7E4DF;

  --app-text:           #262523;   /* de-tinted carbon */
  --app-text-muted:     #56544F;
  --app-text-faint:     #85817A;

  /* Amber darkened to hold AA on paper — 5.19:1 on #FFFFFF */
  --app-accent:         #A15C0F;
  --app-accent-strong:  #8A4E0A;
  --app-accent-soft:    #C07A22;
  --app-accent-deep:    #6E3D06;
  --app-accent-bg:      rgba(161, 92, 15, 0.075);
  --app-accent-border:  rgba(161, 92, 15, 0.22);
  --app-glow:           rgba(161, 92, 15, 0.15);

  --app-btn:            #262523;   /* light-mode primary is ink, per the Astrikos pattern */
  --app-btn-hover:      #3A3835;
  --app-btn-active:     #171614;
  --app-btn-text:       #FFFFFF;
  --app-btn-shadow:     rgba(38, 37, 35, 0.22);

  --app-on-accent:        #FFFFFF;
  --app-on-color:         #FFFFFF;
  --app-accent-chip-text: #FFFFFF;

  --app-advisory:        #8A5A1E;
  --app-advisory-soft:   #A87438;
  --app-advisory-strong: #6E4514;
  --app-advisory-deep:   #533310;
  --app-advisory-panel:  #6E4514;
  --app-advisory-border: rgba(138, 90, 30, 0.38);

  /* Status darkened for paper, per the Astrikos light block */
  --app-success: #0A8F42;  --app-success-strong: #077535;  --app-success-soft: #2FA45F;
  --app-success-bg: rgba(10,143,66,0.09);   --app-success-border: rgba(10,143,66,0.26);
  --app-warning: #9A6512;  --app-warning-soft: #B8791A;    --app-warning-strong: #7A4F0C;
  --app-warning-bg: rgba(154,101,18,0.09);  --app-warning-border: rgba(154,101,18,0.26);
  --app-danger:  #BE2E2E;  --app-danger-soft: #D14545;     --app-danger-strong: #9C2323;
  --app-danger-bg: rgba(190,46,46,0.08);    --app-danger-border: rgba(190,46,46,0.24);
  --app-info:    #2F6FBF;  --app-info-soft: #4B87D1;       --app-info-strong: #22558F;
  --app-info-bg: rgba(47,111,191,0.08);     --app-info-border: rgba(47,111,191,0.24);

  --series-1: #2A78D6;  --series-2: #EB6834;  --series-3: #1BAF7A;
  --series-4: #EDA100;  --series-5: #E87BA4;  --series-6: #008300;
  --series-7: #4A3AA7;  --series-8: #E34948;

  --app-chart-surface:        #FFFFFF;
  --app-chart-tooltip-bg:     #FFFFFF;
  --app-chart-tooltip-border: #CFCBC4;
  --app-chart-grid:           rgba(38, 37, 35, 0.09);
  --app-chart-axis:           rgba(38, 37, 35, 0.16);

  --app-shadow-xs:  0 1px 2px rgba(38, 37, 35, 0.06);
  --app-shadow-sm:  0 2px 8px rgba(38, 37, 35, 0.07);
  --app-shadow-md:  0 6px 20px rgba(38, 37, 35, 0.09);
  --app-shadow-lg:  0 18px 48px rgba(38, 37, 35, 0.14);
  --app-edge-light: inset 0 1px 0 rgba(255, 255, 255, 0.9);

  --astk-metal-1: #8A7F68;  --astk-metal-2: #554C38;  --astk-metal-3: #3A3222;
  --astk-metal-4: #A2977E;  --astk-metal-5: #4E4632;  --astk-metal-6: #2B2518;
  --astk-metal-7: #786E56;  --astk-metal-8: #423A28;
  --astk-metal-bevel: rgba(255, 255, 255, 0.30);

  --app-pattern-opacity: 0.06;
  --app-pattern-stroke:  #A15C0F;
}
```

**Default theme is dark.** A command room is dark; light mode exists because the
Astrikos spec makes both themes mandatory (Law/rule 6), and because a printed or
projected scorecard needs it.

---

## 4 · Accent versus warning

`--app-accent` (`#E0912F`) and `--app-warning` (`#D99B3C`) are adjacent in hue. Three
rules keep them from being confused. All three are checkable in review.

1. **Accent never appears on a status surface.** No amber accent inside a status chip,
   badge, alert bar, priority marker or KPI threshold indicator. Those use status
   tokens only.
2. **Warning never appears on chrome.** No warning token on a nav item, a focus ring,
   a primary button, a tab underline or a selection highlight. Those use accent only.
3. **They never appear adjacent in a legend or a key.** If a legend would place them
   side by side, the warning entry is re-encoded with its icon and label carrying the
   meaning, and its swatch is dropped.

Consequence: seeing amber tells you *where you are* (chrome) or *that something needs
attention* (status), and the surface it sits on always disambiguates which.

---

## 5 · Data visualisation

### 5.1 Categorical series — validated, do not substitute by eye

The eight-slot order below passes every gate of the palette validator in **both**
modes on the adjacent pairlist (bars, stacked bars, lines, areas):

| Slot | Hue | Dark | Light |
|---|---|---|---|
| 1 | blue | `#3987E5` | `#2A78D6` |
| 2 | orange | `#D95926` | `#EB6834` |
| 3 | aqua | `#199E70` | `#1BAF7A` |
| 4 | yellow | `#C98500` | `#EDA100` |
| 5 | magenta | `#D55181` | `#E87BA4` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#9085E9` | `#4A3AA7` |
| 8 | red | `#E66767` | `#E34948` |

Verified: dark adjacent — worst CVD ΔE 8.4, worst normal-vision ΔE 19.3, all ≥ 3:1 on
`#1A1A1A`. Light adjacent — worst CVD ΔE 9.1, worst normal-vision ΔE 19.6.

**Series cap for all-pairs forms.** Scatter, bubble, choropleth and small multiples put
every pair on screen simultaneously. Only the **first three slots** clear the all-pairs
gates (dark: worst CVD ΔE 9.4, normal-vision ΔE 20.9). Past three in those forms: fold
to "Other", or facet. This is measured, not a preference — a four-slot all-pairs run
puts yellow beside orange and fails.

> **On blue and violet in the series palette.** The brief was no violet and no bluish
> *chrome* — which is honoured absolutely: no surface, border, nav, button, focus ring
> or accent in this system carries a blue or violet cast. The **series** palette is a
> different job. Removing the two most separable hues from a categorical palette
> measurably harms colour-blind readers, and there is no amber-anchored eight-hue
> alternative that clears the gates (candidate sets were run and failed). If you want
> blue and violet out of charts too, say so and the consequence is a hard cap of three
> or four series everywhere, with faceting instead of multi-series charts.

### 5.2 Sequential and diverging

- **Sequential** (magnitude: heat surfaces, risk cells, choropleths): one hue,
  light → dark, from the blue ramp. A second simultaneous sequential context uses the
  orange ramp. Never a rainbow.
- **Diverging** (polarity: forecast error, rank movement, period-over-period delta):
  blue ↔ red with a **neutral grey midpoint** (`#383835` dark / `#F0EFEC` light). Never
  a hue at the midpoint.

### 5.3 Agency identity — glyph first, colour second

Five or more agencies appear on the shared incident view simultaneously. Measured: no
five-hue set clears the all-pairs CVD gate. Therefore:

**Agency identity is carried by a distinct icon and a label. Colour is reinforcement
and is never the only encoding.**

| Agency | Glyph (lucide) | Series slot |
|---|---|---|
| DCAS · Ambulance 998 | `ambulance` | 8 red |
| Police 999 | `shield` | 1 blue |
| Civil Defence 997 | `flame` | 2 orange |
| Coastguard 996 | `anchor` | 7 violet |
| RTA · Transport | `traffic-cone` | 4 yellow |
| Municipality | `trash-2` | 6 green |
| DEWA · Utility | `zap` | 5 magenta |
| DHA · Health | `hospital` | 3 aqua |

### 5.4 Incident priority

Priority is a status scale, not a categorical one. It is **not** encoded by four hues.

| Priority | Encoding |
|---|---|
| **P1** life-threatening | `--app-danger` solid fill · larger marker · a single slow pulse ring · label "P1" |
| **P2** emergency | `--app-danger` 2px ring, `--app-panel` core · no pulse · label "P2" |
| **P3** urgent | `--app-info` solid · standard marker · label "P3" |
| **P4** routine | `--app-text-faint` solid · small marker · label "P4" |

Every priority marker carries its label. The pulse honours `prefers-reduced-motion` by
becoming a static double ring.

### 5.5 Chart rules carried into every component

- Thin marks. 2px lines. ≥ 8px point markers. 4px rounded data-ends anchored to the
  baseline. A 2px surface-coloured gap between stacked segments and adjacent bars.
- **One y-axis. Never two.** Two measures of different scale become two charts, small
  multiples, or an indexed common base.
- Colour follows the entity, never its rank. Filtering out a series must not repaint
  the survivors.
- Text wears text tokens, never the series colour.
- A legend is present for ≥ 2 series; ≤ 4 series are also direct-labelled. One series
  needs no legend — the title names it.
- Grid and axes recede: `--app-chart-grid`, `--app-chart-axis`.
- **Hover is default, not an extra.** Crosshair + tooltip on line and area; per-mark
  tooltip on bar, dot and cell. The only exception is a bare KPI tile with no plot.
- All figures use tabular lining numerals:
  `font-variant-numeric: tabular-nums lining-nums`.
- Every chart has a table view behind a toggle — this is the relief for any contrast
  warning and the accessibility floor.

### 5.6 The chart set actually needed

Specified so that nobody invents a fifteenth chart type at 2am.

| Form | Used for |
|---|---|
| Stat tile / hero number | Single KPI with trend and target |
| Horizontal bar | Zone rankings, event-type top/bottom ten |
| Stacked horizontal bar | Response-time stage decomposition (the waterfall) |
| Line with band | Forecast vs actual with 80% interval |
| Small multiples line | Per-zone trend comparison |
| Step line | Unit status over a shift |
| Dot plot | Period-over-period comparison, before/after re-baselining |
| Histogram | ETA error distribution |
| Gantt / timeline bar | Incident stage timeline, per-agency SLA strip |
| Heat grid (hour × day) | Demand by hour-of-week |
| Map choropleth | Zone metric on the map |
| Map heat surface | Incident density, risk terrain, crowd density |

No pie charts, no donuts, no radar, no 3D anything, no dual-axis.

---

## 6 · Typography

Unchanged from the Astrikos specification, self-hosted.

| Family | Stack | Used for |
|---|---|---|
| **Lexend Deca** | `'Lexend Deca', system-ui, sans-serif` | Every heading, page title, eyebrow, nav section label, KPI value, tab label, avatar initial, the logo lockup |
| **Lato** | `'Lato', system-ui, -apple-system, sans-serif` | Every paragraph, table cell, input, button label, chip, helper text |
| **JetBrains Mono** | `'JetBrains Mono', ui-monospace, monospace` | Incident refs, unit callsigns, Makani codes, log lines, audit hashes only |

In-app sizes: page title 20/700 Lexend · page subtitle 12/400 · card title 12–13/700
Lexend · KPI value 26–32/700 Lexend · nav item 13/600 · nav section label 9.5/600
Lexend uppercase +0.15em · button 12–13/700 · input 12.5/400 · table header 10.5/700
uppercase +0.06em · table cell 12/400 · chip 9.5/700 uppercase +0.06em · helper 10/400.

**Mobile ramp is larger.** A phone held at arm's length in sunlight, by someone wearing
gloves, is not a 12px context. The `/app` surface steps everything up: body 15px,
labels 13px, primary action 17/700, the SOS button's label 20/700. Minimum touch target
**48px** on the mobile surface (above the 44px floor in the Astrikos spec) — a responder
acknowledging an assignment is doing it one-handed in a moving vehicle.

---

## 7 · Component notes specific to this product

The Astrikos §7 component specifications apply in full. These are the additions this
domain needs.

### 7.1 Incident card

The most-used object in the product. Fixed anatomy so it is recognisable everywhere:

```
┌────────────────────────────────────────────────┐
│ ▎P1  CARDIAC ARREST            INC-260916-0417 │  ← priority rail, kind, ref (mono)
│  Marina Pinnacle, Tower A · Floor 75           │  ← place, then vertical detail
│  Makani 2797 87586 · Entrance 1                │  ← mono
│  ⏱ 04:12  ·  AMB-14 en route  ·  ETA 02:40     │  ← elapsed (live), unit, ETA
│  ⟦ambulance⟧ ⟦shield⟧ ⟦flame⟧                  │  ← agencies engaged, glyphs
└────────────────────────────────────────────────┘
```

- The 3px left rail carries priority. The card surface never does — a red card is
  unreadable in a list of forty.
- Elapsed time counts up and is the only continuously animating element.
- The ETA figure is a prediction and is marked as one (a thin dotted underline that
  reveals the method and confidence on hover). It is never presented as fact.

### 7.2 Advisory card

Carries the Concept Note's two buttons and cannot be rendered without its evidence.

```
┌────────────────────────────────────────────────┐
│ ⚠ WARNING   Response time · Al Barsha          │
│                                                │
│ Acknowledge time in Al Barsha has risen 41 s   │
│ above the 30-day baseline across 214 dispatches│
│                                                │
│ ── evidence ──────────────────────────────     │
│ method   acknowledge-drift-ewma-v1             │
│ window   19 Aug – 16 Sep 2026  ·  214 records  │
│ sources  assignments · v_assignment_stages     │
│ factors  shift changeover +62%  ▇▇▇▇▇▇         │
│          unit type (MRU)      +21%  ▇▇         │
│          zone load            +17%  ▇          │
│ confidence  0.82                               │
│                                                │
│ [ Analyze ]              [ Act ]  ← metallic   │
└────────────────────────────────────────────────┘
```

**Act** is the single control in the entire product that wears the §1.0 metallic chrome
gradient. That is Law 8 honoured, and it makes the one button that creates an obligation
visually unique.

### 7.3 SLA timer strip

Per-agency, on the shared incident view. Each lane: agency glyph, name, notified-at,
acknowledged-at, elapsed, and a met/not-met state that uses success/danger *with a
label*, never colour alone.

### 7.4 Video-wall mode

A display density, not a separate app. Toggled from the Executive page, persisted per
device.

- Type ramp × 1.6; KPI values 48–64px
- No hover-dependent affordance anywhere — everything readable at 4 m
- Chrome dimmed, data bright; the surface ladder compresses to two levels
- Auto-rotate through configured tile groups on a timer, pausable
- The cursor hides after 5 s

### 7.5 Map styling

The map is part of the design system, not an exception to it. All deck.gl and MapLibre
colour comes from `shared/map/tokens.ts`, which resolves CSS custom properties to the
`[r,g,b,a]` arrays deck.gl needs. **No `[255, 140, 0]` literal anywhere in a layer
module.**

| Element | Treatment |
|---|---|
| Basemap | CARTO dark-matter, desaturated one further step so operational data dominates |
| Zone boundaries | `--app-border-strong` 1px; selected zone `--app-accent` 2px |
| Incident markers | Priority encoding from §5.4 |
| Units | Agency glyph in a `--app-panel` disc with a 2px agency-coloured ring; heading arrow; status by ring style (solid available, dashed relocating, pulsing responding) |
| Route proposed | `--app-accent` 3px, 60% opacity, dashed |
| Route taken | `--app-text` 3px solid |
| Preempt corridor | `--app-accent-bg` fill along the corridor, signals as amber diamonds when held |
| Risk / demand / crowd surfaces | Sequential blue ramp, `--app-chart-grid` graticule |
| Coverage rings | `--app-success-border` at target time, `--app-warning-border` at target + 2 min |
| Makani entrance | Small amber chevron pointing at the door, with the 10-digit code in mono |

---

## 8 · Motion

120–300 ms, `cubic-bezier(0.22, 1, 0.36, 1)`. Nothing bounces.

Three deliberate exceptions, each earned:

| Motion | Duration | Why it is allowed |
|---|---|---|
| P1 incident pulse | 2 s loop | A life-threatening call arriving must be noticed peripherally |
| Elapsed-time counters | continuous | It is a clock; a clock that does not move is broken |
| Unit movement on the map | interpolated to the position rate | Discrete jumps make a fleet unreadable |

All three degrade under `prefers-reduced-motion`: the pulse becomes a static double
ring, counters update per second without transition, units step instead of sliding.

---

## 9 · Self-audit

Run before any phase is reported complete. `npm run audit:theme` executes all of these
and fails the build on any hit.

```bash
# No colour literal outside theme.css
grep -rnE '#[0-9a-fA-F]{3,8}\b' web/src --include=*.{ts,tsx,scss,css} \
  | grep -v 'theme/theme.css'

# No rgb()/rgba() literal outside theme.css
grep -rnE 'rgba?\(' web/src --include=*.{ts,tsx,scss,css} | grep -v 'theme/theme.css'

# No forbidden font
grep -rniE "font-family:\s*['\"]?(Inter|Roboto|Open Sans|Poppins|Montserrat)" web/src

# No off-scale radius
grep -rnE 'border-radius:\s*(?!6px|8px|9px|10px|12px|14px|999px|50%|var\()' web/src

# No deck.gl colour array literal
grep -rnE '\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}' web/src/shared/map/layers

# No emoji used as an interface icon
# NOTE: grep -P fails with "supports only unibyte and UTF-8 locales" under Git Bash on
# Windows, which is the dev machine here. Use the node one-liner, which is portable:
node -e "const fs=require('fs'),p=require('path');const re=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,f.name);
if(f.isDirectory())w(q);else if(/\.tsx?$/.test(f.name)){fs.readFileSync(q,'utf8').split('\n')
.forEach((l,i)=>re.test(l)&&console.log(q+':'+(i+1)+': '+l.trim()))}}})('web/src')"

# No dual-axis chart
grep -rniE 'yAxisId|secondaryAxis|rightAxis' web/src

# No hard-coded host, IP or port
grep -rnE 'https?://(?!\$\{)[a-zA-Z0-9.-]+(:[0-9]+)?' web/src server \
  --include=*.{ts,tsx,js} | grep -v '.example'
```

Each must return nothing. In addition, before any phase is called done:

- [ ] Every screen verified in **both** themes
- [ ] Every screen verified at 1280px, 1920px, 3840px (video wall) and 390px (phone)
- [ ] Every chart's palette re-run through the validator if any hue changed
- [ ] Keyboard path through every interactive element, one visible focus ring style
- [ ] `prefers-reduced-motion` honoured on all three animating elements
- [ ] No screen renders a number without a unit or a timestamp without a timezone
