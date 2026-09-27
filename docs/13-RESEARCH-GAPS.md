# 13 · Research gaps and Gemini deep-research prompts

Ten prompts, ordered by how much the answer changes the build. Each is written to be
pasted into Gemini Deep Research as-is.

**How to use the results.** Save each report into `Research Documents/` with the prompt
reference in the filename (`R-01-dcas-statistics.md`). Anything that contradicts this
plan is a correction to make here first, then in the code — not a thing to discover
during the build.

**Two standing instructions to include in every one of these prompts** (they are already
written into each below):

- *Distinguish clearly between what you could verify from a primary or official source,
  what you found only in secondary reporting, and what you could not establish. Say "I
  could not find this" rather than inferring.*
- *Give exact figures with their date, their unit, and the definition being measured.
  Where two sources disagree, show both and say which is more authoritative and why.*

---

## R-01 · DCAS operational statistics and open data — **highest priority**

> Blocks: the seed calibration. There is an unresolved factor-of-two discrepancy in the
> source material ([09 §2](09-DATA-AND-SEED.md#2--calibration-targets-and-a-discrepancy-worth-flagging)).

```
I am building an operational analytics platform for the Dubai Corporation for
Ambulance Services (DCAS) and need to calibrate a simulated dataset to real published
figures. Research and report the following, with exact numbers, dates, units and the
precise definition of what is being measured in each case.

1. DCAS emergency call volume and response time, year by year, for as many years as
   are published (aim for 2018 to the present). For each year give: total emergency
   calls received, total emergencies responded to, average response time, and — if
   published — median and 90th-percentile response time.

2. CRITICAL — resolve this discrepancy. One source I have cites DCAS handling 110,543
   calls in 2024, 114,905 in 2025 and a projected 126,023 in 2026, with average
   response times of 6.20, 6.18 and 10.28 minutes. Other reporting states DCAS
   responded to more than 235,000 emergencies in 2023 and achieved roughly a 7-minute
   average response time in 2025, improving year on year. These cannot both describe
   the same measure. Determine what each figure actually counts (emergency calls vs
   total activity vs incidents vs patient contacts; emergency response vs including
   inter-facility transfer and non-emergency transport) and which is authoritative.

3. The Dubai Pulse open data portal (dubaipulse.gov.ae) hosts DCAS datasets including
   one referenced as "dcas_activity-open". For every DCAS dataset there: the exact
   name, the fields/columns it contains, its granularity (per incident, per day, per
   month), its date coverage, its update frequency, its format and API if any, and its
   licence. I need to know whether per-incident records with location and timestamps
   are publicly available.

4. ambulance.gov.ae publishes an Emergency Calls Statistics open-data page. Report
   exactly what it contains, at what granularity, and whether historical series are
   downloadable.

5. DCAS response time targets and the policy behind them: the Dubai 10X "Immediate
   Response" target, the stated 4-minute ambition and its target date, and any
   published intermediate milestones.

6. DCAS fleet composition, as published: number of ambulances by type (ALS, BLS,
   intensive care, bariatric), rapid response motorcycles, marine units, air ambulance,
   mass casualty units; number of ambulance stations and their distribution across
   Dubai.

7. DCAS case mix: the published breakdown of emergency call types (cardiac, trauma,
   road traffic collision, respiratory, obstetric, heat-related, etc.) with percentages
   or counts.

Distinguish clearly between what you verified from a primary or official source, what
came only from secondary reporting, and what you could not establish — say "I could not
find this" rather than inferring. Where sources disagree, show both and say which is
more authoritative and why.
```

---

## R-02 · Makani API — technical specification

> Blocks: the fidelity of the Makani integration seam and the entrance-level navigation
> that is the product's answer to the "last hundred metres" problem.

```
I need the full technical specification of Dubai Municipality's Makani geographic
addressing system, from a developer integration standpoint.

1. The Makani number itself: its exact structure, what each digit group encodes, how it
   relates to the UAE National Grid, its stated positional accuracy, and how it handles
   a building with multiple entrances.

2. The Makani Search API (I understand there is a version 2 with approximately 35
   endpoints). For each endpoint: its purpose, its path, its parameters, its response
   schema. I am specifically interested in: forward geocode (Makani number to
   coordinate), reverse geocode (coordinate to nearest Makani), entrance geometry,
   building footprint/polygon retrieval, and any transport-accessibility or routing
   endpoints.

3. Access: how a developer or an organisation obtains an API key, whether a test or
   sandbox key is available, what it costs, what the rate limits are, and what
   agreement or approval is required. Is access different for a UAE government entity
   than for a private company?

4. Coverage and currency: how many Makani points exist, whether off-plan and
   under-construction developments are included, and how often the dataset updates.

5. Is there any bulk or offline dataset — a downloadable extract, a WFS/WMS service,
   or an OGC endpoint — as opposed to per-query API access?

6. Indoor and vertical addressing: does Makani extend inside buildings (floor, unit),
   and is there a published roadmap for that? This matters for high-rise emergency
   response.

7. Any documented use of Makani by emergency services — Dubai Police, DCAS, Civil
   Defence — and any published evidence of its effect on response times.

Distinguish verified primary-source information from secondary reporting, and say
explicitly where you could not find something. Include exact endpoint paths and
parameter names where you can find them.
```

---

## R-03 · NABIDH integration — technical and regulatory

> Blocks: the fidelity of the clinical handoff, which is Pillar IV of the DCAS
> blueprint and the differentiator in scenarios SC-01 and SC-04.

```
I need the technical and regulatory specification for integrating a pre-hospital
emergency medical system with NABIDH, the Dubai Health Authority's health information
exchange.

1. NABIDH architecture: what it is, what data it holds, which facilities are connected,
   and whether connection is mandatory. What is the current participation rate?

2. Technical standards: the exact HL7 FHIR version and profiles used, which FHIR
   resources are supported (Patient, AllergyIntolerance, Condition,
   MedicationStatement, Observation, Encounter, DocumentReference), whether HL7 v2
   messaging is also in use and for what, and the transport and security (OAuth2,
   mTLS, SMART on FHIR?).

3. Patient identity: how Emirates ID is used as the identifier, the matching rules,
   and how a patient who cannot be identified at the scene is handled.

4. Consent: NABIDH's consent model, what break-glass or emergency-access provisions
   exist for pre-hospital emergency care, and what is audited.

5. Onboarding: the process for an organisation to connect, the certification or
   compliance testing required, whether a sandbox or test environment exists and how
   to obtain access, and the typical timeline.

6. Specifically for ambulance services: is there a published pattern, profile or
   precedent for an ambulance transmitting live telemetry (ECG, vitals) or a
   pre-arrival alert to a receiving hospital through NABIDH or alongside it? What does
   DCAS do today?

7. The regulatory frame: the DHA policies and UAE laws governing this, including the
   ICT Health Law (Federal Law 2/2019), data localisation requirements, and how the
   PDPL (Federal Decree-Law 45/2021) health-data and government carve-outs apply.

Distinguish verified primary-source information from secondary reporting. Include exact
document names, policy numbers and URLs where you find them, and say clearly where you
could not establish something.
```

---

## R-04 · Dubai reference geography and facilities

> Blocks: seed accuracy. Currently approximated.

```
I need accurate reference geography for Dubai for an emergency-response modelling
system.

1. Dubai's administrative geography: the official community (locality) list from Dubai
   Municipality — how many there are, their names and numbers, and whether boundary
   geometry is publicly downloadable (GeoJSON, shapefile, WFS). Include the sector or
   grouping level above communities if one is used officially.

2. Population by community, most recent official figures, with the year and source.
   Also: resident vs daytime population where published, since these differ enormously
   in Dubai's business districts.

3. Every hospital in Dubai with a 24-hour emergency department: name, exact location,
   operator (DHA public / private), ED bed count if published, and specialist
   capability — cardiac catheterisation lab, designated stroke centre, trauma centre
   and its level, paediatric ED, obstetric, burns unit, hyperbaric chamber.

4. DCAS ambulance station locations — as precise as is publicly available. Also Dubai
   Police station locations and Dubai Civil Defence station locations.

5. Public access defibrillator (AED) locations in Dubai: is there a published registry,
   how many are deployed, and where?

6. Dubai's high-rise building stock: how many buildings exceed 20, 50 and 80 floors,
   and where they are concentrated. Any published data on building entrance counts for
   major towers and mixed-use developments.

7. Road network: Dubai's primary arterial corridors, the number of signalised
   intersections, and any published traffic volume data by corridor and time of day.

8. Open data: what is available on dubaipulse.gov.ae and Dubai Municipality's GIS
   portal (geoportal or similar) that is directly downloadable and usable — list the
   datasets with their formats and licences.

Prioritise officially published, downloadable datasets over aggregated secondary
sources, and give the direct URL wherever one exists. Say explicitly where a dataset
does not appear to be public.
```

---

## R-05 · Dubai EMS clinical epidemiology

> Blocks: scenario clinical realism and the case-mix model in the seed.

```
I need the published clinical epidemiology of pre-hospital emergency care in Dubai and
the wider UAE, for realistic emergency-response modelling.

1. Out-of-hospital cardiac arrest in Dubai and the UAE: incidence, bystander CPR rate,
   bystander AED use rate, rate of shockable initial rhythm, return of spontaneous
   circulation rate, survival to hospital admission, survival to discharge, and
   neurologically intact survival. Give every study you find, with its sample size,
   period and setting, and note where they disagree.

2. EMS response time intervals published for Dubai or the UAE broken into stages: call
   handling, dispatch, activation/turnout, travel, on-scene, and transport.

3. Case mix of DCAS or UAE EMS emergency calls: the percentage breakdown by clinical
   category.

4. Road traffic collision epidemiology in Dubai: annual counts, fatality and serious
   injury numbers, the corridors and times of day with the highest incidence, and
   trends.

5. Heat-related illness: the seasonal pattern of heat exhaustion and heat stroke
   presentations in the UAE, the temperature thresholds at which incidence rises, and
   the occupational groups most affected.

6. Stroke and STEMI care in Dubai: door-to-needle and door-to-balloon times where
   published, which facilities are designated stroke and cardiac centres, and any
   published evaluation of pre-hospital notification's effect locally.

7. The ESEFNI volunteer first-responder programme run by DCAS: how it works, how many
   volunteers are registered, how volunteers are alerted and matched, and any published
   outcome data. Also any published evaluation of comparable programmes elsewhere
   (GoodSAM, HeartRunner, PulsePoint, Sweden's SMS-livräddare) with their measured
   effect on bystander CPR rates and survival.

Prioritise peer-reviewed sources and official statistics. For each figure give the
study or source, the period, the sample size and the setting. Where studies disagree,
present both and explain the likely reason.
```

---

## R-06 · Emergency vehicle preemption in Dubai

> Blocks: scenario SC-05's credibility, and the preemption effect size used in the
> model.

```
I need to understand emergency vehicle traffic signal preemption as it exists in Dubai
specifically, and the evidence base for its effect.

1. Dubai's traffic signal control system: which system the RTA operates (SCATS, SCOOT,
   or another), how many signalised intersections exist, and whether it is centrally
   controlled and to what degree.

2. Emergency vehicle preemption in Dubai: has the RTA deployed it? I have seen
   reporting that transmitters were to be fitted to Dubai ambulances. Establish what
   was actually deployed, when, on how many vehicles and intersections, what technology
   (GPS, optical/strobe, radio, or central software integration), and any published
   results.

3. Any published evaluation of its effect on DCAS response or transport times.

4. Documented evidence of the problem it addresses: reporting on ambulances delayed at
   Dubai traffic signals, including the specific accounts of delays near Rashid
   Hospital. Give dates and sources.

5. RTA policy on emergency vehicle priority: dedicated lanes, hard-shoulder use,
   penalties for failing to give way, and public awareness campaigns, with their
   measured results if published.

6. The international evidence base for EVP effect size: the measured reduction in
   travel time and in intersection-related collisions involving emergency vehicles,
   from peer-reviewed studies and transport authority evaluations. Give the effect
   sizes with their context, since these vary greatly by network density.

7. Whether there is any published API, protocol or integration pathway by which a
   third-party dispatch system could request signal preemption from the RTA.

Distinguish what you verified about Dubai specifically from general EVP literature.
Be explicit where Dubai-specific information does not appear to be public.
```

---

## R-07 · UAE multi-agency emergency coordination frameworks

> Blocks: the escalation rules and the NCEMA thresholds in the jurisdiction config.

```
I need the operational detail of how multi-agency emergency response is coordinated in
the UAE and specifically in Dubai.

1. NCEMA and the National Response Framework: the framework's structure, its escalation
   levels and the thresholds that trigger each, which agencies are involved at each
   level, and who has decision authority. Federal Decree-Law 2/2011 established NCEMA —
   what does it actually mandate?

2. Dubai's Supreme Committee of Crisis and Disaster Management: its composition, its
   authority, when it activates, and how it relates to NCEMA federally.

3. The emergency number architecture: 999 Police, 998 Ambulance, 997 Civil Defence,
   996 Coastguard. How are calls routed, are the control rooms integrated or separate,
   and is there a published plan to unify them? How does a caller who dials the wrong
   number get transferred, and how long does that take?

4. Dubai's integrated command and control centres: what exists, who operates them, and
   what systems they run.

5. Inter-agency information sharing: the legal and policy framework under Dubai Data Law
   (Law 26/2015) and the Dubai Data Committee's classification scheme. What
   classifications exist and what may be shared between which authorities under each?

6. Civil Defence: what Federal Decree-Law 35/2024 changed about the Civil Defence
   Authority's structure and responsibilities.

7. Published after-action reviews, lessons-learned reports or official evaluations of
   multi-agency response to any UAE incident — the April 2024 floods, major fires, mass
   casualty incidents. What coordination problems were officially identified?

8. Published KPIs or service standards for each emergency agency in Dubai, and whether
   any are measured across agencies for a single incident.

Prioritise official sources — government portals, published law, agency publications.
Distinguish verified from reported, and say where a document exists but is not public.
```

---

## R-08 · ISO 22320 and emergency response KPI definitions

> Blocks: BoQ-6 F3, which a tender evaluator will check first.

```
I need the specific content of ISO 22320 and the associated standards as they apply to
measuring emergency response performance.

1. ISO 22320:2018 (Security and resilience — Emergency management — Guidelines for
   incident management): its clause structure, and specifically what it requires or
   recommends regarding performance measurement, information management, command and
   control, and multi-agency cooperation. Which clauses can a dashboard KPI be mapped
   to?

2. Related standards in the family — ISO 22301, 22313, 22398 (exercises), 22322 (public
   warning), 22324 (colour-coded alerts) — and what each contributes to an emergency
   response platform's compliance story. ISO 22324's colour coding is directly relevant
   to how I signal severity.

3. Standard EMS response-time interval definitions: the internationally recognised
   definitions of call receipt, call answer, dispatch, activation/turnout, travel,
   on-scene, at-patient, and transport intervals. Utstein-style definitions where they
   exist. I need precise start and end events for each interval, because the whole
   product depends on measuring them consistently.

4. The Utstein template for out-of-hospital cardiac arrest reporting: the required data
   elements and time intervals.

5. Internationally used EMS performance benchmarks: response-time targets by priority
   in published systems (NHS Ambulance Response Programme categories and targets, NFPA
   1710, and any Gulf-region equivalents), and how they are defined and measured.

6. Whether ISO 22320 certification is achievable by a software vendor as opposed to an
   operating organisation, and what it actually attests to. (Relevant because the
   procurement specification I am working against requires the OEM to hold it.)

Give exact clause numbers and the standard's own wording where you can. Be clear where
a standard is paywalled and you are reporting secondary summaries.
```

---

## R-09 · Ambulance dispatch and positioning — algorithmic literature

> Blocks: whether the coverage and demand engines can be strengthened, and whether the
> D3QN approach in the feasibility study is worth reconsidering.

```
I am building the analytical layer of an emergency medical dispatch system and need a
rigorous review of the operations research and machine learning literature on ambulance
deployment.

1. Ambulance location and relocation models: the lineage from LSCM and MCLP through
   MEXCLP, MALP, the Double Standard Model, and dynamic relocation models. For each:
   what it optimises, what it assumes, its computational tractability, and the measured
   improvement reported in real deployments.

2. Deep reinforcement learning for ambulance dispatch and redeployment: the significant
   papers, what they achieve over OR baselines, what data volume they require to train,
   and — critically — how many have been deployed in production rather than in
   simulation. I need an honest read on whether DRL is production-ready here or still
   research.

3. EMS demand forecasting: the methods actually used in practice (Poisson and
   seasonal-Poisson models, kernel density, Gaussian mixture models, gradient boosting,
   LSTM), their reported accuracy, and the consensus on what beats what at what data
   volume. Is there evidence that complex models beat well-specified simple ones on
   this problem?

4. Travel time prediction for emergency vehicles: how lights-and-sirens travel differs
   from normal traffic, published speed multipliers, and the methods used to calibrate
   routing engine estimates to actual emergency response times.

5. Equity and bias in EMS resource allocation: the evidence that response times differ
   systematically by neighbourhood socioeconomics, the proposed fairness-aware
   objectives, and any real deployment of one.

6. Hospital destination selection and load balancing: models for distributing patients
   across receiving facilities, and the evidence on ambulance diversion's effects.

7. Crowd density and crowd-crush risk modelling: Fruin level-of-service, the more
   recent crowd dynamics literature, what is actually predictive of a crush, and what
   lead time is realistically achievable.

For each area, state the consensus, the strength of the evidence, and where practice
and research diverge. I am more interested in what actually works in deployed systems
than in what performs best in a paper.
```

---

## R-10 · Competitive and procurement landscape

> Blocks: positioning, and the compliance matrix's framing.

```
I need a competitive and procurement landscape assessment for emergency response
intelligence platforms, with a focus on the Gulf region.

1. The major vendors in computer-aided dispatch and emergency response for public
   safety: Hexagon Safety & Infrastructure, Motorola Solutions, Tyler Technologies,
   Central Square, NEC, Atos, Carbyne, RapidSOS, Corti, FirstDue. For each: what they
   actually sell, their analytics and AI capability, and their presence in the Gulf.

2. Who supplies Dubai's and the UAE's emergency services today — Dubai Police, DCAS,
   Civil Defence, the integrated command centres. Named systems and vendors where
   publicly known, and any publicly announced contracts or partnerships.

3. Recent UAE and Gulf tenders for emergency response, command and control, or public
   safety analytics platforms: what was specified, who won, and at what value, where
   public.

4. The "interoperability layer above existing command systems" positioning
   specifically: which vendors sell this rather than a replacement CAD, and how they
   position it. This is the positioning I am working with and I need to know who else
   claims it.

5. Published evidence on what actually reduces ambulance response times in dense
   cities: the interventions and their measured effect sizes — dynamic deployment,
   preemption, community first responders, telephone-CPR, demand management, alternative
   response models. Rank them by evidence quality.

6. AI in emergency dispatch, deployed rather than announced: Corti's call-analysis for
   cardiac arrest detection, automated triage, predictive deployment. What has published
   outcome data behind it?

7. Procurement requirements that recur in public safety tenders: certifications (ISO
   22320, ISO 27001, CMMI), reference deployment scale thresholds, on-premise and data
   sovereignty requirements, and COTS-versus-bespoke framing.

Be specific about what is verified versus announced versus marketed. Note where a vendor
claims a capability that has no published evidence behind it.
```

---

## Prompts for things you may want but that are not in scope

If any of these come back compelling, they change the plan and should be discussed
before building.

| Topic | Prompt seed |
|---|---|
| ESEFNI 2.0 volunteer network ([O-5](00-DECISIONS.md#open-items)) | Covered by R-05 §7. If the outcome evidence for GoodSAM-style networks is as strong as expected, reconsider adding a `volunteer` role to `/app`. |
| Arabic + RTL ([D-09](00-DECISIONS.md#d-09--language-english-only-i18n-ready)) | *"What are the specific requirements for Arabic-language government software interfaces in the UAE — is Arabic legally mandated for government-facing systems, what typefaces pair well with Latin sans-serifs, and what are the known pitfalls in RTL data tables, charts and maps?"* |
| Drone / air ambulance | *"What is the current state of air ambulance and drone-delivered AED programmes in the UAE, and what evidence exists for their effect on response times in dense urban and remote desert settings?"* |
| Telemedicine in the ambulance | *"What telemedicine capability do UAE ambulance services deploy today, what is the evidence for physician-in-the-loop pre-hospital care, and how is it integrated with hospital systems?"* |
