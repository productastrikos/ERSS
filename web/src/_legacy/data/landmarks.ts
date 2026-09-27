import type { Landmark } from '../types';

// ── Custom frontend buildings ─────────────────────────────────────────────────
// Buildings defined here are rendered directly in DSOMap without any API call.

export interface CustomBuilding {
  id:          string;
  name:        string;
  label:       string;                  // subtitle / use description
  coordinates: [number, number];        // center [lng, lat]
  polygon:     [number, number][];      // footprint ring (closed)
  height:      number;                  // metres
  color:       [number, number, number];// RGB
  hex:         string;                  // CSS hex derived from color
  icon:        string;
}

// No frontend-only custom buildings — The NEST is served by the local FastAPI
// at GET /buildings (routes/buildings.py, osm_id: -999001).
export const CUSTOM_BUILDINGS: CustomBuilding[] = [];

export const DSO_LANDMARKS: Landmark[] = [
  {
    id: 'dso-hq',
    name: 'Dubai Silicon Oasis HQ',
    coordinates: [55.3858, 25.1240],
    description: 'Headquarters of Dubai Silicon Oasis Authority – the free zone regulatory body.',
    category: 'Government',
  },
  {
    id: 'silicon-central',
    name: 'Silicon Central Mall',
    coordinates: [55.37460, 25.11064],  // real 2GIS confirmed location
    description: 'The premier shopping and entertainment destination inside DSO.',
    category: 'Retail',
  },
  {
    id: 'digital-park',
    name: 'Dubai Digital Park',
    coordinates: [55.3945, 25.1256],
    description: 'Home to major tech companies and innovation hubs in DSO.',
    category: 'Technology',
  },
  {
    id: 'rit-dubai',
    name: 'RIT Dubai',
    coordinates: [55.3792, 25.1293],
    description: 'Rochester Institute of Technology Dubai campus, offering STEM degrees.',
    category: 'Education',
  },
  {
    id:          'dtec',
    name:        'DTEC Campus',
    coordinates: [55.3848, 25.1159],
    description: 'Dubai Technology Entrepreneur Campus – a leading startup ecosystem.',
    category:    'Technology',
  },
  {
    id:          'the-nest',
    name:        'The NEST',
    coordinates: [55.37451698881499, 25.119650464879342],
    description: 'Dubai Innovation Center — a hub for tech startups and innovation programmes inside DSO.',
    category:    'Technology',
  },
];

// Category color mapping
export const CATEGORY_COLORS: Record<string, string> = {
  Government: '#00AEEF',
  Retail: '#FF6B6B',
  Technology: '#00D4AA',
  Education: '#FFD166',
  default: '#00AEEF',
};
