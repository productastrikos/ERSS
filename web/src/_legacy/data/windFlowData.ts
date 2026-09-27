// Wind Flow Data for DSO Environment Monitoring
// Real-time wind patterns for pollution dispersion modeling

export interface WindVector {
  id: string;
  start: [number, number]; // [lng, lat]
  end: [number, number];   // [lng, lat]
  speed: number; // km/h
  direction: number; // degrees (0-360, 0=North, 90=East, 180=South, 270=West)
  altitude: number; // meters above ground
  timestamp: number;
}

// Wind direction: Current prevailing NW-SE (135-150 degrees)
// Wind speed: 12-18 km/h (moderate breeze)
// Generate wind flow vectors across DSO grid

const BASE_WIND_DIRECTION = 140; // SE direction
const BASE_WIND_SPEED = 15; // km/h
const VECTOR_LENGTH = 0.002; // degrees (~200m arrows)

// Helper to calculate end point based on direction and speed
const calculateEndPoint = (
  start: [number, number],
  direction: number,
  speed: number
): [number, number] => {
  const radians = (direction - 90) * (Math.PI / 180); // Convert to math angle
  const scale = VECTOR_LENGTH * (speed / BASE_WIND_SPEED);
  return [
    start[0] + Math.cos(radians) * scale,
    start[1] + Math.sin(radians) * scale,
  ];
};

// Add natural variation to wind
// const varyWind = (base: number, variation: number) =>
//   base + (Math.random() - 0.5) * variation;

// Generate grid of wind vectors across DSO
export const windFlowVectors: WindVector[] = [];

const gridRows = 8;
const gridCols = 10;
const latMin = 25.1200;
const latMax = 25.1350;
const lngMin = 55.3710;
const lngMax = 55.3960;

const latStep = (latMax - latMin) / gridRows;
const lngStep = (lngMax - lngMin) / gridCols;

let vectorId = 0;

for (let row = 0; row < gridRows; row++) {
  for (let col = 0; col < gridCols; col++) {
    const lat = latMin + row * latStep + latStep / 2;
    const lng = lngMin + col * lngStep + lngStep / 2;
    
    // Add variation based on terrain (more variation near buildings/roads)
    const directionVariation = Math.random() * 20 - 10; // ±10 degrees
    const speedVariation = Math.random() * 6 - 3; // ±3 km/h
    
    const direction = BASE_WIND_DIRECTION + directionVariation;
    const speed = Math.max(5, BASE_WIND_SPEED + speedVariation);
    
    const start: [number, number] = [lng, lat];
    const end = calculateEndPoint(start, direction, speed);
    
    windFlowVectors.push({
      id: `WIND-${String(vectorId++).padStart(3, '0')}`,
      start,
      end,
      speed: parseFloat(speed.toFixed(1)),
      direction: Math.round(direction) % 360,
      altitude: 10, // 10m above ground
      timestamp: Date.now(),
    });
  }
}

// Add higher altitude wind vectors (show layered wind patterns)
const highAltitudeVectors: WindVector[] = [];

for (let i = 0; i < 20; i++) {
  const lat = latMin + Math.random() * (latMax - latMin);
  const lng = lngMin + Math.random() * (lngMax - lngMin);
  
  // Higher altitude wind is faster and more consistent
  const direction = BASE_WIND_DIRECTION + (Math.random() - 0.5) * 15;
  const speed = BASE_WIND_SPEED + 8 + Math.random() * 5; // 23-28 km/h
  
  const start: [number, number] = [lng, lat];
  const end = calculateEndPoint(start, direction, speed * 1.5);
  
  highAltitudeVectors.push({
    id: `WIND-HIGH-${String(i).padStart(2, '0')}`,
    start,
    end,
    speed: parseFloat(speed.toFixed(1)),
    direction: Math.round(direction) % 360,
    altitude: 50, // 50m above ground
    timestamp: Date.now(),
  });
}

windFlowVectors.push(...highAltitudeVectors);

// Get wind direction label
export const getWindDirectionLabel = (degrees: number): string => {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return 'N';
  if (normalized < 67.5) return 'NE';
  if (normalized < 112.5) return 'E';
  if (normalized < 157.5) return 'SE';
  if (normalized < 202.5) return 'S';
  if (normalized < 247.5) return 'SW';
  if (normalized < 292.5) return 'W';
  return 'NW';
};

// Get wind speed category
export const getWindSpeedCategory = (speed: number): string => {
  if (speed < 5) return 'Calm';
  if (speed < 12) return 'Light Breeze';
  if (speed < 20) return 'Moderate Breeze';
  if (speed < 30) return 'Fresh Breeze';
  if (speed < 40) return 'Strong Breeze';
  return 'Gale';
};

// Calculate pollution dispersion factor (higher wind = better dispersion)
export const getDispersionFactor = (windSpeed: number): number => {
  if (windSpeed < 5) return 0.3; // Poor dispersion (pollution accumulates)
  if (windSpeed < 12) return 0.6; // Moderate dispersion
  if (windSpeed < 20) return 0.8; // Good dispersion
  return 1.0; // Excellent dispersion
};

// Simulate wind change (for dynamic updates)
export const updateWindPattern = (
  newDirection?: number,
  newSpeed?: number
): void => {
  const targetDirection = newDirection ?? BASE_WIND_DIRECTION;
  const targetSpeed = newSpeed ?? BASE_WIND_SPEED;
  
  windFlowVectors.forEach((vector) => {
    if (vector.altitude === 10) {
      // Ground level - more variation
      const directionVar = (Math.random() - 0.5) * 20;
      const speedVar = (Math.random() - 0.5) * 6;
      
      vector.direction = Math.round(targetDirection + directionVar) % 360;
      vector.speed = Math.max(5, targetSpeed + speedVar);
    } else {
      // High altitude - more consistent
      const directionVar = (Math.random() - 0.5) * 15;
      const speedVar = (Math.random() - 0.5) * 5;
      
      vector.direction = Math.round(targetDirection + directionVar) % 360;
      vector.speed = Math.max(15, targetSpeed + 8 + speedVar);
    }
    
    vector.end = calculateEndPoint(vector.start, vector.direction, vector.speed);
    vector.timestamp = Date.now();
  });
};

export default windFlowVectors;
