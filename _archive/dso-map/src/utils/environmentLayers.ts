// Environment Visualization Layers for DSO Map
// Comprehensive deck.gl layers for AQI heatmap, sensors, wind flow, and pollution sources

import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { environmentSensors, getAQIColor, type EnvironmentSensor } from '../data/environmentSensors';
import { windFlowVectors, type WindVector } from '../data/windFlowData';
import { pollutionSources, getEmissionRateColor, type PollutionSource } from '../data/pollutionSources';

// ============================================================================
// AQI HEATMAP LAYER
// ============================================================================

export const createAQIHeatmapLayer = (
  visible: boolean = true,
  opacity: number = 0.6
) => {
  return new HeatmapLayer({
    id: 'aqi-heatmap',
    data: environmentSensors,
    visible,
    opacity,
    
    // Position
    getPosition: (d: EnvironmentSensor) => d.location,
    
    // Weight by AQI value (normalized 0-1)
    getWeight: (d: EnvironmentSensor) => d.aqi / 300,
    
    // Heatmap parameters
    radiusPixels: 80,
    intensity: 2,
    threshold: 0.05,
    
    // AQI color gradient (Green → Yellow → Orange → Red → Purple)
    colorRange: [
      [0, 228, 0],      // Green (0-50 Good)
      [255, 255, 0],    // Yellow (51-100 Moderate)
      [255, 126, 0],    // Orange (101-150 Unhealthy for Sensitive)
      [255, 0, 0],      // Red (151-200 Unhealthy)
      [143, 63, 151],   // Purple (201-300 Very Unhealthy)
      [126, 0, 35],     // Maroon (301+ Hazardous)
    ],
    
    // Aggregation
    aggregation: 'SUM' as const,
    
    // Update settings
    updateTriggers: {
      getWeight: environmentSensors.map(s => s.aqi),
    },
  });
};

// ============================================================================
// SENSOR POINTS LAYER
// ============================================================================

export const createSensorPointsLayer = (
  visible: boolean = true,
  onSensorClick?: (sensor: EnvironmentSensor) => void,
  onSensorHover?: (sensor: EnvironmentSensor | null, x: number, y: number) => void,
) => {
  return new ScatterplotLayer<EnvironmentSensor>({
    id: 'environment-sensors',
    data: environmentSensors,
    visible,
    pickable: true,
    
    // Position
    getPosition: (d: EnvironmentSensor) => d.location,
    
    // Size based on AQI severity
    getRadius: (d: EnvironmentSensor) => {
      if (d.status === 'critical') return 60;
      if (d.status === 'warning') return 45;
      return 35;
    },
    
    // Color by AQI level
    getFillColor: (d: EnvironmentSensor) => {
      const color = getAQIColor(d.aqi);
      return hexToRGB(color);
    },
    
    // Border
    getLineColor: [255, 255, 255, 200],
    getLineWidth: 3,
    lineWidthMinPixels: 2,
    lineWidthMaxPixels: 4,
    
    // Interaction
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    
    // Click handler
    onClick: (info) => {
      if (info.object && onSensorClick) {
        onSensorClick(info.object);
      }
    },

    // Hover handler
    onHover: (info) => {
      if (onSensorHover) {
        onSensorHover(info.object ?? null, info.x, info.y);
      }
    },
    
    // Update settings
    updateTriggers: {
      getFillColor: environmentSensors.map(s => s.aqi),
      getRadius: environmentSensors.map(s => s.status),
    },
  });
};

// ============================================================================
// SENSOR LABELS LAYER
// ============================================================================

export const createSensorLabelsLayer = (
  visible: boolean = true,
  showOnlyWarnings: boolean = false
) => {
  const filteredSensors = showOnlyWarnings
    ? environmentSensors.filter(s => s.status !== 'normal')
    : environmentSensors;

  return new TextLayer<EnvironmentSensor>({
    id: 'sensor-labels',
    data: filteredSensors,
    visible,
    
    // Position (slightly offset above sensor point)
    getPosition: (d: EnvironmentSensor) => [...d.location, 50] as [number, number, number],
    
    // Text content
    getText: (d: EnvironmentSensor) => `${d.aqi}`,
    
    // Style
    getColor: [255, 255, 255, 255],
    getSize: 14,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    
    // Background
    background: true,
    getBackgroundColor: (d: EnvironmentSensor) => {
      const color = getAQIColor(d.aqi);
      const rgb = hexToRGB(color);
      return [...rgb, 200] as [number, number, number, number];
    },
    backgroundPadding: [4, 2],
    
    // Alignment
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    
    // Billboard (always face camera)
    billboard: true,
    
    // Update settings
    updateTriggers: {
      getText: filteredSensors.map(s => s.aqi),
      getBackgroundColor: filteredSensors.map(s => s.aqi),
    },
  });
};

// ============================================================================
// WIND FLOW LAYER
// ============================================================================

