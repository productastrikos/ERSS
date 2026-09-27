/**
 * POI icon registration for MapLibre GL.
 * Generates colored circle + white SVG-symbol icons and loads them into the
 * map sprite so the symbol layer can use `icon-image`.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';

// ── Icon definitions ────────────────────────────────────────────────────────
// Each entry: unique name that will be used in icon-image expression,
// background colour, and an SVG path string (viewBox 0 0 24 24, fill="white").

const ICON_SIZE = 48; // canvas px

interface IconDef {
  name: string;
  bg: string;
  /** Full SVG inner markup (one or more <path> elements, fill="white") */
  markup: string;
}

// Material Design icon paths — viewBox 0 0 24 24
const DEFS: IconDef[] = [
  // ── Food & Drink ──────────────────────────────────────────────────────────
  {
    name: 'poi-restaurant',
    bg: '#E53935',
    markup: `<path fill="white" d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03
      C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>`,
  },
  {
    name: 'poi-cafe',
    bg: '#6D4C41',
    markup: `<path fill="white" d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2
      c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>`,
  },
  {
    name: 'poi-bar',
    bg: '#C62828',
    markup: `<path fill="white" d="M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9z"/>`,
  },
  // ── Health ────────────────────────────────────────────────────────────────
  {
    name: 'poi-pharmacy',
    bg: '#2E7D32',
    markup: `<path fill="white" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9
      2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>`,
  },
  {
    name: 'poi-hospital',
    bg: '#B71C1C',
    markup: `<path fill="white" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9
      2-2V5c0-1.1-.9-2-2-2zm-5 14h-2v-4H8v-2h4V7h2v4h4v2h-4v4z"/>`,
  },
  {
    name: 'poi-veterinary',
    bg: '#558B2F',
    markup: `<path fill="white" d="M4.5 9.5c.83 0 1.5-.67 1.5-1.5S5.33 6.5 4.5 6.5 3 7.17 3 8
      s.67 1.5 1.5 1.5zm3-4C8.33 5.5 9 4.83 9 4s-.67-1.5-1.5-1.5S6 3.17 6 4s.67 1.5 1.5
      1.5zm7 0C15.33 5.5 16 4.83 16 4s-.67-1.5-1.5-1.5S13 3.17 13 4s.67 1.5 1.5 1.5zm3
      4c.83 0 1.5-.67 1.5-1.5S18.33 6.5 17.5 6.5 16 7.17 16 8s.67 1.5 1.5 1.5zm-5.36
      2.27L11 11c-.55 0-1 .45-1 1v.28c-2.31.36-4 1.78-4 3.22 0 1.93 2.24 3.5 5 3.5s5-1.57
      5-3.5c0-1.44-1.69-2.86-4-3.22V12c0-.18-.04-.35-.1-.5l1.27-1.27-.53-.96z"/>`,
  },
  // ── Transport & Parking ───────────────────────────────────────────────────
  {
    name: 'poi-parking',
    bg: '#1565C0',
    markup: `<path fill="white" d="M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2
      c1.1 0 2 .9 2 2s-.9 2-2 2z"/>`,
  },
  {
    name: 'poi-fuel',
    bg: '#37474F',
    markup: `<path fill="white" d="M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61
      1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1
      V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12
      2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM18 10c-.55 0-1-.45-1-1s.45-1 1-1
      1 .45 1 1-.45 1-1 1zM8 18v-4.5H6L10 6v5h2l-4 7z"/>`,
  },
  {
    name: 'poi-traffic',
    bg: '#F57F17',
    markup: `<path fill="white" d="M7 4v2H4v12h3v2h10v-2h3V6h-3V4H7zm2 2h6v11H9V6zm3 9c-.55 0-1
      .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm0-4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z
      m0-4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>`,
  },
  // ── Finance ───────────────────────────────────────────────────────────────
  {
    name: 'poi-bank',
    bg: '#E65100',
    markup: `<path fill="white" d="M4 10v7h3v-7H4zm6.5 0v7h3v-7h-3zM2 22h19v-3H2v3zm15-12v7h3v-7
      h-3zM11.5 1L2 6v2h19V6l-9.5-5z"/>`,
  },
  // ── Shopping ──────────────────────────────────────────────────────────────
  {
    name: 'poi-shopping',
    bg: '#6A1B9A',
    markup: `<path fill="white" d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm0-2h
      11.77c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2
      H1v2h2l3.6 7.59-1.35 2.45A1.99 1.99 0 0 0 5 19c0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25
      -.25l.03-.12.9-1.63H17c.75 0 1.41-.41 1.75-1.03 0 0-10.21 0-11.73-7.97H18zm10 2c-1.1 0-1.99
      .9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>`,
  },
  // ── Education ─────────────────────────────────────────────────────────────
  {
    name: 'poi-school',
    bg: '#283593',
    markup: `<path fill="white" d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91
      V17h2V9L12 3z"/>`,
  },
  // ── Religion ──────────────────────────────────────────────────────────────
  {
    name: 'poi-worship',
    bg: '#00695C',
    markup: `<path fill="white" d="M6.5 10h-2v8h2v-8zm6 0h-2v8h2v-8zm8.5 9H2v2h20v-2zm-2.5-9h-2v8
      h2v-8zM12 1L2 6v2h20V6L12 1z"/>`,
  },
  // ── Accommodation ─────────────────────────────────────────────────────────
  {
    name: 'poi-hotel',
    bg: '#AD1457',
    markup: `<path fill="white" d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6
      h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z"/>`,
  },
  // ── Sports & Leisure ──────────────────────────────────────────────────────
  {
    name: 'poi-gym',
    bg: '#BF360C',
    markup: `<path fill="white" d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2
      9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12
      7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l1.14 1.14a1 1 0 0 0 1.41 0l1.77-1.77a1
      1 0 0 0 0-1.41L19.47 18.8l1.77-1.77a1 1 0 0 0-.67-1.17z"/>`,
  },
  // ── Security ──────────────────────────────────────────────────────────────
  {
    name: 'poi-cctv',
    bg: '#546E7A',
    markup: `<path fill="white" d="M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2
      2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5
      -2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`,
  },
  // ── Infrastructure ─────────────────────────────────────────────────────────────
  {
    name: 'infra-signal',
    bg: '#C62828',
    markup: `<rect fill="white" x="8" y="2" width="8" height="20" rx="2"/>
      <circle fill="#C62828" cx="12" cy="6.5" r="2"/>
      <circle fill="#F9A825" cx="12" cy="12" r="2"/>
      <circle fill="#2E7D32" cx="12" cy="17.5" r="2"/>`,
  },
  {
    name: 'infra-bus',
    bg: '#1565C0',
    markup: `<path fill="white" d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45
      1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4
      -8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17
      7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6
      H6V6h12v5z"/>`,
  },
  {
    name: 'infra-crossing',
    bg: '#00796B',
    markup: `<circle fill="white" cx="12" cy="4" r="2"/>
      <path fill="white" d="M15.89 8.11C15.5 7.72 14.83 7 13.5 7h-3c-1.14 0-1.71.49-2.17 1l
      -2.77 3.14c-.28.31-.45.7-.45 1.1 0 .91.73 1.76 1.76 1.76.52 0 1.01-.21 1.38-.58l1.92-2
      .18-.53 3.12v5.74c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V15h1v4.1c0 .83.67 1.5 1.5 1.5s1.5
      -.67 1.5-1.5V12l-.53-3.89z"/>`,
  },
  {
    name: 'infra-camera',
    bg: '#37474F',
    markup: `<path fill="white" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1
      1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>`,
  },
  {
    name: 'infra-lamp',
    bg: '#F9A825',
    markup: `<path fill="white" d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5
      5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27
      3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1
      7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.68-.83 3.25-2.15 4.1z"/>`,
  },
  // ── Roundabout (turning circle / loop) ────────────────────────────────────
  {
    name: 'infra-roundabout',
    bg: '#2E7D32',
    markup: `<path fill="white" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8
      l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01
      .25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>`,
  },
  // ── Mast (antenna / communications tower) ────────────────────────────────
  {
    name: 'infra-mast',
    bg: '#546E7A',
    markup: `<path fill="white" d="M11 23h2V12h-2v11zM7.93 11.25l-1.06 1.69C8.3 14.17 10.06 15
      12 15s3.7-.83 5.13-2.06l-1.06-1.69C14.96 12.37 13.55 13 12 13s-2.96-.63-4.07-1.75zM4.84
      8.87l-1.06 1.7C5.6 12.4 8.67 14 12 14s6.4-1.6 8.22-3.43l-1.06-1.7C17.5 10.57 14.9 12 12
      12s-5.5-1.43-7.16-3.13zM12 1L1 7.44l1.06 1.68C4.17 7.6 7.94 6 12 6s7.83 1.6 9.94 3.12
      L23 7.44 12 1z"/>`,
  },
  // ── Flagpole ──────────────────────────────────────────────────────────────
  {
    name: 'infra-flagpole',
    bg: '#E65100',
    markup: `<path fill="white" d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z"/>`,
  },
  // ── Tower (water tower / observation) ─────────────────────────────────────
  {
    name: 'infra-tower',
    bg: '#5D4037',
    markup: `<path fill="white" d="M15.5 2h-7L7 6h2l1 4H9L3 22h18L15 10h-1l1-4h2l-1.5-4zM12
      10h-1.5l-.5-4h4l-.5 4H12zm-4.65 10l4.65-7 4.65 7H7.35z"/>`,
  },
  // ── Water tap ─────────────────────────────────────────────────────────────
  {
    name: 'infra-watertap',
    bg: '#0097A7',
    markup: `<path fill="white" d="M17 7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h1v3h2v-3h2v3h2v-3h1
      c2.76 0 5-2.24 5-5s-2.24-5-5-5zm0 8H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h10c1.65 0 3 1.35 3
      3s-1.35 3-3 3zM9 15h2v-2h2v2h2v-2c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v2z"/>`,
  },
  // ── Default ───────────────────────────────────────────────────────────────
  {
    name: 'poi-default',
    bg: '#0288D1',
    markup: `<path fill="white" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13
      c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5
      -1.12 2.5-2.5 2.5z"/>`,
  },
];

