import { useState, useCallback } from 'react';
import type { LayerVisibility, EnvironmentLayerVisibility } from '../types';

export function useLayerVisibility() {
  const [visibility, setVisibility] = useState<LayerVisibility>({
    boundary:       true,
    buildings:      true,
    roads:          true,
    parks:          true,
    water:          true,
    railways:       false,
    pois:           false,
    infrastructure: true,
    environment:    false, // Start with environment off
  });

  const [envLayers, setEnvLayers] = useState<EnvironmentLayerVisibility>({
    heatmap: true,  // Default: only heatmap on
    sensors: false,
    wind:    false,
    sources: false,
  });

  const toggle = useCallback((layer: keyof LayerVisibility) => {
    setVisibility((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const toggleEnvLayer = useCallback((layer: keyof EnvironmentLayerVisibility) => {
    setEnvLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  return { visibility, toggle, envLayers, toggleEnvLayer };
}
