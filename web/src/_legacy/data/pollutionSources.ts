// Pollution Sources Data for DSO Environment Monitoring
// Track major pollution contributors (traffic hotspots, industrial zones)

export interface PollutionSource {
  id: string;
  name: string;
  location: [number, number]; // [lng, lat]
  type: 'traffic' | 'industrial' | 'construction' | 'hvac' | 'other';
  pollutants: {
    pm25: number; // µg/m³
    pm10: number; // µg/m³
    no2: number;  // µg/m³
    co2: number;  // ppm
    voc: number;  // ppb (volatile organic compounds)
  };
  emissionRate: 'low' | 'medium' | 'high' | 'critical';
  contributionPercent: number; // % contribution to overall DSO pollution
  activeHours: string; // e.g., "24/7", "06:00-22:00"
  affectedRadius: number; // meters
  trafficDensity?: number; // vehicles/hour (for traffic sources)
  industrialOutput?: string; // type of industrial activity
  mitigationStatus: 'none' | 'monitoring' | 'active' | 'resolved';
  timestamp: number;
  description: string;
}

export const pollutionSources: PollutionSource[] = [
  // TRAFFIC HOTSPOTS (Major contributors)
  {
    id: 'PM-TRAFFIC-001',
    name: 'Academic City Junction',
    location: [55.3823, 25.1264],
    type: 'traffic',
    pollutants: {
      pm25: 85,
      pm10: 145,
      no2: 95,
      co2: 450,
      voc: 120,
    },
    emissionRate: 'critical',
    contributionPercent: 18,
    activeHours: '06:00-23:00',
    affectedRadius: 400,
    trafficDensity: 285,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'High traffic congestion during peak hours. 285 vehicles/hour average. Major intersection with traffic signals.',
  },
  {
    id: 'PM-TRAFFIC-002',
    name: 'Tech Hub Roundabout',
    location: [55.3845, 25.1255],
    type: 'traffic',
    pollutants: {
      pm25: 78,
      pm10: 138,
      no2: 92,
      co2: 435,
      voc: 115,
    },
    emissionRate: 'critical',
    contributionPercent: 16,
    activeHours: '07:00-22:00',
    affectedRadius: 350,
    trafficDensity: 255,
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Busy commercial roundabout. Traffic rerouting implemented to reduce congestion.',
  },
  {
    id: 'PM-TRAFFIC-003',
    name: 'Transit Hub',
    location: [55.3860, 25.1275],
    type: 'traffic',
    pollutants: {
      pm25: 68,
      pm10: 122,
      no2: 86,
      co2: 438,
      voc: 108,
    },
    emissionRate: 'high',
    contributionPercent: 14,
    activeHours: '05:00-23:00',
    affectedRadius: 380,
    trafficDensity: 320,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Public transit interchange. High bus and vehicle traffic. Peak congestion 08:00-09:00 and 17:00-19:00.',
  },
  {
    id: 'PM-TRAFFIC-004',
    name: 'Highway Corridor',
    location: [55.3958, 25.1308],
    type: 'traffic',
    pollutants: {
      pm25: 72,
      pm10: 130,
      no2: 90,
      co2: 445,
      voc: 118,
    },
    emissionRate: 'critical',
    contributionPercent: 15,
    activeHours: '24/7',
    affectedRadius: 420,
    trafficDensity: 410,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Major highway access route. 24/7 traffic flow with peak loads during rush hours.',
  },
  {
    id: 'PM-TRAFFIC-005',
    name: 'Innovation Boulevard North',
    location: [55.3975, 25.1282],
    type: 'traffic',
    pollutants: {
      pm25: 72,
      pm10: 128,
      no2: 88,
      co2: 420,
      voc: 112,
    },
    emissionRate: 'high',
    contributionPercent: 13,
    activeHours: '06:00-22:00',
    affectedRadius: 360,
    trafficDensity: 240,
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Main commercial artery. Signal timing optimized to improve flow.',
  },

  // INDUSTRIAL ZONES (Continuous emissions)
  {
    id: 'PM-INDUSTRIAL-001',
    name: 'Manufacturing District',
    location: [55.3742, 25.1295],
    type: 'industrial',
    pollutants: {
      pm25: 70,
      pm10: 125,
      no2: 85,
      co2: 440,
      voc: 180,
    },
    emissionRate: 'critical',
    contributionPercent: 12,
    activeHours: '24/7',
    affectedRadius: 500,
    industrialOutput: 'Light manufacturing and assembly operations',
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Industrial manufacturing zone. Air filtration systems installed. Continuous monitoring.',
  },
  {
    id: 'PM-INDUSTRIAL-002',
    name: 'Energy Center',
    location: [55.3718, 25.1328],
    type: 'industrial',
    pollutants: {
      pm25: 75,
      pm10: 135,
      no2: 92,
      co2: 448,
      voc: 165,
    },
    emissionRate: 'critical',
    contributionPercent: 14,
    activeHours: '24/7',
    affectedRadius: 550,
    industrialOutput: 'Energy generation and distribution',
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Backup power generation facility. Peak emissions during grid load.',
  },
  {
    id: 'PM-INDUSTRIAL-003',
    name: 'Data Center Alpha',
    location: [55.3768, 25.1272],
    type: 'industrial',
    pollutants: {
      pm25: 60,
      pm10: 105,
      no2: 75,
      co2: 425,
      voc: 95,
    },
    emissionRate: 'high',
    contributionPercent: 8,
    activeHours: '24/7',
    affectedRadius: 320,
    industrialOutput: 'Data center cooling systems',
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Large-scale data center. HVAC cooling systems optimized for efficiency.',
  },
  {
    id: 'PM-INDUSTRIAL-004',
    name: 'Smart Factory Zone',
    location: [55.3735, 25.1315],
    type: 'industrial',
    pollutants: {
      pm25: 65,
      pm10: 115,
      no2: 80,
      co2: 430,
      voc: 155,
    },
    emissionRate: 'high',
    contributionPercent: 10,
    activeHours: '06:00-22:00',
    affectedRadius: 400,
    industrialOutput: 'Automated manufacturing and robotics',
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Smart manufacturing facility. Emissions controlled via automated systems.',
  },
  {
    id: 'PM-INDUSTRIAL-005',
    name: 'Logistics Hub',
    location: [55.3945, 25.1148],
    type: 'industrial',
    pollutants: {
      pm25: 62,
      pm10: 108,
      no2: 78,
      co2: 428,
      voc: 98,
    },
    emissionRate: 'high',
    contributionPercent: 9,
    activeHours: '24/7',
    affectedRadius: 380,
    industrialOutput: 'Warehouse and distribution operations',
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Logistics and warehouse complex. High diesel vehicle activity from delivery trucks.',
  },

  // CONSTRUCTION SITES (Temporary but high impact)
  {
    id: 'PM-CONSTRUCTION-001',
    name: 'New Tower Construction Site',
    location: [55.3835, 25.1285],
    type: 'construction',
    pollutants: {
      pm25: 55,
      pm10: 180,
      no2: 48,
      co2: 390,
      voc: 85,
    },
    emissionRate: 'high',
    contributionPercent: 6,
    activeHours: '07:00-19:00',
    affectedRadius: 250,
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Active construction site. Dust suppression measures in place. High PM10 from earthworks.',
  },
  {
    id: 'PM-CONSTRUCTION-002',
    name: 'Infrastructure Expansion',
    location: [55.3880, 25.1235],
    type: 'construction',
    pollutants: {
      pm25: 48,
      pm10: 165,
      no2: 42,
      co2: 375,
      voc: 78,
    },
    emissionRate: 'medium',
    contributionPercent: 5,
    activeHours: '07:00-18:00',
    affectedRadius: 220,
    mitigationStatus: 'active',
    timestamp: Date.now(),
    description: 'Road expansion project. Water spraying to minimize dust. Expected completion: Q2 2026.',
  },

  // HVAC SYSTEMS (Building emissions)
  {
    id: 'PM-HVAC-001',
    name: 'DSO HQ HVAC Complex',
    location: [55.3870, 25.1245],
    type: 'hvac',
    pollutants: {
      pm25: 28,
      pm10: 52,
      no2: 35,
      co2: 520,
      voc: 65,
    },
    emissionRate: 'medium',
    contributionPercent: 4,
    activeHours: '24/7',
    affectedRadius: 180,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Central HVAC system for DSO headquarters. High CO2 from cooling systems during peak heat.',
  },
  {
    id: 'PM-HVAC-002',
    name: 'Commercial Complex Cooling',
    location: [55.3858, 25.1288],
    type: 'hvac',
    pollutants: {
      pm25: 25,
      pm10: 48,
      no2: 32,
      co2: 495,
      voc: 58,
    },
    emissionRate: 'medium',
    contributionPercent: 3,
    activeHours: '08:00-22:00',
    affectedRadius: 160,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Retail and office complex HVAC. Peak load during afternoon heat.',
  },

  // OTHER SOURCES
  {
    id: 'PM-OTHER-001',
    name: 'Parking Structure Emissions',
    location: [55.3855, 25.1268],
    type: 'other',
    pollutants: {
      pm25: 38,
      pm10: 68,
      no2: 52,
      co2: 410,
      voc: 88,
    },
    emissionRate: 'medium',
    contributionPercent: 5,
    activeHours: '06:00-23:00',
    affectedRadius: 200,
    mitigationStatus: 'monitoring',
    timestamp: Date.now(),
    description: 'Multi-level parking structure. Vehicle idling and circulation. Poor ventilation.',
  },
];