// ── Canvas renderer ──────────────────────────────────────────────────────────

function loadIconAsync(def: IconDef): Promise<{ name: string; imageData: ImageData }> {
  return new Promise((resolve) => {
    const s = ICON_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d')!;;

    // ① Drop shadow
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    // ② Filled circle background
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = def.bg;
    ctx.fill();

    // ③ White border (clear shadow first)
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // ④ Draw white symbol via SVG → Image
    const symbolSize = Math.round(s * 0.54);   // ~26 px in a 48 px circle
    const offset    = Math.round((s - symbolSize) / 2);

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
      width="${symbolSize}" height="${symbolSize}">${def.markup}</svg>`;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, offset, offset, symbolSize, symbolSize);
      resolve({ name: def.name, imageData: ctx.getImageData(0, 0, s, s) });
    };
    img.onerror = () => resolve({ name: def.name, imageData: ctx.getImageData(0, 0, s, s) }); // fallback: plain circle
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Load and register all POI icons into the MapLibre sprite. */
export async function registerPoiIcons(map: MapLibreMap): Promise<void> {
  const results = await Promise.all(DEFS.map(loadIconAsync));
  for (const { name, imageData } of results) {
    if (!map.hasImage(name)) {
      map.addImage(name, imageData);
    }
  }
}

/**
 * Icon-image expression for the INFRASTRUCTURE layer.
 * Matches on the `category` property set by the backend and Overpass fetch.
 */
export function infraIconImageExpression(): unknown[] {
  return [
    'match',
    ['get', 'category'],
    'traffic_signals',  'infra-signal',
    'bus_stop',         'infra-bus',
    'crossing',         'infra-crossing',
    'speed_camera',     'infra-camera',
    'cctv',             'infra-camera',
    'street_lamp',      'infra-lamp',
    'roundabout',       'infra-roundabout',
    'mast',             'infra-mast',
    'flagpole',         'infra-flagpole',
    'tower',            'infra-tower',
    'water_tap',        'infra-watertap',
    /* fallback */      'poi-default',
  ];
}

/**
 * Size expression for infrastructure icons — slightly smaller than POI icons.
 */
export function infraIconSizeExpression(): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    12, 0.28,
    15, 0.45,
    18, 0.65,
  ];
}

/**
 * MapLibre `icon-image` expression that picks the right sprite image
 * based on a feature's `amenity`, `shop`, `tourism`, and `type` properties.
 */
export function poiIconImageExpression(): unknown[] {
  return [
    'match',
    // Coalesce: use the first non-null field
    ['coalesce', ['get', 'amenity'], ['get', 'shop'], ['get', 'tourism'], ['get', 'type'], ''],

    // Food & Drink
    ['restaurant', 'food_court', 'canteen'],               'poi-restaurant',
    ['cafe', 'coffee_shop', 'juice_bar'],                  'poi-cafe',
    ['fast_food', 'food'],                                 'poi-restaurant',
    ['bar', 'pub', 'nightclub', 'lounge'],                 'poi-bar',

    // Health
    ['pharmacy', 'chemist'],                               'poi-pharmacy',
    ['hospital', 'clinic', 'doctors', 'dentist',
     'physiotherapist', 'optician'],                       'poi-hospital',
    ['veterinary'],                                        'poi-veterinary',

    // Transport
    ['parking', 'parking_entrance', 'parking_space'],      'poi-parking',
    ['fuel', 'car_wash'],                                  'poi-fuel',
    ['signal', 'traffic_lights', 'traffic_light'],        'poi-traffic',
    ['cctv', 'surveillance', 'security'],                  'poi-cctv',

    // Finance
    ['bank', 'atm', 'bureau_de_change', 'money_transfer'], 'poi-bank',

    // Shopping
    ['supermarket', 'convenience', 'mall', 'department_store',
     'marketplace', 'general', 'variety_store'],           'poi-shopping',

    // Education
    ['school', 'college', 'university', 'kindergarten',
     'language_school', 'music_school', 'driving_school'], 'poi-school',

    // Religion
    ['mosque', 'place_of_worship', 'church', 'temple'],   'poi-worship',

    // Accommodation
    ['hotel', 'hostel', 'motel', 'guest_house', 'apartment'],
                                                           'poi-hotel',

    // Sports & Leisure
    ['gym', 'sports_centre', 'fitness_centre', 'swimming_pool',
     'golf_course', 'tennis'],                            'poi-gym',

    // Default fallback
    'poi-default',
  ];
}

/**
 * Icon size expression: slightly smaller for traffic/cctv, larger for key POIs.
 */
export function poiIconSizeExpression(): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    12, 0.35,
    15, 0.55,
    18, 0.75,
  ];
}

// ── Infrastructure structure icons ─────────────────────────────────────────
// Each structure is drawn synchronously with the Canvas 2D API (no SVG/Image
// loading) so icons register immediately with zero async risk.
// icon-anchor: 'bottom' is set on the symbol layer so structures stand on
// their map coordinate.

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface StructureDef {
  name: string;
  w: number;
  h: number;
  draw: DrawFn;
}

function makeStructureIcon(def: StructureDef): { name: string; imageData: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width  = def.w * 2;   // 2× for retina sharpness
  canvas.height = def.h * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  def.draw(ctx, def.w, def.h);
  return { name: def.name, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

// Shared helpers ──────────────────────────────────────────────────────────────

/** Rounded rectangle path */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Draw a vertical pole from (cx, y1) to (cx, y2) with 3-D shading */
function pole(ctx: CanvasRenderingContext2D, cx: number, y1: number, y2: number, radius = 2.5, color = '#78909C') {
  const grad = ctx.createLinearGradient(cx - radius, 0, cx + radius, 0);
  grad.addColorStop(0,    '#455A64');
  grad.addColorStop(0.4,  color);
  grad.addColorStop(0.7,  '#B0BEC5');
  grad.addColorStop(1,    '#546E7A');
  ctx.fillStyle = grad;
  rrect(ctx, cx - radius, y1, radius * 2, y2 - y1, radius);
  ctx.fill();
}

/** Drop shadow shortcut */
function shadow(ctx: CanvasRenderingContext2D, blur = 3, offsetY = 2) {
  ctx.shadowColor   = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur    = blur;
  ctx.shadowOffsetY = offsetY;
}
function noShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.shadowOffsetY = 0;
}

const STRUCTURE_DEFS: StructureDef[] = [

  // ── Street lamp ────────────────────────────────────────────────────────────
  {
    name: 'struct-lamp', w: 52, h: 80,
    draw(ctx, _w, h) {
      const cx = 20;
      // ground glow
      const glow = ctx.createRadialGradient(cx, h - 2, 0, cx, h - 2, 12);
      glow.addColorStop(0, 'rgba(253,216,53,0.35)');
      glow.addColorStop(1, 'rgba(253,216,53,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(cx, h - 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      // vertical pole
      shadow(ctx);
      pole(ctx, cx, 26, h - 2, 2.5);
      noShadow(ctx);
      // curved arm
      ctx.beginPath();
      ctx.moveTo(cx, 28);
      ctx.bezierCurveTo(cx - 2, 16, cx + 20, 10, cx + 26, 8);
      ctx.strokeStyle = '#607D8B'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
      // lamp housing (isometric top view)
      shadow(ctx, 4, 3);
      ctx.fillStyle = '#37474F';
      rrect(ctx, cx + 18, 4, 14, 7, 3); ctx.fill();
      noShadow(ctx);
      // lens / bulb glow
      const bulb = ctx.createRadialGradient(cx + 25, 9, 0, cx + 25, 9, 10);
      bulb.addColorStop(0, '#FFF9C4');
      bulb.addColorStop(0.4, '#FDD835');
      bulb.addColorStop(1,  'rgba(253,216,53,0)');
      ctx.fillStyle = bulb; ctx.beginPath(); ctx.ellipse(cx + 25, 11, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFEE58';
      rrect(ctx, cx + 19, 5, 12, 5, 2); ctx.fill();
      // glint
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(cx + 21, 6, 3, 1.5, -0.4, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Traffic signal ─────────────────────────────────────────────────────────
  {
    name: 'struct-signal', w: 36, h: 84,
    draw(ctx, w, h) {
      const cx = w / 2;
      const poleTop = 56;
      shadow(ctx);
      pole(ctx, cx, poleTop, h - 2, 2.8);
      noShadow(ctx);
      // housing body
      shadow(ctx, 5, 3);
      const hg = ctx.createLinearGradient(cx - 12, 0, cx + 12, 0);
      hg.addColorStop(0,   '#1a1a1a');
      hg.addColorStop(0.5, '#2e2e2e');
      hg.addColorStop(1,   '#111');
      ctx.fillStyle = hg;
      rrect(ctx, cx - 12, 4, 24, poleTop - 4, 5); ctx.fill();
      noShadow(ctx);
      // separator lines
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
      [21, 38].forEach(y => { ctx.beginPath(); ctx.moveTo(cx - 11, y); ctx.lineTo(cx + 11, y); ctx.stroke(); });
      // signals: red (top, lit), amber (mid, dim), green (bot, dim)
      const lights: [number, string, string, number][] = [
        [14, '#E53935', '#FF8A80', 1.0],
        [31, '#F57F17', '#FFD54F', 0.25],
        [48, '#2E7D32', '#69F0AE', 0.25],
      ];
      for (const [y, bg, fg, alpha] of lights) {
        // recessed socket
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath(); ctx.arc(cx, y, 9, 0, Math.PI * 2); ctx.fill();
        // light circle
        ctx.globalAlpha = alpha;
        const lg = ctx.createRadialGradient(cx - 2, y - 2, 1, cx, y, 8);
        lg.addColorStop(0, fg); lg.addColorStop(1, bg);
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(cx, y, 7.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // glow halo on red
      const rg = ctx.createRadialGradient(cx, 14, 2, cx, 14, 14);
      rg.addColorStop(0, 'rgba(229,57,53,0.5)');
      rg.addColorStop(1, 'rgba(229,57,53,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, 14, 14, 0, Math.PI * 2); ctx.fill();
      // visor fins
      ctx.fillStyle = '#111';
      [5, 22, 39].forEach(y => { rrect(ctx, cx - 11, y, 22, 3.5, 1); ctx.fill(); });
    },
  },

  // ── CCTV camera ────────────────────────────────────────────────────────────
  {
    name: 'struct-cctv', w: 60, h: 66,
    draw(ctx, _w, h) {
      const px = 32, py = 14;
      shadow(ctx);
      pole(ctx, px, py + 28, h - 2, 2.5);
      noShadow(ctx);
      // vertical bracket
      const bg = ctx.createLinearGradient(px - 2.5, 0, px + 2.5, 0);
      bg.addColorStop(0, '#455A64'); bg.addColorStop(0.5, '#78909C'); bg.addColorStop(1, '#546E7A');
      ctx.fillStyle = bg; rrect(ctx, px - 2.5, py + 2, 5, 28, 2); ctx.fill();
      // horizontal arm
      ctx.fillStyle = '#607D8B'; rrect(ctx, 10, py + 2, px - 10, 4, 2); ctx.fill();
      // camera body — trapezoid with 3-D shading
      shadow(ctx, 5, 3);
      ctx.fillStyle = '#2E3E47';
      ctx.beginPath();
      ctx.moveTo(10, py + 6); ctx.lineTo(36, py + 4);
      ctx.lineTo(36, py + 22); ctx.lineTo(10, py + 20); ctx.closePath(); ctx.fill();
      // top highlight face
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(10, py + 6); ctx.lineTo(36, py + 4);
      ctx.lineTo(36, py + 8); ctx.lineTo(10, py + 10); ctx.closePath(); ctx.fill();
      noShadow(ctx);
      // lens rings
      const lx = 22, ly = py + 13;
      [10, 8, 5.5, 3].forEach((r, i) => {
        ctx.fillStyle = ['#1a1a1a','#0D1B2A','#1565C0','#1E88E5'][i];
        ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
      });
      // lens glint
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath(); ctx.ellipse(lx - 2.5, ly - 2.5, 2.5, 1.5, -0.5, 0, Math.PI * 2); ctx.fill();
      // status LED
      ctx.fillStyle = '#F44336';
      ctx.beginPath(); ctx.arc(33, py + 6, 2, 0, Math.PI * 2); ctx.fill();
      // IR LED ring
      ctx.strokeStyle = 'rgba(255,60,60,0.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(lx, ly, 12, 0, Math.PI * 2); ctx.stroke();
    },
  },

  // ── Speed / traffic camera ──────────────────────────────────────────────────
  {
    name: 'struct-speedcam', w: 50, h: 72,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      pole(ctx, cx, 42, h - 2, 2.8);
      noShadow(ctx);
      // box body
      shadow(ctx, 5, 3);
      const hg = ctx.createLinearGradient(cx - 20, 0, cx + 20, 0);
      hg.addColorStop(0, '#1a1a1a'); hg.addColorStop(0.5, '#2e2e2e'); hg.addColorStop(1, '#111');
      ctx.fillStyle = hg; rrect(ctx, cx - 20, 8, 40, 36, 6); ctx.fill();
      // top sheen
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      rrect(ctx, cx - 20, 8, 40, 10, 4); ctx.fill();
      noShadow(ctx);
      // big lens
      const lx = cx, ly = 26;
      [14, 12, 9, 6, 3].forEach((r, i) => {
        ctx.fillStyle = ['#1a1a1a','#0D1B2A','#1565C0','#1E88E5','#42A5F5'][i];
        ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
      });
      // lens glint
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.ellipse(lx - 4, ly - 4, 4, 2.5, -0.5, 0, Math.PI * 2); ctx.fill();
      // flash unit (top-right)
      ctx.fillStyle = '#FDD835';
      rrect(ctx, cx + 12, 11, 6, 5, 2); ctx.fill();
      ctx.fillStyle = 'rgba(253,216,53,0.3)';
      ctx.beginPath(); ctx.arc(cx + 15, 13.5, 7, 0, Math.PI * 2); ctx.fill();
      // status LED
      ctx.fillStyle = '#F44336';
      ctx.beginPath(); ctx.arc(cx - 16, 13, 2.5, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Bus stop sign ───────────────────────────────────────────────────────────
  {
    name: 'struct-bus', w: 42, h: 80,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      pole(ctx, cx, 40, h - 2, 2.5, '#1565C0');
      noShadow(ctx);
      // sign board
      shadow(ctx, 4, 3);
      ctx.fillStyle = '#1565C0';
      rrect(ctx, 4, 4, w - 8, 38, 5); ctx.fill();
      noShadow(ctx);
      // white border inset
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
      rrect(ctx, 6, 6, w - 12, 34, 4); ctx.stroke();
      // header band
      ctx.fillStyle = '#1976D2'; rrect(ctx, 5, 5, w - 10, 10, 4); ctx.fill();
      // "BUS" text bar
      ctx.fillStyle = '#1E88E5'; rrect(ctx, 8, 8, 26, 6, 2); ctx.fill();
      ctx.fillStyle = 'white'; ctx.font = 'bold 5px sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('BUS STOP', cx, 13);
      // bus silhouette
      ctx.fillStyle = 'white';
      rrect(ctx, 8, 18, 26, 13, 2); ctx.fill();
      // windshield
      ctx.fillStyle = '#1565C0'; rrect(ctx, 10, 20, 6, 6, 1); ctx.fill();
      // windows
      ctx.fillStyle = '#1E88E5';
      [18, 24].forEach(x => { rrect(ctx, x, 20, 4, 4, 1); ctx.fill(); });
      // wheels
      ctx.fillStyle = '#1565C0';
      [12, 26].forEach(x => { ctx.beginPath(); ctx.arc(x, 31, 2.5, 0, Math.PI * 2); ctx.fill(); });
      // accent stripe
      ctx.fillStyle = '#FDD835'; rrect(ctx, 8, 34, 26, 2, 1); ctx.fill();
    },
  },

  // ── Pedestrian crossing ─────────────────────────────────────────────────────
  {
    name: 'struct-crossing', w: 44, h: 58,
    draw(ctx, _w, h) {
      // zebra stripes at bottom
      ctx.fillStyle = '#004D40';
      [0, 10, 20, 30].forEach(x => { rrect(ctx, x + 2, h - 14, 8, 12, 1); ctx.fill(); });
      // walking person (offset right)
      const px = 30, headY = 8;
      ctx.fillStyle = '#00796B';
      // head
      ctx.beginPath(); ctx.arc(px, headY, 5, 0, Math.PI * 2); ctx.fill();
      // body
      rrect(ctx, px - 4, headY + 5, 8, 12, 3); ctx.fill();
      // left arm
      ctx.beginPath(); ctx.moveTo(px - 4, headY + 8); ctx.lineTo(px - 12, headY + 16);
      ctx.lineWidth = 4; ctx.strokeStyle = '#00796B'; ctx.lineCap = 'round'; ctx.stroke();
      // right arm
      ctx.beginPath(); ctx.moveTo(px + 4, headY + 8); ctx.lineTo(px + 12, headY + 14); ctx.stroke();
      // left leg
      ctx.beginPath(); ctx.moveTo(px - 2, headY + 17); ctx.lineTo(px - 8, headY + 30); ctx.stroke();
      // right leg
      ctx.beginPath(); ctx.moveTo(px + 2, headY + 17); ctx.lineTo(px + 6, headY + 28); ctx.stroke();
    },
  },

  // ── Roundabout ──────────────────────────────────────────────────────────────
  {
    name: 'struct-roundabout', w: 48, h: 48,
    draw(ctx, w, h) {
      const cx = w / 2, cy = h / 2;
      // outer ring
      shadow(ctx);
      ctx.strokeStyle = '#2E7D32'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
      noShadow(ctx);
      // inner island
      const ig = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
      ig.addColorStop(0, '#A5D6A7'); ig.addColorStop(1, '#2E7D32');
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
      // direction arrows (3 × 120°)
      ctx.fillStyle = '#1B5E20';
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate((i * Math.PI * 2) / 3 - Math.PI / 6);
        ctx.translate(18, 0);
        ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(6, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },
  },

  // ── Antenna mast ───────────────────────────────────────────────────────────
  {
    name: 'struct-mast', w: 48, h: 84,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      pole(ctx, cx, 60, h - 2, 3);
      noShadow(ctx);
      // lattice triangle
      ctx.strokeStyle = '#546E7A'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // outline
      ctx.beginPath(); ctx.moveTo(cx, 6); ctx.lineTo(cx - 14, 62); ctx.lineTo(cx + 14, 62); ctx.closePath(); ctx.stroke();
      // cross braces
      [[cx, 6, cx - 10, 42],[cx, 6, cx + 10, 42],[cx - 12, 58, cx + 12, 58],
       [cx - 7, 30, cx + 7, 30],[cx - 4, 20, cx + 4, 20]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      // warning light
      const wg = ctx.createRadialGradient(cx, 5, 0, cx, 5, 8);
      wg.addColorStop(0, '#FF8A80'); wg.addColorStop(0.5, '#F44336'); wg.addColorStop(1, 'rgba(244,67,54,0)');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(cx, 5, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FF5252'; ctx.beginPath(); ctx.arc(cx, 5, 4, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Flagpole ────────────────────────────────────────────────────────────────
  {
    name: 'struct-flagpole', w: 44, h: 84,
    draw(ctx, _w, h) {
      const px = 16;
      shadow(ctx);
      pole(ctx, px, 6, h - 2, 2.5, '#9E9E9E');
      noShadow(ctx);
      // flag
      const fg = ctx.createLinearGradient(px, 6, 42, 22);
      fg.addColorStop(0, '#E53935'); fg.addColorStop(1, '#B71C1C');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(px + 2, 6); ctx.lineTo(42, 14); ctx.lineTo(42, 28); ctx.lineTo(px + 2, 28); ctx.closePath(); ctx.fill();
      // flag sheen
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.moveTo(px + 2, 6); ctx.lineTo(42, 14); ctx.lineTo(42, 17); ctx.lineTo(px + 2, 9); ctx.closePath(); ctx.fill();
      // pole ball finial
      ctx.fillStyle = '#CFD8DC';
      ctx.beginPath(); ctx.arc(px, 5, 3, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Water / observation tower ────────────────────────────────────────────────
  {
    name: 'struct-tower', w: 56, h: 84,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      // legs
      ctx.strokeStyle = '#607D8B'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
      [[cx - 2, 42, 10, h - 4],[cx + 2, 42, w - 10, h - 4]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      // cross braces
      ctx.lineWidth = 2; ctx.strokeStyle = '#78909C';
      [[12, h - 20, w - 12, h - 10],[w - 12, h - 20, 12, h - 10]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      [[15, h - 34, w - 15, h - 26],[w - 15, h - 34, 15, h - 26]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      noShadow(ctx);
      // tank body
      shadow(ctx, 6, 4);
      const tg = ctx.createLinearGradient(cx - 18, 0, cx + 18, 0);
      tg.addColorStop(0, '#546E7A'); tg.addColorStop(0.4, '#90A4AE'); tg.addColorStop(1, '#455A64');
      ctx.fillStyle = tg; rrect(ctx, cx - 18, 18, 36, 26, 6); ctx.fill();
      // dome top
      ctx.fillStyle = '#78909C';
      ctx.beginPath(); ctx.ellipse(cx, 18, 18, 7, 0, Math.PI, Math.PI * 2); ctx.fill();
      // top sheen
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.ellipse(cx, 18, 14, 5, 0, Math.PI, Math.PI * 2); ctx.fill();
      // bottom rim shadow
      ctx.fillStyle = '#37474F';
      ctx.beginPath(); ctx.ellipse(cx, 44, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
      noShadow(ctx);
    },
  },

  // ── Water tap / standpipe ────────────────────────────────────────────────────
  {
    name: 'struct-watertap', w: 52, h: 62,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      // standpipe body
      const pg = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
      pg.addColorStop(0, '#006064'); pg.addColorStop(0.5, '#0097A7'); pg.addColorStop(1, '#4DD0E1');
      ctx.fillStyle = pg; rrect(ctx, cx - 6, 32, 12, h - 34, 6); ctx.fill();
      // crossbar handle
      ctx.fillStyle = '#0097A7'; rrect(ctx, cx - 14, 20, 28, 5, 3); ctx.fill();
      ctx.fillStyle = '#00BCD4'; rrect(ctx, cx - 12, 21, 24, 2, 1); ctx.fill(); // highlight
      // spout connector
      ctx.fillStyle = '#00838F'; rrect(ctx, cx + 2, 26, 10, 8, 3); ctx.fill();
      // spout pipe — curves down
      ctx.beginPath(); ctx.moveTo(cx + 12, 28); ctx.bezierCurveTo(cx + 22, 30, cx + 22, 40, cx + 16, 44);
      ctx.strokeStyle = '#00838F'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
      noShadow(ctx);
      // water drop
      const dx = cx + 16, dy = 50;
      const wg = ctx.createRadialGradient(dx - 1, dy - 1, 0, dx, dy, 5);
      wg.addColorStop(0, '#81D4FA'); wg.addColorStop(1, '#0288D1');
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.moveTo(dx, dy - 7); ctx.bezierCurveTo(dx + 7, dy - 2, dx + 5, dy + 6, dx, dy + 7);
      ctx.bezierCurveTo(dx - 5, dy + 6, dx - 7, dy - 2, dx, dy - 7); ctx.fill();
      // drop glint
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.ellipse(dx - 1.5, dy - 2, 1.5, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Fire hydrant ────────────────────────────────────────────────────────────
  {
    name: 'struct-hydrant', w: 36, h: 70,
    draw(ctx, w, h) {
      const cx = w / 2;
      // base pad
      ctx.fillStyle = '#B71C1C'; rrect(ctx, cx - 8, h - 10, 16, 10, 2); ctx.fill();
      // main barrel — shaded cylinder
      shadow(ctx, 4, 3);
      const bg = ctx.createLinearGradient(cx - 7, 0, cx + 7, 0);
      bg.addColorStop(0, '#B71C1C'); bg.addColorStop(0.4, '#F44336'); bg.addColorStop(0.7, '#EF9A9A'); bg.addColorStop(1, '#C62828');
      ctx.fillStyle = bg; rrect(ctx, cx - 7, 30, 14, h - 38, 4); ctx.fill();
      noShadow(ctx);
      // side outlets
      ctx.fillStyle = '#C62828';
      rrect(ctx, cx - 14, 42, 7, 5, 2); ctx.fill();
      rrect(ctx, cx + 7,  42, 7, 5, 2); ctx.fill();
      ctx.fillStyle = '#D32F2F';
      ctx.beginPath(); ctx.arc(cx - 10, 44, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 10, 44, 3, 0, Math.PI * 2); ctx.fill();
      // dome top
      const dg = ctx.createRadialGradient(cx - 2, 26, 0, cx, 28, 10);
      dg.addColorStop(0, '#EF9A9A'); dg.addColorStop(1, '#B71C1C');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(cx, 30, 9, Math.PI, Math.PI * 2); ctx.fill();
      rrect(ctx, cx - 9, 26, 18, 6, 3); ctx.fill();
      // cap nut (pentagon)
      ctx.fillStyle = '#7f1313';
      ctx.beginPath(); ctx.arc(cx, 24, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#EF9A9A';
      ctx.beginPath(); ctx.arc(cx, 23, 2, 0, Math.PI * 2); ctx.fill();
      // ground glow
      const gg = ctx.createRadialGradient(cx, h, 0, cx, h, 10);
      gg.addColorStop(0, 'rgba(244,67,54,0.2)'); gg.addColorStop(1, 'rgba(244,67,54,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(cx, h, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Power substation ──────────────────────────────────────────────────────
  {
    name: 'struct-substation', w: 56, h: 64,
    draw(ctx, w, h) {
      const cx = w / 2;
      // concrete pad
      ctx.fillStyle = '#CFD8DC'; rrect(ctx, 4, h - 14, w - 8, 14, 2); ctx.fill();
      ctx.fillStyle = '#B0BEC5'; rrect(ctx, 4, h - 14, w - 8, 3, 2); ctx.fill();
      // main transformer box
      shadow(ctx, 5, 3);
      const hg = ctx.createLinearGradient(8, 0, w - 8, 0);
      hg.addColorStop(0, '#37474F'); hg.addColorStop(0.5, '#546E7A'); hg.addColorStop(1, '#263238');
      ctx.fillStyle = hg; rrect(ctx, 8, 16, w - 16, h - 30, 4); ctx.fill();
      // top sheen
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; rrect(ctx, 9, 17, w - 18, 8, 3); ctx.fill();
      noShadow(ctx);
      // cooling fins
      ctx.strokeStyle = '#263238'; ctx.lineWidth = 2;
      [14, 21, 28, 35, 42].forEach(x => {
        ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, h - 16); ctx.stroke();
      });
      // high-voltage warning label
      ctx.fillStyle = '#FDD835'; rrect(ctx, cx - 10, 22, 20, 16, 2); ctx.fill();
      ctx.fillStyle = '#212121'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚡', cx, 33);
      // bushings on top
      ctx.fillStyle = '#78909C';
      [16, cx, w - 16].forEach(x => {
        rrect(ctx, x - 2.5, 8, 5, 10, 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, 7, 3.5, 0, Math.PI * 2); ctx.fill();
      });
      // status LED
      ctx.fillStyle = '#4CAF50';
      ctx.beginPath(); ctx.arc(w - 12, h - 20, 3, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── EV charging station ────────────────────────────────────────────────────
  {
    name: 'struct-evcharging', w: 40, h: 76,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      pole(ctx, cx, 46, h - 2, 3, '#1565C0');
      noShadow(ctx);
      // station box
      shadow(ctx, 4, 3);
      const bg = ctx.createLinearGradient(cx - 14, 0, cx + 14, 0);
      bg.addColorStop(0, '#0D47A1'); bg.addColorStop(0.5, '#1976D2'); bg.addColorStop(1, '#0D47A1');
      ctx.fillStyle = bg; rrect(ctx, cx - 14, 6, 28, 42, 6); ctx.fill();
      // screen
      ctx.fillStyle = '#0a1628'; rrect(ctx, cx - 10, 10, 20, 14, 3); ctx.fill();
      ctx.fillStyle = '#29B6F6'; rrect(ctx, cx - 9, 11, 18, 12, 2); ctx.fill();
      ctx.fillStyle = 'white'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('EV', cx, 20);
      noShadow(ctx);
      // lightning bolt
      const lg = ctx.createLinearGradient(cx - 5, 26, cx + 5, 40);
      lg.addColorStop(0, '#FDD835'); lg.addColorStop(1, '#F57F17');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(cx + 2, 26); ctx.lineTo(cx - 4, 35); ctx.lineTo(cx + 1, 35);
      ctx.lineTo(cx - 2, 43); ctx.lineTo(cx + 6, 33); ctx.lineTo(cx + 1, 33);
      ctx.closePath(); ctx.fill();
      // connector cable
      ctx.strokeStyle = '#0D47A1'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + 10, 32); ctx.bezierCurveTo(w, 32, w, 50, cx + 8, 52); ctx.stroke();
      ctx.fillStyle = '#455A64'; rrect(ctx, cx + 6, 50, 6, 8, 2); ctx.fill();
      // status LED
      ctx.fillStyle = '#4CAF50'; ctx.beginPath(); ctx.arc(cx + 10, 12, 2.5, 0, Math.PI * 2); ctx.fill();
    },
  },

  // ── Recycling bin ──────────────────────────────────────────────────────────
  {
    name: 'struct-recycling', w: 44, h: 64,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      // bin body (trapezoid with wide top)
      ctx.fillStyle = '#1B5E20';
      ctx.beginPath();
      ctx.moveTo(6, 20); ctx.lineTo(w - 6, 20);   // top
      ctx.lineTo(w - 10, h - 8); ctx.lineTo(10, h - 8); // bottom
      ctx.closePath(); ctx.fill();
      // body gradient sheen
      const bg = ctx.createLinearGradient(6, 0, w - 6, 0);
      bg.addColorStop(0, 'rgba(0,0,0,0.2)'); bg.addColorStop(0.4, 'rgba(255,255,255,0.12)'); bg.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(6, 20); ctx.lineTo(w - 6, 20); ctx.lineTo(w - 10, h - 8); ctx.lineTo(10, h - 8); ctx.closePath(); ctx.fill();
      noShadow(ctx);
      // lid
      ctx.fillStyle = '#2E7D32'; rrect(ctx, 4, 14, w - 8, 8, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; rrect(ctx, 5, 15, w - 10, 3, 2); ctx.fill();
      // opening slot
      ctx.fillStyle = '#1B5E20'; rrect(ctx, cx - 7, 16, 14, 4, 2); ctx.fill();
      // recycling arrows
      ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 3 curved arrows in a circle
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, 38); ctx.rotate((i * Math.PI * 2) / 3);
        ctx.beginPath(); ctx.arc(0, 0, 9, -0.5, 1.5); ctx.stroke();
        // arrowhead
        ctx.beginPath(); ctx.moveTo(9 * Math.cos(1.5) - 3, 9 * Math.sin(1.5) - 2);
        ctx.lineTo(9 * Math.cos(1.5), 9 * Math.sin(1.5));
        ctx.lineTo(9 * Math.cos(1.5) + 2, 9 * Math.sin(1.5) - 3); ctx.stroke();
        ctx.restore();
      }
    },
  },

  // ── Waste basket ───────────────────────────────────────────────────────────
  {
    name: 'struct-wastebasket', w: 36, h: 58,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      // post
      pole(ctx, cx, 36, h - 2, 2, '#546E7A');
      noShadow(ctx);
      // bin trapezoid body
      const bg = ctx.createLinearGradient(cx - 12, 0, cx + 12, 0);
      bg.addColorStop(0, '#37474F'); bg.addColorStop(0.45, '#607D8B'); bg.addColorStop(1, '#455A64');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(cx - 10, 8); ctx.lineTo(cx + 10, 8);   // top
      ctx.lineTo(cx + 13, 38); ctx.lineTo(cx - 13, 38); // bottom
      ctx.closePath(); ctx.fill();
      // horizontal rings
      ctx.strokeStyle = '#546E7A'; ctx.lineWidth = 1.5;
      [18, 26].forEach(y => { ctx.beginPath(); ctx.moveTo(cx - 11, y); ctx.lineTo(cx + 11, y); ctx.stroke(); });
      // lid
      ctx.fillStyle = '#455A64'; rrect(ctx, cx - 11, 6, 22, 4, 2); ctx.fill();
      // opening
      ctx.fillStyle = '#263238'; rrect(ctx, cx - 5, 7, 10, 3, 1); ctx.fill();
    },
  },

  // ── Drinking water fountain ────────────────────────────────────────────────
  {
    name: 'struct-drinkingwater', w: 40, h: 60,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      // pedestal
      const pg = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
      pg.addColorStop(0, '#01579B'); pg.addColorStop(0.5, '#0288D1'); pg.addColorStop(1, '#01579B');
      ctx.fillStyle = pg; rrect(ctx, cx - 8, 28, 16, h - 30, 4); ctx.fill();
      // base flare
      ctx.fillStyle = '#01579B'; rrect(ctx, cx - 12, h - 8, 24, 8, 3); ctx.fill();
      noShadow(ctx);
      // basin
      shadow(ctx, 3, 2);
      ctx.fillStyle = '#0277BD'; rrect(ctx, cx - 14, 16, 28, 14, 4); ctx.fill();
      ctx.fillStyle = '#0288D1'; rrect(ctx, cx - 13, 17, 26, 6, 3); ctx.fill(); // basin water
      noShadow(ctx);
      // water arc spray
      ctx.strokeStyle = '#29B6F6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + 2, 18); ctx.bezierCurveTo(cx + 14, 12, cx + 16, 4, cx + 10, 4); ctx.stroke();
      ctx.strokeStyle = '#81D4FA'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx + 4, 18); ctx.bezierCurveTo(cx + 16, 10, cx + 18, 2, cx + 12, 2); ctx.stroke();
      // spout nozzle
      ctx.fillStyle = '#039BE5'; rrect(ctx, cx - 2, 14, 6, 4, 2); ctx.fill();
      // water droplets
      ['rgba(41,182,246,0.6)', 'rgba(129,212,250,0.5)'].forEach((c, i) => {
        ctx.fillStyle = c; ctx.beginPath();
        ctx.arc(cx + 10 + i * 4, 8 + i * 3, 2 - i * 0.5, 0, Math.PI * 2); ctx.fill();
      });
    },
  },

  // ── Public toilets ─────────────────────────────────────────────────────────
  {
    name: 'struct-toilets', w: 44, h: 72,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx);
      pole(ctx, cx, 40, h - 2, 2.5, '#5C6BC0');
      noShadow(ctx);
      // sign board
      shadow(ctx, 4, 3);
      ctx.fillStyle = '#3949AB'; rrect(ctx, 4, 4, w - 8, 38, 5); ctx.fill();
      noShadow(ctx);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      rrect(ctx, 6, 6, w - 12, 34, 4); ctx.stroke();
      // man silhouette (right side)
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(30, 13, 4, 0, Math.PI * 2); ctx.fill();
      rrect(ctx, 27, 17, 6, 9, 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(28, 26); ctx.lineTo(25, 36); ctx.lineWidth = 3;
      ctx.strokeStyle = 'white'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(32, 26); ctx.lineTo(35, 36); ctx.stroke();
      // woman silhouette (left side — skirt triangle)
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(14, 13, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8, 36); ctx.lineTo(14, 17); ctx.lineTo(20, 36); ctx.closePath(); ctx.fill();
      // divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, 8); ctx.lineTo(cx, 39); ctx.stroke();
      // WC text strip
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; rrect(ctx, 4, 36, w - 8, 6, 3); ctx.fill();
      ctx.fillStyle = 'white'; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('WC', cx, 41);
    },
  },

  // ── Wastewater plant ───────────────────────────────────────────────────────
  {
    name: 'struct-wastewater', w: 64, h: 68,
    draw(ctx, w, h) {
      shadow(ctx, 3, 2);
      // outdoor slab
      ctx.fillStyle = '#B0BEC5'; rrect(ctx, 2, h - 10, w - 4, 10, 2); ctx.fill();
      // circular settling tank (left)
      const tg1 = ctx.createRadialGradient(20, 30, 0, 20, 30, 16);
      tg1.addColorStop(0, '#80CBC4'); tg1.addColorStop(0.7, '#00897B'); tg1.addColorStop(1, '#004D40');
      ctx.fillStyle = tg1; ctx.beginPath(); ctx.arc(20, 30, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#004D40'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(20, 30, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
      [8, 12].forEach(r => { ctx.beginPath(); ctx.arc(20, 30, r, 0, Math.PI * 2); ctx.stroke(); });
      // rectangular processing building (right)
      const hg = ctx.createLinearGradient(38, 0, w - 4, 0);
      hg.addColorStop(0, '#455A64'); hg.addColorStop(0.5, '#607D8B'); hg.addColorStop(1, '#37474F');
      ctx.fillStyle = hg; rrect(ctx, 38, 12, w - 42, 46, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; rrect(ctx, 39, 13, w - 44, 10, 3); ctx.fill();
      noShadow(ctx);
      // chimney
      ctx.fillStyle = '#546E7A'; rrect(ctx, w - 14, 4, 8, 28, 2); ctx.fill();
      ctx.fillStyle = '#FF8A65'; ctx.beginPath(); ctx.arc(w - 10, 4, 4, 0, Math.PI * 2); ctx.fill();
      // pipes connecting
      ctx.strokeStyle = '#546E7A'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(36, 38); ctx.lineTo(38, 38); ctx.stroke();
      // label
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '5px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('WWTP', w - 22, 38);
    },
  },

  // ── Pumping station ────────────────────────────────────────────────────────
  {
    name: 'struct-pumpstation', w: 52, h: 62,
    draw(ctx, w, h) {
      const cx = w / 2;
      shadow(ctx, 3, 2);
      // concrete slab
      ctx.fillStyle = '#CFD8DC'; rrect(ctx, 4, h - 10, w - 8, 10, 2); ctx.fill();
      // main pump housing
      const hg = ctx.createLinearGradient(8, 0, w - 8, 0);
      hg.addColorStop(0, '#1565C0'); hg.addColorStop(0.5, '#1976D2'); hg.addColorStop(1, '#0D47A1');
      ctx.fillStyle = hg; rrect(ctx, 8, 16, w - 16, 36, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; rrect(ctx, 9, 17, w - 18, 8, 4); ctx.fill();
      noShadow(ctx);
      // impeller wheel at centre
      ctx.strokeStyle = '#42A5F5'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, 34, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#90CAF9'; ctx.lineWidth = 1.5;
      [0, 60, 120, 180, 240, 300].forEach(deg => {
        const r = deg * Math.PI / 180;
        ctx.beginPath(); ctx.moveTo(cx, 34);
        ctx.lineTo(cx + 10 * Math.cos(r), 34 + 10 * Math.sin(r)); ctx.stroke();
      });
      ctx.fillStyle = '#1E88E5'; ctx.beginPath(); ctx.arc(cx, 34, 4, 0, Math.PI * 2); ctx.fill();
      // inlet / outlet pipes
      ctx.fillStyle = '#0D47A1'; rrect(ctx, 0, 28, 10, 7, 2); ctx.fill();
      rrect(ctx, w - 10, 32, 10, 7, 2); ctx.fill();
      // pipe arrows
      ctx.fillStyle = '#42A5F5';
      ctx.beginPath(); ctx.moveTo(8, 31); ctx.lineTo(4, 35); ctx.lineTo(8, 39); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w - 8, 32); ctx.lineTo(w - 4, 36); ctx.lineTo(w - 8, 40); ctx.closePath(); ctx.fill();
      // status LED
      ctx.fillStyle = '#4CAF50'; ctx.beginPath(); ctx.arc(w - 12, 20, 3, 0, Math.PI * 2); ctx.fill();
    },
  },

];

/** Register all infrastructure structure icons into the MapLibre sprite (synchronous canvas draw). */
export function registerInfraStructures(map: MapLibreMap): void {
  for (const def of STRUCTURE_DEFS) {
    if (!map.hasImage(def.name)) {
      const { name, imageData } = makeStructureIcon(def);
      map.addImage(name, imageData, { pixelRatio: 2 });
    }
  }
}

/**
 * Icon-image expression for the infrastructure symbol layer.
 * Maps category property → structure icon name.
 */
export function infraStructureImageExpression(): unknown[] {
  return [
    'match',
    ['get', 'category'],
    'traffic_signals',   'struct-signal',
    'bus_stop',          'struct-bus',
    'crossing',          'struct-crossing',
    'speed_camera',      'struct-speedcam',
    'cctv',              'struct-cctv',
    'street_lamp',       'struct-lamp',
    'roundabout',        'struct-roundabout',
    'mast',              'struct-mast',
    'flagpole',          'struct-flagpole',
    'tower',             'struct-tower',
    'water_tap',         'struct-watertap',
    'fire_hydrant',      'struct-hydrant',
    'power_substation',  'struct-substation',
    'ev_charging',       'struct-evcharging',
    'recycling',         'struct-recycling',
    'waste_basket',      'struct-wastebasket',
    'drinking_water',    'struct-drinkingwater',
    'toilets',           'struct-toilets',
    'wastewater_plant',  'struct-wastewater',
    'pumping_station',   'struct-pumpstation',
    /* fallback */       'struct-lamp',
  ];
}

/**
 * Size expression for infrastructure structure icons — zoom-interpolated.
 * Structures are taller canvases so we use slightly smaller base scale.
 */
export function infraStructureSizeExpression(): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    12, 0.22,
    14, 0.32,
    16, 0.46,
    18, 0.62,
  ];
}
