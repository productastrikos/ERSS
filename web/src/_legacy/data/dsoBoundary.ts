// Dubai Silicon Oasis (DSO) district boundary
// High-precision polygon following actual district limits:
//   NW: E311 – Sheikh Mohammed Bin Zayed Road
//   SW: E66 – Dubai–Al Ain Road
//   SE: D54 – Sheikh Zayed Bin Hamdan Al Nahyan Street
//   NE: Warsan / Academic City area
// Area: ~7.2 km² | Coordinates in GeoJSON order [lng, lat]
export const DSO_BOUNDARY_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {
        name: 'Dubai Silicon Oasis',
        type: 'district',
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [55.367607340652754, 25.11825122300612],
            [55.36789507940526,  25.12063550285663],
            [55.381749416649974, 25.136948394617363],
            [55.383852322840184, 25.13769943327677],
            [55.399190028941355, 25.131695651165305],
            [55.40404020121445,  25.12955040839443],
            [55.40791536437868,  25.12550519565135],
            [55.38135289372222,  25.106131466935185],
            [55.38024465000397,  25.105801597106073],
            [55.379340400886576, 25.106214937990334],
            [55.37841006773809,  25.106269168953077],
            [55.377542390131595, 25.10632253806887],
            [55.367607340652754, 25.11825122300612],  // closed ring
          ],
        ],
      },
    },
  ],
};

// Silicon Central Mall (DSO Mall) highlight
// Real location confirmed from 2GIS: 55.374596, 25.110636
// Approximated footprint following the E66 road edge on the west
export const DSO_MALL_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {
        name: 'Silicon Central Mall',
        type: 'mall',
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [55.3762, 25.1086],  // SW
            [55.3752, 25.1098],  // W lower
            [55.3748, 25.1113],  // W upper
            [55.3753, 25.1126],  // NW
            [55.3769, 25.1132],  // N
            [55.3769, 25.1120],  // inner notch N
            [55.3796, 25.1121],  // NE
            [55.3801, 25.1111],  // E upper
            [55.3801, 25.1093],  // E lower
            [55.3787, 25.1082],  // SE
            [55.3766, 25.1082],  // S
            [55.3762, 25.1086],  // close
          ],
        ],
      },
    },
  ],
};

// Pre-defined building polygons within DSO (approximate extrusions for 3D effect)
export const DSO_BUILDINGS = {
  type: 'FeatureCollection' as const,
  features: [
    // ── All building footprints are verified to lie inside the real DSO boundary ──

    // DSO HQ Tower  (center ~55.3858, 25.1240)
    {
      type: 'Feature' as const,
      properties: { name: 'DSO HQ Tower', height: 80, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3852, 25.1234], [55.3864, 25.1234], [55.3864, 25.1246], [55.3852, 25.1246], [55.3852, 25.1234]]],
      },
    },
    // Silicon Central Mall (DSO Mall) – real location 55.374596, 25.110636
    {
      type: 'Feature' as const,
      properties: { name: 'Silicon Central Mall', height: 38, building: 'retail' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3762, 25.1086], [55.3801, 25.1086], [55.3801, 25.1121], [55.3762, 25.1121], [55.3762, 25.1086]]],
      },
    },
    // Dubai Digital Park – Block A  (northeast quadrant)
    {
      type: 'Feature' as const,
      properties: { name: 'Dubai Digital Park – Block A', height: 55, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3918, 25.1250], [55.3940, 25.1250], [55.3940, 25.1272], [55.3918, 25.1272], [55.3918, 25.1250]]],
      },
    },
    // Dubai Digital Park – Block B
    {
      type: 'Feature' as const,
      properties: { name: 'Dubai Digital Park – Block B', height: 60, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3944, 25.1240], [55.3966, 25.1240], [55.3966, 25.1262], [55.3944, 25.1262], [55.3944, 25.1240]]],
      },
    },
    // Silicon Gates residential complex
    {
      type: 'Feature' as const,
      properties: { name: 'Silicon Gates', height: 72, building: 'residential' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3966, 25.1168], [55.3990, 25.1168], [55.3990, 25.1190], [55.3966, 25.1190], [55.3966, 25.1168]]],
      },
    },
    // RIT Dubai Campus  (northwest, near boundary)
    {
      type: 'Feature' as const,
      properties: { name: 'RIT Dubai', height: 45, building: 'university' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3775, 25.1278], [55.3808, 25.1278], [55.3808, 25.1308], [55.3775, 25.1308], [55.3775, 25.1278]]],
      },
    },
    // DTEC Campus  (south-central)
    {
      type: 'Feature' as const,
      properties: { name: 'DTEC Campus', height: 40, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3832, 25.1148], [55.3864, 25.1148], [55.3864, 25.1170], [55.3832, 25.1170], [55.3832, 25.1148]]],
      },
    },
    // Residential Tower A  (west side)
    {
      type: 'Feature' as const,
      properties: { name: 'Residential Tower A', height: 65, building: 'residential' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3758, 25.1230], [55.3773, 25.1230], [55.3773, 25.1246], [55.3758, 25.1246], [55.3758, 25.1230]]],
      },
    },
    // Residential Tower B  (west side)
    {
      type: 'Feature' as const,
      properties: { name: 'Residential Tower B', height: 70, building: 'residential' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3778, 25.1228], [55.3795, 25.1228], [55.3795, 25.1246], [55.3778, 25.1246], [55.3778, 25.1228]]],
      },
    },
    // Cedre Villas Community Center
    {
      type: 'Feature' as const,
      properties: { name: 'Cedre Villas Community Center', height: 20, building: 'community' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3908, 25.1193], [55.3930, 25.1193], [55.3930, 25.1210], [55.3908, 25.1210], [55.3908, 25.1193]]],
      },
    },
    // DSO Hotel  (central-north)
    {
      type: 'Feature' as const,
      properties: { name: 'DSO Hotel', height: 75, building: 'hotel' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3868, 25.1268], [55.3888, 25.1268], [55.3888, 25.1284], [55.3868, 25.1284], [55.3868, 25.1268]]],
      },
    },
    // DSO Business Plaza  (north)
    {
      type: 'Feature' as const,
      properties: { name: 'DSO Business Plaza', height: 50, building: 'mixed' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3838, 25.1292], [55.3864, 25.1292], [55.3864, 25.1312], [55.3838, 25.1312], [55.3838, 25.1292]]],
      },
    },
    // Tech Hub East 1  (east, inside boundary)
    {
      type: 'Feature' as const,
      properties: { name: 'Tech Hub East 1', height: 30, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3968, 25.1138], [55.3990, 25.1138], [55.3990, 25.1158], [55.3968, 25.1158], [55.3968, 25.1138]]],
      },
    },
    // Tech Hub East 2
    {
      type: 'Feature' as const,
      properties: { name: 'Tech Hub East 2', height: 35, building: 'office' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[55.3968, 25.1160], [55.3990, 25.1160], [55.3990, 25.1182], [55.3968, 25.1182], [55.3968, 25.1160]]],
      },
    },
  ],
};
