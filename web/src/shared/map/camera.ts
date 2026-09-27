/** Camera presets. Kept out of MapCanvas.tsx so that file exports only a component. */

export interface MapCamera {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
}

/** The emirate at a glance — the Operations resting view. */
export const DUBAI_CAMERA: MapCamera = { center: [55.29, 25.16], zoom: 10.2, pitch: 0, bearing: 0 };

/** Dubai Silicon Oasis, pitched — the close-up scene the detail geometry covers. */
export const DSO_CAMERA: MapCamera = { center: [55.3872, 25.1199], zoom: 14.5, pitch: 50, bearing: -55 };
