/**
 * The Dubai / UAE jurisdiction pack.
 *
 * Every jurisdiction-specific constant lives here: agencies, emergency numbers, the
 * administrative hierarchy, SLA defaults, response targets, clinical thresholds and the
 * escalation framework. A future India (ERSS-112) pack is a sibling file, not a rewrite
 * — see docs/00-DECISIONS.md D-01.
 *
 * Figures carry their source. Anything unsourced here is a modelling assumption and is
 * marked as one, because a number without provenance in an emergency system is a number
 * somebody will eventually quote in a tender.
 */

export const jurisdiction = {
  code: 'AE-DU',
  name: 'Emirate of Dubai',
  country: 'United Arab Emirates',
  timezone: 'Asia/Dubai',
  locale: 'en-AE',
  currency: 'AED',

  // Rough bounding box of the emirate, used to clamp generated geometry and to
  // reject obviously-wrong coordinates at the API boundary.
  bbox: { minLng: 54.85, minLat: 24.75, maxLng: 56.40, maxLat: 25.45 },
  centre: { lng: 55.2708, lat: 25.2048 },

  // ── Demography ────────────────────────────────────────────────────────────
  // Dubai Statistics Center, end 2025 / 2026. The daytime figure is the single
  // largest driver of spatial demand variation in the emirate.
  population: {
    resident: 4_580_000,
    daytime: 6_392_000,
    get influx() { return this.daytime - this.resident; },  // ≈1.812M
    daytimeWindow: { fromHour: 8, toHour: 18 },
    source: 'Dubai Statistics Center Population Bulletin',
  },

  // ── Agencies ──────────────────────────────────────────────────────────────
  agencies: [
    {
      code: 'DCAS', name: 'Dubai Corporation for Ambulance Services', short: 'Ambulance',
      emergencyNo: '998', glyph: 'ambulance', series: 8,
      isResponder: true, slaAckSec: 60, slaSceneSec: 480,
    },
    {
      code: 'POLICE', name: 'Dubai Police General Command', short: 'Police',
      emergencyNo: '999', glyph: 'shield', series: 1,
      isResponder: true, slaAckSec: 45, slaSceneSec: 360,
      // Dubai Police reported 5.8 min average emergency response in 2025 (target 6.6),
      // and 99% of 999 calls answered within 10 seconds.
      publishedResponseMin: 5.8,
    },
    {
      code: 'CIVIL_DEFENCE', name: 'Dubai Civil Defence', short: 'Civil Defence',
      emergencyNo: '997', glyph: 'flame', series: 2,
      isResponder: true, slaAckSec: 45, slaSceneSec: 420,
    },
    {
      code: 'COASTGUARD', name: 'Coastguard', short: 'Coastguard',
      emergencyNo: '996', glyph: 'anchor', series: 7,
      isResponder: true, slaAckSec: 90, slaSceneSec: 900,
    },
    {
      code: 'RTA', name: 'Roads and Transport Authority', short: 'Transport',
      emergencyNo: null, glyph: 'traffic-cone', series: 4,
      isResponder: false, slaAckSec: 120, slaSceneSec: 900,
    },
    {
      code: 'MUNICIPALITY', name: 'Dubai Municipality', short: 'Municipality',
      emergencyNo: null, glyph: 'trash-2', series: 6,
      isResponder: false, slaAckSec: 300, slaSceneSec: 1800,
    },
    {
      code: 'DEWA', name: 'Dubai Electricity and Water Authority', short: 'Utility',
      emergencyNo: null, glyph: 'zap', series: 5,
      isResponder: false, slaAckSec: 300, slaSceneSec: 1800,
    },
    {
      code: 'DHA', name: 'Dubai Health', short: 'Health',
      emergencyNo: null, glyph: 'hospital', series: 3,
      isResponder: false, slaAckSec: 120, slaSceneSec: null,
    },
    {
      code: 'NCEMA', name: 'National Emergency Crisis and Disaster Management Authority',
      short: 'NCEMA', emergencyNo: null, glyph: 'landmark', series: 1,
      isResponder: false, slaAckSec: 600, slaSceneSec: null,
    },
  ],

  // ── Administrative hierarchy ──────────────────────────────────────────────
  // Dubai is officially divided into NINE sectors, subdivided into communities.
  hierarchy: {
    levels: ['emirate', 'sector', 'community', 'beat'],
    labels: {
      emirate: 'Emirate', sector: 'Sector', community: 'Community', beat: 'Beat',
    },
    sectorCount: 9,
    communityCountReal: 226,     // official total; the seed models ~40
  },

  // ── Response targets ──────────────────────────────────────────────────────
  // DCAS open data (ambulance.gov.ae) + Dubai 10X.
  targets: {
    // 2024 actual, the current operating baseline
    currentMeanResponseSec: 395,           // 6.59 min
    // The headline operational target used for "within target" KPIs
    targetResponseSec: 480,                // 8 min — the industry reliability standard
    // The stated ambition. NOT a fleet-wide kinetic target: the research is explicit
    // that 4 minutes is a boundary condition for AI-driven community response, not
    // something a vehicle fleet reaches. Treated as aspirational in every KPI.
    ambitionResponseSec: 240,              // 4 min by 2033
    ambitionYear: 2033,
    // Critical-call median is materially worse than the fleet mean — see below.
    ohcaMeanResponseSec: 945,              // 15.75 min ± 8.55 (Dubai single-centre)
    ohcaMedianResponseSec: 540,            // ≈9.0 min (PAROS / GCC systematic review)
    source: 'ambulance.gov.ae open data; PAROS; Dubai 10X',
  },

  // Historical series — the seed's calibration anchor. See docs/09-DATA-AND-SEED §2.2.
  history: [
    { year: 2017, calls: 110_543, meanResponseMin: 6.20, patientCases: 115_160, malePct: 63.8 },
    { year: 2018, calls: 114_905, meanResponseMin: 6.18, patientCases: 119_336, malePct: 64.1 },
    { year: 2019, calls: 122_595, meanResponseMin: 7.29, patientCases: 127_166, malePct: 64.5 },
    { year: 2020, calls: 126_023, meanResponseMin: 10.28, patientCases: 131_383, malePct: 68.5, note: 'COVID-19' },
    { year: 2021, calls: 136_973, meanResponseMin: 9.51, patientCases: 141_658, malePct: 62.9 },
    { year: 2022, calls: 157_181, meanResponseMin: 8.55, patientCases: 163_744, malePct: 62.6 },
    { year: 2023, calls: 169_556, meanResponseMin: 7.49, patientCases: 179_767, malePct: 63.8 },
    { year: 2024, calls: 198_540, meanResponseMin: 6.59, patientCases: 208_889, malePct: 64.0 },
  ],

  // ── Dispatch behaviour ────────────────────────────────────────────────────
  dispatch: {
    acknowledgeTimeoutSec: 45,       // offer expires, re-dispatch runs, timeout measured
    // After this many automatic re-offers without an acknowledgement the system stops
    // cycling through the fleet and hands the incident back to a person. Modelling
    // assumption — an unbounded cascade is worse than a dispatcher being told.
    maxAutoRedispatch: 2,
    patientsPerDispatch: 1.05,       // derived: 4–6% of dispatches are multi-casualty
    malePatientShare: 0.64,
    mciThreshold: 5,                 // patient count that triggers the MCI package
    // The published weight vector of engines/dispatch.js (docs/08 §3.4). Visible on
    // every recommendation; sums to 1. Equity is a monitor until Phase 6.6 computes it.
    weights: { travel: 0.55, capability: 0.20, coverage: 0.15, crew: 0.10, equity: 0 },
    candidatePool: 12,               // nearest qualifying units scored per recommendation
    coverageRadiusM: 3000,           // "another unit could still cover here" — modelling assumption
    // "On scene" is stamped from the first position fix inside this radius, when the
    // unit reported one — not from when the crew remembered to press the button.
    onsceneProximityM: 100,
    // Unit kinds that answer a call only when the incident kind names them.
    nonPrimaryKinds: ['SUPERVISOR', 'AIR', 'MCU', 'MARINE'],
    // Unit kinds that reach a patient but cannot carry one. A rapid-response motorcycle
    // first on scene at a cardiac arrest is exactly right — and still needs an ambulance.
    nonTransportKinds: ['MRU', 'SUPERCAR', 'SUPERVISOR', 'PRV', 'FIRE', 'RESCUE'],
  },

  // ── Priorities ────────────────────────────────────────────────────────────
  priorities: [
    { code: 'P1', label: 'Life-threatening', targetSec: 480, share: 0.18 },
    { code: 'P2', label: 'Emergency',        targetSec: 720, share: 0.34 },
    { code: 'P3', label: 'Urgent',           targetSec: 1200, share: 0.36 },
    { code: 'P4', label: 'Routine',          targetSec: 2400, share: 0.12 },
  ],

  // ── Vertical Response Time ────────────────────────────────────────────────
  // The research establishes a 4–8 minute VRT penalty in Dubai's high-rise clusters —
  // comparable to, and sometimes exceeding, the vehicular drive time. This is the
  // "last hundred metres" problem made numeric. See docs/08 §3.2.
  vrt: {
    lobbyAccessSec: [60, 120],
    securityClearanceSec: [30, 180],   // 0 for villas and low-rise
    liftWaitSec: [45, 150],
    ascentSecPerFloor: 2.5,
    corridorFindSec: [30, 90],
    liftFailureMultiplier: 2.0,
    firefighterLiftWaitSec: 30,        // override when the building twin grants it
    highRiseFloorThreshold: 20,
    source: 'Dubai emergency response geospatial analysis, 2026',
  },

  // ── Traffic / preemption ──────────────────────────────────────────────────
  // ⚠ EVP is NOT verified as deployed in Dubai. Modelled as a proposed capability with
  // an international evidence base. See docs/10 SC-05.
  traffic: {
    signalisedIntersections: 620,      // RTA UTC-UX Fusion (Yutraffic)
    controlSystem: 'UTC-UX Fusion',
    evpDeployed: false,
    evpLeadTimeSec: 25,
    evpMaxHoldSec: 45,
    evpCorridorBufferM: 40,
    // Bounds for the modelled effect, cited on screen.
    evpEvidence: {
      travelTimeReductionPct: [10, 23],
      crashReductionPct: 58,
      sources: ['US signal preemption study', 'Minnesota DOT', 'St Paul MN longitudinal'],
    },
    failToYieldFineAed: 3000,          // 2025 federal traffic law, + 6 black points
    arterials: ['E11 Sheikh Zayed Road', 'E44 Al Khail Road',
                'E311 Sheikh Mohammed Bin Zayed Road', 'E611 Emirates Road'],
  },

  // ── Clinical thresholds ───────────────────────────────────────────────────
  clinical: {
    ohca: {
      bystanderCprRate: 0.2292,        // Dubai single-centre
      bystanderPresentRate: 0.75,
      bystanderAedRate: 0.03,          // GCC-wide, < 3%
      roscRate: 0.126,
      survivalWithBystanderCpr: 0.176,
      source: 'Memon/Soomar 2026 (Dubai); Al-Hajeri (regional); GCC reviews',
    },
    stroke: {
      thrombolysisWindowMin: 270,      // 4.5 h
      thrombectomyWindowMin: 360,
      rashidDoorToNeedleMin: 64.14,    // the improvement target
      preNotificationSavingMin: 9,     // published: D2N 29 → 20 min with EMS pre-alert
    },
    heat: {
      // MOHRE Occupational Heat Stress Prevention Policy
      midDayBanFromHour: 12.5, midDayBanToHour: 15,
      midDayBanSeason: { fromMonthDay: '06-15', toMonthDay: '09-15' },
      riseThresholdC: 40,
      spikeThresholdC: 48,
    },
  },

  // ── Escalation — NCEMA National Response Framework ────────────────────────
  escalation: {
    levels: [
      { code: 'LOCAL',    label: 'Agency',          authority: 'Responding agency' },
      { code: 'EMIRATE',  label: 'Emirate',         authority: 'Dubai SCEDM' },
      { code: 'NRF_L1',   label: 'National Level 1', authority: 'NCEMA' },
      { code: 'NRF_L2',   label: 'National Level 2', authority: 'Supreme Council for National Security' },
    ],
    emirateCommittee: 'Supreme Committee of Emergency, Crisis and Disaster Management (SCEDM)',
    // Thresholds are modelling assumptions — the NRF's real numeric triggers are not
    // published. Configurable in Admin.
    triggers: {
      emirate: { patients: 10, agencies: 3, durationMin: 60 },
      nrfL1:   { patients: 50, agencies: 5, crossEmirate: true },
      nrfL2:   { patients: 200, nationalImpact: true },
    },
    source: 'Federal Decree-Law 2/2011; NRF 2013; Dubai Executive Council 2024',
  },

  // ── Data classification — Dubai Data Law 26/2015 ──────────────────────────
  dataClassification: ['open', 'shared_confidential', 'shared_sensitive', 'shared_secret'],
};

/** Look up an agency definition by code. Throws rather than returning undefined —
 *  an unknown agency code is a programming error, not a runtime condition. */
export function agency(code) {
  const a = jurisdiction.agencies.find((x) => x.code === code);
  if (!a) throw new Error(`Unknown agency code: ${code}`);
  return a;
}

export const AGENCY_CODES = jurisdiction.agencies.map((a) => a.code);
