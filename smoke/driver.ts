/**
 * Real-Cesium smoke-test driver (NFR-A-03 / M2).
 *
 * This file is bundled (esbuild) and loaded in a headless WebGL browser by the
 * Playwright smoke specs. Unlike the unit suite — which replaces `@cesium/engine`
 * with a mock — this drives the library's ACTUAL engine code against REAL Cesium,
 * so a Cesium upgrade (or a Node-only construct like `global.Math`) that breaks
 * the entity/geometry option shapes is caught here instead of silently passing
 * a mock-shaped unit suite (review-v2 M2, architecture-v2 §5).
 *
 * It deliberately drives the managers directly (no imagery/network) and exposes a
 * tiny `window.__smoke` API the specs call via `page.evaluate`.
 */
import { CesiumWidget, Cartesian3 } from '@cesium/engine';

import { BeamManager } from '../src/engines/cesium/managers/beam.manager';
import type { BeamDefinition } from '../src/core/models/beam.model';

const widget = new CesiumWidget('cesium', {
  baseLayer: false, // no imagery provider → no network
  skyBox: false,
  skyAtmosphere: false,
});
const scene = widget.scene;

// Draw commands are frustum-culled, so frame the beam region from high altitude
// (the cone is large by construction — CONE_LENGTH in beam.manager).
widget.camera.setView({ destination: Cartesian3.fromDegrees(0, 0, 80_000_000) });

const SAT = Cartesian3.fromDegrees(0, 0, 2_000_000);
const beams = new BeamManager(widget.entities, scene, 10, () => SAT);

const errors: string[] = [];
scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
  errors.push(String(error));
});

// Sample the peak per-frame draw-command count across a settle window, so async
// geometry workers have time to finish and emit commands.
let maxCommands = 0;
scene.postRender.addEventListener(() => {
  const frameState = (scene as unknown as { frameState?: { commandList?: unknown[] } }).frameState;
  const n = frameState && frameState.commandList ? frameState.commandList.length : 0;
  if (n > maxCommands) maxCommands = n;
});
const settle = (ms: number): Promise<number> =>
  new Promise((resolve) => {
    maxCommands = 0;
    setTimeout(() => resolve(maxCommands), ms);
  });

const circular: BeamDefinition = {
  id: 'b1',
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'circular', halfAngle: 2 },
};
const elliptical: BeamDefinition = {
  id: 'b1',
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'elliptical', azimuthHalfAngle: 3, elevationHalfAngle: 1 },
};
// A wide beam — the case the footprint-sizing bug crashed on. Footprint axes are
// now sized from the satellite's altitude and clamped to the visible horizon, so
// even an 80° beam yields a ground ellipse Cesium can triangulate (regression
// guard for the bug the M2 harness originally surfaced).
const wide: BeamDefinition = {
  id: 'b1',
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'circular', halfAngle: 80 },
};

const api = {
  errors: (): string[] => errors,
  setCircular: (): void => beams.syncBeams('s1', [circular]),
  setElliptical: (): void => beams.syncBeams('s1', [elliptical]),
  setWide: (): void => beams.syncBeams('s1', [wide]),
  showVolumes: (visible: boolean): void => beams.setVolumesVisible(visible),
  clear: (): void => beams.syncBeams('s1', []),
  settle,
};

(window as unknown as { __smoke: typeof api }).__smoke = api;
(window as unknown as { __ready: boolean }).__ready = true;