export const createWindFlowLayer = (
  visible: boolean = true
) => {
  return new LineLayer<WindVector>({
    id: 'wind-flow',
    data: windFlowVectors,
    visible,
    
    // Position
    getSourcePosition: (d: WindVector) => d.start,
    getTargetPosition: (d: WindVector) => d.end,
    
    // Style
    getColor: (d: WindVector) => {
      // Higher altitude = lighter color
      if (d.altitude > 30) return [180, 220, 255, 180]; // Light blue
      return [255, 255, 255, 160]; // White
    },
    
    // Width based on wind speed
    getWidth: (d: WindVector) => d.speed / 3,
    widthMinPixels: 1.5,
    widthMaxPixels: 4,
    
    // Arrow
    extensions: [],
    
    // Update settings
    updateTriggers: {
      getSourcePosition: windFlowVectors.map(v => v.timestamp),
      getTargetPosition: windFlowVectors.map(v => v.timestamp),
      getWidth: windFlowVectors.map(v => v.speed),
    },
  });
};

// ============================================================================
// WIND ARROW HEADS LAYER (for directional indication)
// ============================================================================

export const createWindArrowHeadsLayer = (
  visible: boolean = true
) => {
  // Create arrow heads at the end of each wind vector
  const arrowHeads = windFlowVectors.map(vector => {
    const angle = (vector.direction - 90) * (Math.PI / 180);
    const arrowSize = 0.0003; // degrees
    
    // Calculate two points for arrow head (triangle shape)
    const left: [number, number] = [
      vector.end[0] - Math.cos(angle + 2.8) * arrowSize,
      vector.end[1] - Math.sin(angle + 2.8) * arrowSize,
    ];
    const right: [number, number] = [
      vector.end[0] - Math.cos(angle - 2.8) * arrowSize,
      vector.end[1] - Math.sin(angle - 2.8) * arrowSize,
    ];
    
    return { vector, left, right };
  });

  // Create two line layers for the arrow head prongs
  return [
    new LineLayer({
      id: 'wind-arrows-left',
      data: arrowHeads,
      visible,
      getSourcePosition: (d: any) => d.vector.end,
      getTargetPosition: (d: any) => d.left,
      getColor: (d: any) => d.vector.altitude > 30 ? [180, 220, 255, 180] : [255, 255, 255, 160],
      getWidth: 2,
      widthMinPixels: 1.5,
    }),
    new LineLayer({
      id: 'wind-arrows-right',
      data: arrowHeads,
      visible,
      getSourcePosition: (d: any) => d.vector.end,
      getTargetPosition: (d: any) => d.right,
      getColor: (d: any) => d.vector.altitude > 30 ? [180, 220, 255, 180] : [255, 255, 255, 160],
      getWidth: 2,
      widthMinPixels: 1.5,
    }),
  ];
};

// ============================================================================
// POLLUTION SOURCES LAYER
// ============================================================================

export const createPollutionSourcesLayer = (
  visible: boolean = true,
  onSourceClick?: (source: PollutionSource) => void,
  onSourceHover?: (source: PollutionSource | null, x: number, y: number) => void,
) => {
  return new ScatterplotLayer<PollutionSource>({
    id: 'pollution-sources',
    data: pollutionSources,
    visible,
    pickable: true,
    
    // Position
    getPosition: (d: PollutionSource) => d.location,
    
    // Size based on emission rate
    getRadius: (d: PollutionSource) => {
      switch (d.emissionRate) {
        case 'critical': return 80;
        case 'high': return 60;
        case 'medium': return 45;
        case 'low': return 30;
      }
    },
    
    // Color by emission rate
    getFillColor: (d: PollutionSource) => {
      const color = getEmissionRateColor(d.emissionRate);
      const rgb = hexToRGB(color);
      return [...rgb, 180] as [number, number, number, number];
    },
    
    // Border
    getLineColor: [0, 0, 0, 200],
    getLineWidth: 2,
    lineWidthMinPixels: 2,
    
    // Interaction
    autoHighlight: true,
    highlightColor: [255, 140, 0, 200],
    
    // Click handler
    onClick: (info) => {
      if (info.object && onSourceClick) {
        onSourceClick(info.object);
      }
    },

    // Hover handler
    onHover: (info) => {
      if (onSourceHover) {
        onSourceHover(info.object ?? null, info.x, info.y);
      }
    },
    
    // Update settings
    updateTriggers: {
      getFillColor: pollutionSources.map(s => s.emissionRate),
    },
  });
};

// ============================================================================
// POLLUTION SOURCE LABELS LAYER
// ============================================================================

