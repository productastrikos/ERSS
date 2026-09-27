/**
 * DSO Incident Simulator — 10 realistic smart-city incidents
 * Coordinates are approximate real locations inside Dubai Silicon Oasis.
 */
import type { Incident } from '../types';

export const INCIDENTS: Incident[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 1  Power Grid Failure / Transformer Overload
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'power_grid_failure',
    title:       'Power Grid Failure — Transformer Overload',
    shortTitle:  'Power Outage',
    icon:        '⚡',
    severity:    'critical',
    category:    'Power',
    zone:        'Infrastructure — Power Substation (South)',
    description: 'Transformer overheating at the DSO South Substation due to peak-load demand from Silicon Central Mall and adjacent towers.',
    sensors:     ['Transformer temperature sensor', 'Smart meter (load)', 'Voltage sensor', 'IoT gateway'],
    steps: [
      { icon: '🌡️', label: 'Power transformer temperature sensor triggers at 82 °C' },
      { icon: '📡', label: 'IoT gateway transmits alert to Power Monitoring System' },
      { icon: '🖥️', label: 'Power Monitoring System detects overload anomaly' },
      { icon: '🔔', label: 'Critical alert fired at command center' },
      { icon: '🗺️', label: 'Affected buildings highlighted on map — substation turns red' },
      { icon: '📞', label: 'Operations team notified via automated call-out' },
      { icon: '🚐', label: 'Maintenance crew dispatched to substation' },
      { icon: '⚙️', label: 'Transformer load redistributed to North Substation' },
      { icon: '✅', label: 'Temperature normalised — Incident resolved & logged' },
    ],
    roles: [
      { role: 'Power Grid Operator',     responsibility: 'Monitor electricity network in real time' },
      { role: 'Control Center Operator', responsibility: 'Confirm alert and coordinate response' },
      { role: 'Field Technician',        responsibility: 'Physically inspect transformer on site' },
      { role: 'Maintenance Engineer',    responsibility: 'Replace faulty components if required' },
    ],
    mapEffect: {
      type:      'power_outage',
      epicenter: [55.3861, 25.1115],
      radius:    320,
    },
    classification: {
      type:     'Infrastructure Failure',
      category: 'Power Grid',
      priority: 'P1',
      score:    95,
    },
    aiAdvisory: {
      riskLevel:  'CRITICAL',
      impacts:    [
        'Power outage risk to 3+ office towers',
        'Transformer permanent damage if unaddressed',
        'Fire hazard at substation',
        'HVAC & elevator shutdown in Smart Offices',
      ],
      actions:    [
        'Dispatch field technician to substation immediately',
        'Redistribute electrical load to North Substation',
        'Activate UPS & backup power for critical facilities',
        'Monitor transformer temperature every 30 seconds',
        'Alert building managers — prepare for brief outage',
      ],
      etaMinutes: 25,
      confidence: 94,
    },
    analytics: {
      cause:           'Cooling fan malfunction — thermal runaway triggered',
      impact:          'Power risk to 3 office towers; 4-min peak-load interruption',
      responseMinutes: 27,
      recommendation:  'Schedule preventive cooling system inspection monthly',
      priorityScore:   95,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2  Smart Street Light Failure
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'streetlight_failure',
    title:       'Smart Street Light Failure',
    shortTitle:  'Street Light Down',
    icon:        '💡',
    severity:    'medium',
    category:    'Lighting',
    zone:        'Villa Community — Semmer Villa Roads',
    description: 'Multiple smart street light poles reporting zero output in the Semmer villa grid. Motion-sensor based lights appear offline.',
    sensors:     ['Luminosity sensor', 'Motion sensor', 'IoT controller', 'City Lighting Platform'],
    steps: [
      { icon: '🔦', label: 'Streetlight sensor detects zero luminous output' },
      { icon: '📡', label: 'IoT controller reports lamp failure to City Lighting Platform' },
      { icon: '🔔', label: 'City Lighting Platform generates maintenance alert' },
      { icon: '🗺️', label: 'Faulty pole location highlighted on 3D map' },
      { icon: '🎫', label: 'Maintenance ticket auto-generated in CMMS' },
      { icon: '👷', label: 'Field technician assigned and dispatched' },
      { icon: '🔧', label: 'LED module and driver replaced on-site' },
      { icon: '✅', label: 'Light output confirmed normal — Ticket closed' },
    ],
    roles: [
      { role: 'City Operations Center', responsibility: 'Monitor lighting network dashboard' },
      { role: 'Facilities Manager',     responsibility: 'Assign technician and approve ticket' },
      { role: 'Technician',             responsibility: 'Replace faulty lamp on site' },
    ],
    mapEffect: {
      type:      'streetlight',
      epicenter: [55.3785, 25.1135],
      radius:    180,
    },
    classification: {
      type:     'Equipment Fault',
      category: 'City Lighting',
      priority: 'P3',
      score:    40,
    },
    aiAdvisory: {
      riskLevel:  'LOW',
      impacts:    [
        'Reduced road visibility on villa streets after dark',
        'Safety risk for pedestrians and cyclists',
        'Non-compliant lighting SLA if unresolved >4 hr',
      ],
      actions:    [
        'Dispatch city lighting technician to affected poles',
        'Replace LED module and driver board on-site',
        'Log repair in CMMS with photographic evidence',
        'Run luminosity verification test before sign-off',
      ],
      etaMinutes: 40,
      confidence: 89,
    },
    analytics: {
      cause:           'LED driver board failure — end of component lifecycle',
      impact:          'Reduced visibility on 2 villa road segments for 45 min',
      responseMinutes: 45,
      recommendation:  'Install remote-monitoring per pole; plan LED lifecycle refresh',
      priorityScore:   40,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3  Smart Waste Bin Overflow
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'waste_overflow',
    title:       'Smart Waste Bin Overflow Alert',
    shortTitle:  'Bin Overflow',
    icon:        '🗑️',
    severity:    'medium',
    category:    'Waste Management',
    zone:        'Residential — Silicon Gates Tower Block',
    description: 'Fill-level sensor on waste bins near Silicon Gates Towers exceeds 90 % threshold triggering collection dispatch.',
    sensors:     ['Fill-level ultrasonic sensor', 'Bin IoT node', 'Waste Management Platform'],
    steps: [
      { icon: '📊', label: 'Bin fill-level sensor reaches 90 % capacity' },
      { icon: '🖥️', label: 'Waste Management Platform detects overflow risk' },
      { icon: '🔔', label: 'Alert generated — bin icon turns red on map' },
      { icon: '🗺️', label: 'Route optimisation system calculates best truck path' },
      { icon: '🚛', label: 'Waste collection truck dispatched along optimal route' },
      { icon: '🗑️', label: 'Bin emptied and sensor registers 5 % fill level' },
      { icon: '✅', label: 'Sensor resets to normal — Incident closed' },
    ],
    roles: [
      { role: 'Waste Management Control Center', responsibility: 'Monitor bin status dashboard' },
      { role: 'Route Planner',                   responsibility: 'Optimise truck collection route' },
      { role: 'Waste Truck Driver',              responsibility: 'Collect waste along assigned route' },
    ],
    mapEffect: {
      type:      'waste',
      epicenter: [55.3903, 25.1148],
      radius:    150,
    },
    classification: {
      type:     'Capacity Breach',
      category: 'Waste Management',
      priority: 'P3',
      score:    38,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        'Bin overflow within 2 hours if uncollected',
        'Health & hygiene non-compliance',
        'Resident complaints — community service SLA breach',
      ],
      actions:    [
        'Dispatch waste collection truck via optimised route',
        'Suggested Route: Zone 3 → Zone 5 (18 % fuel saving)',
        'Empty all bins in the cluster, not just the overflowing one',
        'Log collection in Waste Management Platform for analytics',
      ],
      etaMinutes: 30,
      confidence: 91,
    },
    analytics: {
      cause:           'Higher-than-predicted foot traffic on weekend',
      impact:          'Near-overflow state for 2 hours; 0 reported complaints',
      responseMinutes: 35,
      recommendation:  'Increase collection frequency on weekends for cluster 3B',
      priorityScore:   38,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4  Fire Alarm in Building (BMS Incident)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'fire_alarm',
    title:       'Fire Alarm — BMS Emergency (DTEC)',
    shortTitle:  'Fire Alarm',
    icon:        '🔥',
    severity:    'critical',
    category:    'Fire Safety',
    zone:        'Tech District — DTEC Building',
    description: 'Smoke detector activation on Floor 3 of DTEC triggers BMS emergency protocol and DSO command center alert.',
    sensors:     ['Photoelectric smoke detector', 'Heat sensor', 'BMS controller', 'Fire Alarm System'],
    steps: [
      { icon: '💨', label: 'Photoelectric smoke detector activates on Floor 3' },
      { icon: '🔔', label: 'Building Fire Alarm System triggers audible alert' },
      { icon: '🖥️', label: 'BMS sends emergency alert with floor-level location' },
      { icon: '🗺️', label: 'Building model turns red on 3D map — evacuation zone drawn' },
      { icon: '🚨', label: 'Security team initiates floor evacuation' },
      { icon: '🚒', label: 'Civil Defence fire department dispatched' },
      { icon: '🧯', label: 'Fire suppressed using suppression system + crew' },
      { icon: '✅', label: 'All-clear confirmed — Building re-occupied after safety check' },
    ],
    roles: [
      { role: 'Security Team',    responsibility: 'Initiate evacuation and secure perimeter' },
      { role: 'Fire Department',  responsibility: 'Suppress fire and search building' },
      { role: 'Building Manager', responsibility: 'Coordinate BMS response and liaisons' },
    ],
    mapEffect: {
      type:      'fire',
      epicenter: [55.3769, 25.1215],
      radius:    220,
    },
    classification: {
      type:     'Life-Safety Emergency',
      category: 'Fire & BMS',
      priority: 'P1',
      score:    99,
    },
    aiAdvisory: {
      riskLevel:  'CRITICAL',
      impacts:    [
        'Immediate life-safety risk to building occupants',
        'Potential structural damage if not suppressed',
        'HVAC smoke-spread risk across multiple floors',
        'Business continuity disruption for DTEC tenants',
      ],
      actions:    [
        'Initiate full building evacuation via PA system immediately',
        'Dispatch Civil Defence (fire unit) — priority dispatch',
        'Shut down HVAC to prevent smoke propagation',
        'Activate automatic sprinkler suppression system',
        'Secure elevator shafts — use stairwells only',
      ],
      etaMinutes: 8,
      confidence: 97,
    },
    analytics: {
      cause:           'Electrical fault in Floor 3 server rack room',
      impact:          'Full building evacuation; 47 occupants evacuated safely',
      responseMinutes: 18,
      recommendation:  'Install rack-level suppression; increase cable management audits',
      priorityScore:   99,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5  Water Pipeline Leakage
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'water_pipe_leak',
    title:       'Water Pipeline Leakage',
    shortTitle:  'Pipeline Leak',
    icon:        '💧',
    severity:    'high',
    category:    'Water Network',
    zone:        'Infrastructure — Central Park Irrigation Main',
    description: 'Main irrigation pipe supplying the Central Park shows a 30 % pressure drop — possible burst joint near pumping station.',
    sensors:     ['Water pressure sensor', 'Flow-rate meter', 'Leak detection algorithm', 'SCADA system'],
    steps: [
      { icon: '📉', label: 'Water pressure sensor detects 30 % sudden pressure drop' },
      { icon: '🧮', label: 'Leak detection algorithm confirms anomaly pattern' },
      { icon: '🔔', label: 'Control center receives geo-located notification' },
      { icon: '🗺️', label: 'Leak location highlighted on map with water zone' },
      { icon: '🚰', label: 'Isolation valve closed — affected supply segment shut off' },
      { icon: '🚐', label: 'Repair crew dispatched with excavation equipment' },
      { icon: '🔧', label: 'Burst pipe joint repaired and reconnected' },
      { icon: '✅', label: 'Pressure restored — system returns to normal operation' },
    ],
    roles: [
      { role: 'Water Network Operator', responsibility: 'Monitor pressure and SCADA system' },
      { role: 'Maintenance Crew',       responsibility: 'Excavate and repair the burst pipe' },
      { role: 'City Operations',        responsibility: 'Coordinate water utility incident' },
    ],
    mapEffect: {
      type:      'water',
      epicenter: [55.3822, 25.1234],
      radius:    200,
    },
    classification: {
      type:     'Infrastructure Leak',
      category: 'Water Network',
      priority: 'P2',
      score:    72,
    },
    aiAdvisory: {
      riskLevel:  'HIGH',
      impacts:    [
        'Water loss >500 L/hr if valve not closed',
        'Ground subsidence risk near pumping station',
        'Irrigation failure for Central Park greenery',
        'Potential contamination of adjacent soil',
      ],
      actions:    [
        'Close isolation valve V-07 immediately via SCADA',
        'Dispatch water network repair crew with excavator',
        'Check neighbouring zones for secondary pressure loss',
        'Notify DSO Landscape Management of irrigation suspension',
      ],
      etaMinutes: 35,
      confidence: 88,
    },
    analytics: {
      cause:           'Corrosion-induced fatigue fracture at pipe joint J-14',
      impact:          'Irrigation suspended for 90 min; 12,000 L total water loss estimated',
      responseMinutes: 42,
      recommendation:  'Replace ageing pipes in Central Park main; install acoustic leak sensors',
      priorityScore:   72,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6  Drone Delivery Incident
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'drone_incident',
    title:       'Drone Delivery — Signal Loss Incident',
    shortTitle:  'Drone Signal Lost',
    icon:        '🚁',
    severity:    'high',
    category:    'Drone Mobility',
    zone:        'Smart District — Dubai Digital Park',
    description: 'Package delivery drone loses 5G control signal at 35 m altitude over Digital Park and switches to autonomous failsafe hover.',
    sensors:     ['GPS module', '5G signal strength monitor', 'IMU / altimeter', 'Drone fleet management system'],
    steps: [
      { icon: '📡', label: 'Drone navigation system detects control signal loss' },
      { icon: '🛡️', label: 'Failsafe activated — drone hovers at current altitude' },
      { icon: '🔄', label: 'Drone auto-attempts frequency reconnection' },
      { icon: '🔔', label: 'Control center alerted — drone icon flashes on map' },
      { icon: '🕹️', label: 'Flight supervisor switches to manual override mode' },
      { icon: '🛬', label: 'Drone guided to designated emergency landing pad' },
      { icon: '✅', label: 'Safe landing confirmed — incident report filed with GCAA' },
    ],
    roles: [
      { role: 'Drone Operations Team', responsibility: 'Monitor all active flights' },
      { role: 'Flight Supervisor',     responsibility: 'Execute manual override control' },
      { role: 'Safety Officer',        responsibility: 'Clear ground area and confirm safe landing' },
    ],
    mapEffect: {
      type:      'drone',
      epicenter: [55.3867, 25.1174],
      radius:    250,
    },
    classification: {
      type:     'Airspace Safety Incident',
      category: 'Drone Mobility',
      priority: 'P2',
      score:    68,
    },
    aiAdvisory: {
      riskLevel:  'HIGH',
      impacts:    [
        'Uncontrolled drone descent risk in populated area',
        'GCAA regulatory reporting obligation triggered',
        'Package loss or damage',
        'Airspace closure may affect other drone routes',
      ],
      actions:    [
        'Switch to manual override — activate radio backup frequency',
        'Clear 50m ground radius below hover point',
        'Guide drone to emergency pad EP-07 at Digital Park',
        'File GCAA incident report within 2 hours',
        'Run 5G signal diagnostics on affected corridor',
      ],
      etaMinutes: 15,
      confidence: 82,
    },
    analytics: {
      cause:           '5G signal dead-zone on Digital Park east side (known coverage gap)',
      impact:          'Package delivery delayed 20 min; no casualties or property damage',
      responseMinutes: 12,
      recommendation:  'Deploy 5G repeater on tower EP-4; update drone No-Fly zones',
      priorityScore:   68,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7  Traffic Congestion Incident
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'traffic_congestion',
    title:       'Traffic Congestion — Silicon Central Mall',
    shortTitle:  'Traffic Jam',
    icon:        '🚗',
    severity:    'medium',
    category:    'Traffic',
    zone:        'Commercial — Silicon Central Mall Intersection',
    description: 'Weekend peak-hour congestion building near the main mall intersection, causing 12-minute delays on approach roads.',
    sensors:     ['Vehicle-count sensors', 'Traffic cameras (CCTV)', 'Signal controller', 'Traffic analytics platform'],
    steps: [
      { icon: '📹', label: 'Traffic cameras detect vehicle density > 80 % threshold' },
      { icon: '🧮', label: 'Traffic analytics system calculates congestion index' },
      { icon: '🔔', label: 'Alert triggered — road segment turns red on map' },
      { icon: '🚦', label: 'Signal timing optimised — green phase extended 40 s' },
      { icon: '📞', label: 'Traffic police units notified via command center' },
      { icon: '👮', label: 'Traffic police deployed to manage critical intersections' },
      { icon: '✅', label: 'Congestion dissipated — road returns to normal flow' },
    ],
    roles: [
      { role: 'Traffic Control Center', responsibility: 'Monitor real-time road conditions' },
      { role: 'Traffic Police',         responsibility: 'Direct vehicles at congested junctions' },
      { role: 'Signal System',          responsibility: 'Adjust adaptive signal timing' },
    ],
    mapEffect: {
      type:      'traffic',
      epicenter: [55.3751, 25.1112],
      radius:    280,
      roadName:  'Innovation Hub Road',
    },
    classification: {
      type:     'Traffic Congestion',
      category: 'Road Network',
      priority: 'P3',
      score:    45,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        '12-min delay for inbound mall traffic',
        'Emergency vehicle access may be impeded',
        'Spill-back congestion to Innovation Hub Road',
      ],
      actions:    [
        'Extend green phase on approach signals by 40 seconds',
        'Activate Variable Message Signs — reroute via Gate 5',
        'Deploy 2 traffic police units to main intersection',
        'Monitor congestion index every 5 minutes',
      ],
      etaMinutes: 20,
      confidence: 86,
    },
    analytics: {
      cause:           'Weekend peak traffic volume + 2 event-day parking conflicts',
      impact:          '12-min average delay; 450 vehicles affected during peak 30 min',
      responseMinutes: 22,
      recommendation:  'Implement event-day parking shuttle; pre-activate adaptive signals',
      priorityScore:   45,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 8  Smart Irrigation System Optimisation
  // ──────────────────────────────────────────────────────────────────────────
  // 8  AQI Monitoring — High AQI Alert (AQI > 150)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'aqi_monitoring',
    title:       'High AQI Alert — Unhealthy Air Quality Detected',
    shortTitle:  'AQI Monitoring',
    icon:        '🌡️',
    severity:    'high',
    category:    'Environment',
    zone:        'DSO Central — Academic City Junction',
    description: 'Air Quality Index reaches 165 (Unhealthy) with elevated PM2.5 (85 µg/m³) and PM10 (145 µg/m³) near high-traffic areas. AI system validates anomaly and triggers environmental response protocol.',
    sensors:     ['AQI sensor network (20+ stations)', 'PM2.5 particulate sensor', 'PM10 sensor', 'CO2 sensor', 'NO2 sensor', 'Temperature/humidity sensor'],
    steps: [
      { icon: '📡', label: 'AQI sensor detects hazardous reading: AQI 165 (PM2.5: 85 µg/m³)' },
      { icon: '🤖', label: 'AI system validates anomaly — correlates with traffic density data' },
      { icon: '🗺️', label: 'Affected area turns RED on heatmap — 400m radius impact zone' },
      { icon: '🚨', label: 'Alert generated — blinking icon displayed on command center' },
      { icon: '💡', label: 'AI Advisory: Reduce traffic flow, activate pollution control measures' },
      { icon: '👤', label: 'Operator reviews advisory and approves recommended actions' },
      { icon: '🚦', label: 'Traffic signals adjusted to reduce congestion in affected zone' },
      { icon: '📢', label: 'Public health advisory issued via mobile app and display boards' },
      { icon: '📊', label: 'Pollution control activated — air purification systems engaged' },
      { icon: '✅', label: 'AQI drops to 125 (Moderate for Sensitive Groups) after 35 minutes' },
    ],
    roles: [
      { role: 'Environment Analyst',          responsibility: 'Monitor AQI in real-time across sensor network' },
      { role: 'AI Prediction Engine',         responsibility: 'Validate anomaly and predict pollution spread' },
      { role: 'Control Center Operator',      responsibility: 'Review AI advisory and approve actions' },
      { role: 'Traffic Management',           responsibility: 'Adjust signal timing to reduce congestion' },
      { role: 'Public Health Authority',      responsibility: 'Issue health advisory to residents' },
    ],
    mapEffect: {
      type:      'aqi_alert',
      epicenter: [55.3823, 25.1264],
      radius:    400,
    },
    classification: {
      type:     'Environmental Hazard',
      category: 'Air Quality / AQI Alert',
      priority: 'P2',
      score:    82,
    },
    aiAdvisory: {
      riskLevel:  'HIGH',
      impacts:    [
        'Health risk to sensitive groups (children, elderly, respiratory conditions)',
        'Outdoor activities should be limited in affected zone',
        'HVAC systems drawing outdoor air — indoor air quality degradation risk',
        'Traffic congestion contributing to sustained high pollution levels',
      ],
      actions:    [
        'Reduce traffic signal wait times by 20% to improve flow',
        'Reroute vehicles via alternate routes (Innovation Boulevard)',
        'Activate public pollution control systems in affected area',
        'Issue real-time health advisory via DSO mobile app',
        'Monitor AQI continuously — escalate if reaches 200 (Very Unhealthy)',
      ],
      etaMinutes: 35,
      confidence: 94,
    },
    analytics: {
      cause:           'High traffic congestion combined with low wind dispersion — elevated PM2.5 and NO2',
      impact:          'AQI "Unhealthy" for 35 min affecting ~2,500 residents and office workers',
      responseMinutes: 12,
      recommendation:  'Implement predictive traffic management during peak hours to prevent AQI spikes',
      priorityScore:   82,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 9  Weather Monitoring — Real-Time Weather & Prediction
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'weather_monitoring',
    title:       'Weather Monitoring — Extreme Heat Warning',
    shortTitle:  'Weather Alert',
    icon:        '⛅',
    severity:    'medium',
    category:    'Environment',
    zone:        'DSO-Wide — All Zones',
    description: 'Weather station network detects sustained temperature of 46°C with 68% humidity. AI prediction engine forecasts continued extreme heat for next 6 hours with potential heat stress risk.',
    sensors:     ['Weather station network', 'Temperature sensors', 'Humidity sensors', 'Wind speed/direction sensors', 'UV index sensors'],
    steps: [
      { icon: '🌡️', label: 'Weather sensors detect 46°C temperature with 68% humidity' },
      { icon: '🔮', label: 'AI prediction engine forecasts sustained heat for next 6 hours' },
      { icon: '⚠️', label: 'Heat stress risk calculation: HIGH — Heat Index 52°C (feels like)' },
      { icon: '🗺️', label: 'Heat zones displayed on map — urban heat island areas highlighted' },
      { icon: '💡', label: 'AI Advisory: Activate cooling strategies, reduce outdoor activities' },
      { icon: '💨', label: 'Smart building HVAC systems shift to maximum cooling mode' },
      { icon: '💧', label: 'Smart irrigation activated for green zones to cool urban surfaces' },
      { icon: '📢', label: 'Public heat warning issued — outdoor work restrictions advised' },
      { icon: '🏢', label: 'Building management notified to increase ventilation and cooling' },
      { icon: '✅', label: 'Temperature drops to 42°C after 4 hours — alert downgraded' },
    ],
    roles: [
      { role: 'Weather Monitoring System',    responsibility: 'Track real-time weather conditions' },
      { role: 'AI Prediction Engine',         responsibility: 'Forecast weather trends for next 24 hours' },
      { role: 'Environment Control Center',   responsibility: 'Coordinate heat mitigation strategies' },
      { role: 'Building Management Systems',  responsibility: 'Adjust HVAC to maintain comfort' },
      { role: 'Public Health Authority',      responsibility: 'Issue heat stress warnings' },
    ],
    mapEffect: {
      type:      'heat_zone',
      epicenter: [55.3870, 25.1245],
      radius:    800,
    },
    classification: {
      type:     'Environmental Alert',
      category: 'Weather / Extreme Heat',
      priority: 'P3',
      score:    65,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        'Heat stress risk for outdoor workers and vulnerable populations',
        'Increased energy demand for cooling — grid load spike expected',
        'Urban heat island effect amplifying temperatures in built-up areas',
        'Outdoor sports and construction activities should be limited',
      ],
      actions:    [
        'Activate all building HVAC systems to maximum cooling capacity',
        'Trigger emergency irrigation for parks and green corridors',
        'Issue public advisory limiting outdoor exposure between 12-4 PM',
        'Monitor power grid load — prepare demand response if needed',
        'Set up cooling stations in public areas for vulnerable individuals',
      ],
      etaMinutes: 240,
      confidence: 88,
    },
    analytics: {
      cause:           'Sustained high temperature with low wind speed — urban heat island effect',
      impact:          'DSO-wide heat stress risk for 4 hours; energy demand increased 18%',
      responseMinutes: 8,
      recommendation:  'Deploy additional green infrastructure to mitigate urban heat island effect',
      priorityScore:   65,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 10  Pollution Sources — Traffic-Induced NO2 Spike
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'pollution_sources',
    title:       'Pollution Source Alert — Traffic NO2 Spike',
    shortTitle:  'Pollution Sources',
    icon:        '🏭',
    severity:    'high',
    category:    'Environment',
    zone:        'Dubai Silicon Oasis Road — Main Corridor',
    description: 'NO2 sensors detect 95 µg/m³ concentration near DSO main road (threshold: 40 µg/m³). AI system links cause to high traffic density (285 vehicles/hour). Pollution plume animation shows spread pattern.',
    sensors:     ['NO2 electrochemical sensor', 'Traffic density sensors', 'CO sensor', 'Particle counter', 'Wind sensors'],
    steps: [
      { icon: '🚗', label: 'Traffic density reaches 285 vehicles/hour — exceeds typical flow' },
      { icon: '📡', label: 'NO2 sensor detects 95 µg/m³ — 2.4× over threshold (40 µg/m³)' },
      { icon: '🤖', label: 'AI system correlates high NO2 with traffic congestion pattern' },
      { icon: '🗺️', label: 'Road segment turns ORANGE on map — pollution plume visualized' },
      { icon: '💨', label: 'Wind direction applied — spread pattern calculated (south-east)' },
      { icon: '🚨', label: 'Alert raised: Traffic-induced air pollution event' },
      { icon: '💡', label: 'AI Advisory: Adjust traffic signals, reroute vehicles' },
      { icon: '🚦', label: 'Traffic management activates congestion relief protocol' },
      { icon: '🗺️', label: 'Alternate route via Academic City Road suggested to drivers' },
      { icon: '✅', label: 'NO2 drops to 52 µg/m³ after 28 minutes — congestion resolved' },
    ],
    roles: [
      { role: 'Pollution Monitoring System',  responsibility: 'Track NO2 and traffic-related pollutants' },
      { role: 'AI Causation Engine',          responsibility: 'Link pollution spike to traffic density' },
      { role: 'Traffic Control Center',       responsibility: 'Adjust signals to reduce congestion' },
      { role: 'Environment Agency',           responsibility: 'Document pollution event for compliance' },
      { role: 'Navigation Systems',           responsibility: 'Route drivers away from congested area' },
    ],
    mapEffect: {
      type:      'pollution_plume',
      epicenter: [55.3845, 25.1255],
      radius:    350,
    },
    classification: {
      type:     'Environmental Hazard',
      category: 'Air Pollution / Traffic Source',
      priority: 'P2',
      score:    76,
    },
    aiAdvisory: {
      riskLevel:  'HIGH',
      impacts:    [
        'Respiratory health risk from elevated NO2 exposure',
        'Traffic congestion causing sustained pollution event',
        'Wind carrying pollution toward residential areas (south-east direction)',
        'Potential regulatory non-compliance if sustained over 1 hour',
      ],
      actions:    [
        'Reduce traffic signal wait time by 25% on main corridor',
        'Reroute traffic via Academic City Road and Innovation Boulevard',
        'Issue real-time traffic advisory via mobile apps and road signs',
        'Activate roadside air purification systems if available',
        'Monitor NO2 continuously — escalate if exceeds 100 µg/m³',
      ],
      etaMinutes: 28,
      confidence: 91,
    },
    analytics: {
      cause:           'Traffic congestion (285 veh/hr) causing elevated NO2 emissions from vehicles',
      impact:          'NO2 spike affecting 350m radius zone for 28 min; ~800 people exposed',
      responseMinutes: 10,
      recommendation:  'Implement adaptive traffic signals to prevent congestion-related pollution',
      priorityScore:   76,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 11  AI Prediction — Wind-Driven Pollution Spread
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'ai_prediction',
    title:       'AI Prediction — Pollution Spread Forecast',
    shortTitle:  'AI Prediction',
    icon:        '🔮',
    severity:    'medium',
    category:    'Environment',
    zone:        'DSO Central → South-East Residential Zone',
    description: 'AI prediction engine detects pollution source (AQI 155) near industrial area. Wind direction (NW → SE at 18 km/h) will carry pollutants toward residential zones. Predicted impact in 45 minutes.',
    sensors:     ['Wind direction/speed sensors', 'AQI sensor network', 'Weather prediction models', 'AI dispersion calculator'],
    steps: [
      { icon: '🏭', label: 'Pollution source detected: AQI 155 near industrial zone' },
      { icon: '💨', label: 'Wind sensors: 18 km/h from north-west toward south-east' },
      { icon: '🤖', label: 'AI prediction: Pollution will reach residential area in 45 min' },
      { icon: '🗺️', label: 'Moving pollution cloud visualized — directional arrows displayed' },
      { icon: '⚠️', label: 'Predictive alert issued to affected residential zones' },
      { icon: '💡', label: 'AI Advisory: Pre-emptive action — close windows, activate air filters' },
      { icon: '🏢', label: 'Building management systems notified — switch to recirculation mode' },
      { icon: '📢', label: 'Residents receive push notification 30 minutes before impact' },
      { icon: '🌬️', label: 'Wind shift detected — pollution cloud redirects away from residential area' },
      { icon: '✅', label: 'Prediction updated — impact avoided due to wind change' },
    ],
    roles: [
      { role: 'AI Prediction Engine',         responsibility: 'Forecast pollution dispersion based on wind patterns' },
      { role: 'Wind Monitoring System',       responsibility: 'Track real-time wind speed and direction' },
      { role: 'Environment Control Center',   responsibility: 'Issue pre-emptive warnings to affected areas' },
      { role: 'Building Management Systems',  responsibility: 'Switch HVAC to recirculation to prevent intake' },
      { role: 'Resident Notification System', responsibility: 'Alert residents via mobile app' },
    ],
    mapEffect: {
      type:      'pollution_spread',
      epicenter: [55.3890, 25.1280],
      radius:    600,
    },
    classification: {
      type:     'Environmental Prediction',
      category: 'Air Quality / Wind Dispersion',
      priority: 'P3',
      score:    62,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        'Pollution cloud will reach residential zones in 45 minutes',
        'Estimated AQI in target area: 135 (Unhealthy for Sensitive Groups)',
        'Window of opportunity for pre-emptive action before impact',
        'Health risk to ~1,200 residents if no protective measures taken',
      ],
      actions:    [
        'Issue pre-emptive health advisory to south-east residential zones',
        'Notify building management to switch HVAC to recirculation mode',
        'Send mobile app push notifications to residents (close windows)',
        'Activate indoor air purification systems in affected buildings',
        'Monitor wind direction — update prediction if pattern changes',
      ],
      etaMinutes: 45,
      confidence: 85,
    },
    analytics: {
      cause:           'Industrial pollution source + north-west wind carrying pollutants SE',
      impact:          'Pre-emptive action taken — residential area impact avoided',
      responseMinutes: 15,
      recommendation:  'Deploy predictive wind-based pollution alerts for proactive health protection',
      priorityScore:   62,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 12  Environmental Alerts — Urban Heat Island Effect
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'environmental_alerts',
    title:       'Environmental Alert — Urban Heat Island Detected',
    shortTitle:  'Heat Island Alert',
    icon:        '🚨',
    severity:    'medium',
    category:    'Environment',
    zone:        'DSO Tech District — High-Density Building Zone',
    description: 'Temperature sensors detect localized hot zone (48°C) in high-density building area — 5°C higher than surrounding green zones. AI identifies urban heat island effect requiring cooling intervention.',
    sensors:     ['Temperature sensor network', 'Thermal imaging cameras', 'Surface temperature sensors', 'Building heat sensors'],
    steps: [
      { icon: '🌡️', label: 'Temperature sensors detect 48°C in tech district building cluster' },
      { icon: '🗺️', label: 'Thermal map shows 5°C differential vs. nearby park areas (43°C)' },
      { icon: '🤖', label: 'AI identifies urban heat island — high building density + low vegetation' },
      { icon: '🔴', label: 'Heat island zone highlighted in RED/ORANGE on environmental map' },
      { icon: '💡', label: 'AI Advisory: Deploy cooling strategies — increase green infrastructure' },
      { icon: '💨', label: 'Building HVAC systems activated to maximum external cooling' },
      { icon: '💧', label: 'Emergency irrigation activated for all available green spaces' },
      { icon: '🌳', label: 'AI recommends: Add shade structures, green roofs, reflective surfaces' },
      { icon: '📊', label: 'Temperature monitored — drops to 45°C after intervention' },
      { icon: '✅', label: 'Heat island intensity reduced by 3°C — alert status downgraded' },
    ],
    roles: [
      { role: 'Thermal Monitoring System',    responsibility: 'Track surface and air temperature variations' },
      { role: 'AI Heat Island Detector',      responsibility: 'Identify heat concentration zones' },
      { role: 'Urban Planning Department',    responsibility: 'Review heat island mitigation strategies' },
      { role: 'Building Management',          responsibility: 'Maximize cooling in affected buildings' },
      { role: 'Landscape Management',         responsibility: 'Activate cooling irrigation systems' },
    ],
    mapEffect: {
      type:      'heat_island',
      epicenter: [55.3910, 25.1220],
      radius:    450,
    },
    classification: {
      type:     'Environmental Concern',
      category: 'Climate / Heat Island',
      priority: 'P3',
      score:    58,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        'Localized heat concentration 5°C above surrounding areas',
        'Increased energy consumption for cooling in affected buildings',
        'Heat stress risk for pedestrians and outdoor workers',
        'Long-term structural heat stress on building materials',
      ],
      actions:    [
        'Activate maximum cooling capacity in all buildings in heat zone',
        'Deploy emergency irrigation for all green spaces to cool surfaces',
        'Install temporary shade structures in high-traffic pedestrian areas',
        'Long-term: Add green roofs, vertical gardens, reflective surfaces',
        'Monitor continuously — reassess if differential exceeds 6°C',
      ],
      etaMinutes: 90,
      confidence: 79,
    },
    analytics: {
      cause:           'High building density, low vegetation, heat-absorbing surfaces creating localized hot zone',
      impact:          'Heat island effect observed for 90 min; 18% higher cooling energy demand',
      responseMinutes: 12,
      recommendation:  'Implement green infrastructure plan to mitigate urban heat island formation',
      priorityScore:   58,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 13  Cybersecurity Alert (Tech Park)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'cyber_attack',
    title:       'Cybersecurity Alert — DSO HQ Network',
    shortTitle:  'Cyber Threat',
    icon:        '🛡️',
    severity:    'critical',
    category:    'Cybersecurity',
    zone:        'Tech District — DSO HQ Data Center',
    description: 'Anomalous lateral movement detected in DSO HQ internal network — possible APT intrusion targeting SCADA systems.',
    sensors:     ['IDS/IPS engine', 'SIEM platform', 'Network traffic analyser', 'Endpoint EDR'],
    steps: [
      { icon: '🚨', label: 'IDS engine detects unusual lateral movement in SCADA VLAN' },
      { icon: '🔔', label: 'SIEM platform correlates 47 events — alert severity: Critical' },
      { icon: '🕵️', label: 'SOC analyst begins triage and threat classification' },
      { icon: '🗺️', label: 'Affected assets highlighted on network topology map' },
      { icon: '🚫', label: 'Malicious IPs and accounts blocked / quarantined' },
      { icon: '🔒', label: 'Compromised network segment isolated' },
      { icon: '📋', label: 'Incident logged — forensic evidence preserved' },
      { icon: '✅', label: 'Threat neutralised — post-incident review scheduled' },
    ],
    roles: [
      { role: 'Security Operations Center (SOC)', responsibility: 'Investigate and triage threat' },
      { role: 'Network Security Engineer',        responsibility: 'Block traffic and isolate segment' },
      { role: 'CISO',                             responsibility: 'Decision authority on containment' },
    ],
    mapEffect: {
      type:      'cyber',
      epicenter: [55.3798, 25.1243],
      radius:    200,
    },
    classification: {
      type:     'Cybersecurity Intrusion',
      category: 'Network Security',
      priority: 'P1',
      score:    92,
    },
    aiAdvisory: {
      riskLevel:  'CRITICAL',
      impacts:    [
        'SCADA system compromise — operational technology at risk',
        'Potential data exfiltration of sensitive city infrastructure data',
        'Ransomware deployment risk if not contained',
        'Operational disruption to city-wide digital services',
      ],
      actions:    [
        'Immediately isolate SCADA VLAN from corporate network',
        'Block identified malicious IPs at perimeter firewall',
        'Invoke CISO authority for emergency containment',
        'Preserve forensic artefacts — do not wipe endpoints',
        'Notify Dubai Cyber Security Council within 2 hours',
      ],
      etaMinutes: 45,
      confidence: 91,
    },
    analytics: {
      cause:           'Spear-phishing attack on SCADA admin — credentials compromised',
      impact:          'Lateral movement contained; no data exfiltration confirmed',
      responseMinutes: 55,
      recommendation:  'Enforce MFA on all SCADA accounts; network micro-segmentation',
      priorityScore:   92,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 10  EV Charging Station Fault
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'ev_charging_fault',
    title:       'EV Charging Station Fault',
    shortTitle:  'EV Charger Fault',
    icon:        '🔌',
    severity:    'medium',
    category:    'Electric Mobility',
    zone:        'Commercial — Silicon Central Mall EV Parking',
    description: 'Two DC fast-chargers (50 kW) at the Silicon Central Mall parking level report ground-fault interrupt and communication failure.',
    sensors:     ['EVSE fault register', 'Ground-fault interrupt sensor', 'EV network management system (OCPP)'],
    steps: [
      { icon: '⚠️', label: 'Charging station EVSE reports fault code E-0x14' },
      { icon: '📡', label: 'OCPP message sent — EV network system logs fault' },
      { icon: '🔔', label: 'EV operations platform generates maintenance alert' },
      { icon: '🗺️', label: 'Faulty charger icon highlighted on DSO map' },
      { icon: '🚫', label: 'Station status set to FAULTED — drivers redirected' },
      { icon: '🚐', label: 'Certified EV technician dispatched to site' },
      { icon: '🔧', label: 'Ground-fault relay and communication module replaced' },
      { icon: '✅', label: 'Station back online — OCPP heartbeat confirmed' },
    ],
    roles: [
      { role: 'EV Operations Team', responsibility: 'Monitor charger network 24/7' },
      { role: 'EV Technician',      responsibility: 'On-site repair and recertification' },
      { role: 'Facilities Manager', responsibility: 'Coordinate parking access and signage' },
    ],
    mapEffect: {
      type:      'ev_fault',
      epicenter: [55.3894, 25.1170],
      radius:    160,
    },
    classification: {
      type:     'Equipment Fault',
      category: 'EV Infrastructure',
      priority: 'P3',
      score:    42,
    },
    aiAdvisory: {
      riskLevel:  'MEDIUM',
      impacts:    [
        '2 fast-chargers offline — EV drivers unable to charge',
        'Revenue loss from charger downtime',
        'Safety concern: ground-fault may indicate wiring issue',
        'SLA breach if not resolved within 4 hours',
      ],
      actions:    [
        'Set charger status FAULTED in OCPP network — redirect drivers',
        'Dispatch certified EV technician to Silicon Central Mall',
        'Run remote diagnostic via OCPP before site visit',
        'Replace ground-fault relay and comms module if confirmed',
        'Test OCPP heartbeat confirmation before signing off',
      ],
      etaMinutes: 50,
      confidence: 87,
    },
    analytics: {
      cause:           'Ground-fault relay failure + firmware communication bug',
      impact:          '2 chargers offline 50 min; 4 EV drivers redirected',
      responseMinutes: 52,
      recommendation:  'Schedule firmware updates quarterly; add redundant comms module',
      priorityScore:   42,
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 11  HVAC Failure — Dubai Digital Park
  // ──────────────────────────────────────────────────────────────────────────
  {
    id:          'hvac_failure',
    title:       'HVAC System Failure — Dubai Digital Park',
    shortTitle:  'HVAC Failure',
    icon:        '❄️',
    severity:    'high',
    category:    'BMS',
    zone:        'Dubai Digital Park — Tower B, Floors 4-8',
    description: 'Chiller unit trip at Dubai Digital Park Tower B has caused indoor temperatures to rise, threatening server room operations and occupant comfort.',
    sensors:     ['HVAC chiller temperature sensor', 'BACnet controller', 'Room temperature sensors (floor 4–8)', 'BMS gateway'],
    steps: [
      { icon: '🌡️', label: 'Chiller outlet temperature rises above 18 °C threshold' },
      { icon: '📡', label: 'BACnet BMS gateway transmits fault alarm to BMS dashboard' },
      { icon: '🖥️', label: 'Building Management System raises critical HVAC alert' },
      { icon: '🔔', label: 'Command centre operator notified — floors 4–8 highlighted' },
      { icon: '🗺️', label: 'Affected building zone shown on DSO Digital Twin map' },
      { icon: '📞', label: 'FM team alerted for emergency chiller inspection' },
      { icon: '🚐', label: 'HVAC technician dispatched to plant room' },
      { icon: '⚙️', label: 'Backup chiller activated; primary chiller inspected for fault' },
      { icon: '✅', label: 'Temperature stabilised at 21 °C — incident resolved' },
    ],
    roles: [
      { role: 'BMS Operator',           responsibility: 'Monitor thermal comfort KPIs in real time' },
      { role: 'Facilities Manager',     responsibility: 'Coordinate emergency HVAC response' },
      { role: 'HVAC Technician',        responsibility: 'Physical inspection of chiller unit' },
      { role: 'Server Room Admin',      responsibility: 'Monitor server inlet temperatures' },
    ],
    mapEffect: {
      type:      'hvac',
      epicenter: [55.3798, 25.1195],
      radius:    150,
    },
    classification: {
      type:     'Equipment Failure',
      category: 'HVAC / BMS',
      priority: 'P2',
      score:    72,
    },
    aiAdvisory: {
      riskLevel:  'HIGH',
      impacts:    [
        'Server room thermal runaway risk if unaddressed within 30 min',
        'Occupant discomfort — indoor temp rising above 26 °C',
        'Potential SLA breach for data centre operators',
        'Risk of secondary equipment damage due to heat',
      ],
      actions:    [
        'Activate backup chiller immediately',
        'Dispatch HVAC technician to plant room within 10 minutes',
        'Notify server room administrators to monitor inlet temps',
        'Reduce internal heat load — switch unused equipment to standby',
        'Alert building occupants floors 4–8 to expect reduced cooling',
      ],
      etaMinutes: 35,
      confidence: 89,
    },
    analytics: {
      cause:           'Chiller compressor fault caused by refrigerant pressure loss',
      impact:          'Floors 4–8 above-threshold for 35 min; server room reached 28 °C',
      responseMinutes: 38,
      recommendation:  'Schedule quarterly refrigerant level checks; add redundant chiller monitoring',
      priorityScore:   72,
    },
  },

];

/** Severity colours for badge rendering */
export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#FF2222',
  high:     '#FF6600',
  medium:   '#FFAA00',
  low:      '#00CC66',
};

/** Neon colour per incident effect type for map overlay */
export const EFFECT_COLOR: Record<string, string> = {
  fire:              '#FF2200',
  power_outage:      '#FF8C00',
  streetlight:       '#FFD700',
  waste:             '#FF6600',
  water:             '#00AAFF',
  drone:             '#AA44FF',
  traffic:           '#FF4400',
  irrigation:        '#00CC44',
  cyber:             '#CC00FF',
  ev_fault:          '#00E5FF',
  hvac:              '#00BFFF',
  air_pollution:     '#B8860B',
  aqi_alert:         '#FF6B35',  // Orange-red for AQI alerts
  heat_zone:         '#FF4500',  // Orange-red for extreme heat
  pollution_plume:   '#FFD700',  // Yellow for pollution plumes
  pollution_spread:  '#FFA500',  // Orange for pollution spread
  heat_island:       '#DC143C',  // Crimson for heat islands
};