// Helper functions
export const getSourcesByType = (type: PollutionSource['type']) =>
  pollutionSources.filter(s => s.type === type);

export const getCriticalSources = () =>
  pollutionSources.filter(s => s.emissionRate === 'critical');

export const getSourcesByMitigationStatus = (status: PollutionSource['mitigationStatus']) =>
  pollutionSources.filter(s => s.mitigationStatus === status);

export const getTotalContribution = (type?: PollutionSource['type']) => {
  const sources = type ? getSourcesByType(type) : pollutionSources;
  return sources.reduce((sum, s) => sum + s.contributionPercent, 0);
};

export const getEmissionRateColor = (rate: PollutionSource['emissionRate']): string => {
  switch (rate) {
    case 'low': return '#00E400';      // Green
    case 'medium': return '#FFFF00';   // Yellow
    case 'high': return '#FF7E00';     // Orange
    case 'critical': return '#FF0000'; // Red
  }
};

export const getSourceIcon = (type: PollutionSource['type']): string => {
  switch (type) {
    case 'traffic': return '🚗';
    case 'industrial': return '🏭';
    case 'construction': return '🏗️';
    case 'hvac': return '❄️';
    case 'other': return '⚠️';
  }
};

// Calculate total pollution contribution from all sources
export const calculateTotalPollution = () => {
  return {
    totalPM25: pollutionSources.reduce((sum, s) => sum + s.pollutants.pm25, 0),
    totalPM10: pollutionSources.reduce((sum, s) => sum + s.pollutants.pm10, 0),
    totalNO2: pollutionSources.reduce((sum, s) => sum + s.pollutants.no2, 0),
    totalCO2: pollutionSources.reduce((sum, s) => sum + s.pollutants.co2, 0),
    totalVOC: pollutionSources.reduce((sum, s) => sum + s.pollutants.voc, 0),
    criticalSourcesCount: getCriticalSources().length,
    activeSources: pollutionSources.filter(s => s.mitigationStatus !== 'resolved').length,
  };
};

export default pollutionSources;