export const createPollutionSourceLabelsLayer = (
  visible: boolean = true,
  showOnlyCritical: boolean = false
) => {
  const filteredSources = showOnlyCritical
    ? pollutionSources.filter(s => s.emissionRate === 'critical')
    : pollutionSources;

  return new TextLayer<PollutionSource>({
    id: 'pollution-source-labels',
    data: filteredSources,
    visible,
    
    // Position (offset above source point)
    getPosition: (d: PollutionSource) => [...d.location, 50] as [number, number, number],
    
    // Text content
    getText: (d: PollutionSource) => d.name.split(' ').slice(0, 2).join(' '), // First 2 words
    
    // Style
    getColor: [255, 255, 255, 255],
    getSize: 11,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    
    // Background
    background: true,
    getBackgroundColor: (d: PollutionSource) => {
      const color = getEmissionRateColor(d.emissionRate);
      const rgb = hexToRGB(color);
      return [...rgb, 220] as [number, number, number, number];
    },
    backgroundPadding: [6, 3],
    
    // Alignment
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    
    // Billboard
    billboard: true,
  });
};

// ============================================================================
// POLLUTION PLUME LAYER (affected radius visualization)
// ============================================================================

export const createPollutionPlumeLayer = (
  visible: boolean = true,
  sourceId?: string
) => {
  const activeSources = sourceId
    ? pollutionSources.filter(s => s.id === sourceId)
    : pollutionSources.filter(s => s.emissionRate === 'critical' || s.emissionRate === 'high');

  return new ScatterplotLayer<PollutionSource>({
    id: 'pollution-plumes',
    data: activeSources,
    visible,
    
    // Position
    getPosition: (d: PollutionSource) => d.location,
    
    // Radius by affected area
    getRadius: (d: PollutionSource) => d.affectedRadius,
    radiusScale: 1,
    radiusMinPixels: 0,
    radiusMaxPixels: 500,
    
    // Semi-transparent fill
    getFillColor: (d: PollutionSource) => {
      const color = getEmissionRateColor(d.emissionRate);
      const rgb = hexToRGB(color);
      return [...rgb, 40] as [number, number, number, number]; // Very transparent
    },
    
    // No border for plumes
    stroked: false,
    
    // Update settings
    updateTriggers: {
      getFillColor: activeSources.map(s => s.emissionRate),
      getRadius: activeSources.map(s => s.affectedRadius),
    },
  });
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Convert hex color to RGB array
function hexToRGB(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [128, 128, 128]; // Default gray
}

// ============================================================================
// LAYER CONTROLLER - Create all environment layers at once
// ============================================================================

export interface EnvironmentLayerConfig {
  heatmap?: { visible: boolean; opacity: number };
  sensors?: { visible: boolean; showLabels: boolean; showOnlyWarnings: boolean };
  wind?: { visible: boolean };
  sources?: { visible: boolean; showLabels: boolean; showOnlyCritical: boolean; showPlumes: boolean };
}

export const createEnvironmentLayers = (
  config: EnvironmentLayerConfig,
  callbacks?: {
    onSensorClick?: (sensor: EnvironmentSensor) => void;
    onSourceClick?: (source: PollutionSource) => void;
    onSensorHover?: (sensor: EnvironmentSensor | null, x: number, y: number) => void;
    onSourceHover?: (source: PollutionSource | null, x: number, y: number) => void;
  }
) => {
  const layers: any[] = [];

  // AQI Heatmap
  if (config.heatmap) {
    layers.push(createAQIHeatmapLayer(config.heatmap.visible, config.heatmap.opacity));
  }

  // Pollution Plumes (render before sources so sources are on top)
  if (config.sources?.showPlumes) {
    layers.push(createPollutionPlumeLayer(config.sources.visible));
  }

  // Pollution Sources
  if (config.sources) {
    layers.push(createPollutionSourcesLayer(
      config.sources.visible,
      callbacks?.onSourceClick,
      callbacks?.onSourceHover,
    ));
    if (config.sources.showLabels) {
      layers.push(createPollutionSourceLabelsLayer(
        config.sources.visible,
        config.sources.showOnlyCritical
      ));
    }
  }

  // Environment Sensors
  if (config.sensors) {
    layers.push(createSensorPointsLayer(
      config.sensors.visible,
      callbacks?.onSensorClick,
      callbacks?.onSensorHover,
    ));
    if (config.sensors.showLabels) {
      layers.push(createSensorLabelsLayer(
        config.sensors.visible,
        config.sensors.showOnlyWarnings
      ));
    }
  }

  // Wind Flow
  if (config.wind) {
    layers.push(createWindFlowLayer(config.wind.visible));
    const arrowLayers = createWindArrowHeadsLayer(config.wind.visible);
    layers.push(...arrowLayers);
  }

  return layers;
};

export default {
  createAQIHeatmapLayer,
  createSensorPointsLayer,
  createSensorLabelsLayer,
  createWindFlowLayer,
  createWindArrowHeadsLayer,
  createPollutionSourcesLayer,
  createPollutionSourceLabelsLayer,
  createPollutionPlumeLayer,
  createEnvironmentLayers,
};
