import { test, expect } from '@playwright/test';

/**
 * Real-Cesium smoke tests (NFR-A-03 / M2). These render the library's actual
 * BeamManager output in a headless WebGL browser and assert it renders without
 * Cesium errors — the guard the unit mock cannot provide (review-v2 M2). Shape
 * CORRECTNESS (elliptical scale, precedence, etc.) is exhaustively covered by the
 * fast unit suite; here we validate PRESENCE/BEHAVIOR against real Cesium
 * (architecture-v2 §5).
 *
 * What this harness caught during development (the point of the gate):
 *  1. `global.Math` in beam.manager.ts — Node-only global, crashes in a browser;
 *     the unit suite (node/jsdom) never saw it. FIXED.
 *  2. The original entity-cylinder VOLUME (length 50,000 km) threw in Cesium's
 *     geometry pipeline ("All attribute lists must have the same number of
 *     attributes" in splitLongitude) because its world-space fill spans the
 *     antimeridian. FIXED by M1: the volume is now a local-space Primitive whose
 *     object-space geometry is placed by a non-uniform modelMatrix (the
 *     elliptical cone), so Cesium never world-splits it. The volume specs below
 *     now assert it renders.
 */
type Smoke = {
  errors(): string[];
  setCircular(): void;
  setElliptical(): void;
  setWide(): void;
  showVolumes(visible: boolean): void;
  clear(): void;
  settle(ms: number): Promise<number>;
};
declare global {
  interface Window {
    __smoke: Smoke;
    __ready: boolean;
  }
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(String(e)));
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 30000 });
  // A Node-only construct reaching the browser (e.g. the former `global.Math`)
  // would surface here as an uncaught page error rather than a silent no-op.
  expect(failures).toEqual([]);
});

test('beams + footprint render in real Cesium (global.Math browser-safety, footprint)', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const s = window.__smoke;
    // Volumes off (the default): exercises BeamManager end-to-end in a real
    // browser — building geometry, the footprint ellipse, the orientation frame —
    // which is exactly the path the `global.Math` bug crashed.
    s.setCircular();
    const commands = await s.settle(2500);
    return { commands, errors: s.errors() };
  });
  expect(result.errors).toEqual([]);
  expect(result.commands).toBeGreaterThan(0);
});

test('a wide beam footprint triangulates in real Cesium (footprint-sizing fix)', async ({
  page,
}) => {
  // Regression guard: an 80° beam previously sized its footprint by projecting
  // tan(halfAngle) over the 50,000 km cone length, yielding an Earth-sized ellipse
  // that threw in Cesium's geometry pipeline. The footprint is now sized from the
  // satellite's altitude and clamped to the horizon, so it must render cleanly.
  const result = await page.evaluate(async () => {
    const s = window.__smoke;
    s.setWide();
    const commands = await s.settle(2500);
    return { commands, errors: s.errors() };
  });
  expect(result.errors).toEqual([]);
  expect(result.commands).toBeGreaterThan(0);
});

test('circular beam volume renders in real Cesium when toggled on (M1)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const s = window.__smoke;
    s.setCircular();
    s.showVolumes(false);
    const off = await s.settle(2000);
    s.showVolumes(true);
    const on = await s.settle(2500);
    return { off, on, errors: s.errors() };
  });
  expect(result.errors).toEqual([]);
  // The local-space cone primitive adds draw commands on top of the footprint.
  expect(result.on).toBeGreaterThan(result.off);
});

test('elliptical beam volume renders in real Cesium (M1 elliptical cone)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const s = window.__smoke;
    s.setElliptical();
    s.showVolumes(true);
    const on = await s.settle(2500);
    s.showVolumes(false);
    const off = await s.settle(2000);
    return { on, off, errors: s.errors() };
  });
  expect(result.errors).toEqual([]);
  // The non-uniform-scaled elliptical cone is accepted by real Cesium and renders.
  expect(result.on).toBeGreaterThan(result.off);
});
