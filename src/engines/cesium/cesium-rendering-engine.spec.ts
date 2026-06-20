import {
  CesiumWidget,
  ClockStep,
  Ion,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
} from '@cesium/engine';

import { CesiumRenderingEngine } from './cesium-rendering-engine';

const ISS_TLE = {
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
  line2: '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    15',
};

/**
 * Structural view of the jsdom-safe CesiumWidget mock (the runtime class
 * behind '@cesium/engine' in tests — see jest.config.mjs moduleNameMapper).
 * Real Cesium typings have no `lastInstance`/`options`, hence the casts.
 */
interface MockWidget {
  container: HTMLElement;
  options: { baseLayer?: { provider: object }; skyBox?: false; skyAtmosphere?: false };
  clock: { multiplier: number; clockStep: number; shouldAnimate: boolean };
  entities: { getById(id: string): object | undefined };
  isDestroyed(): boolean;
}

describe('CesiumRenderingEngine', () => {
  let engine: CesiumRenderingEngine;
  let container: HTMLElement;

  beforeEach(() => {
    engine = new CesiumRenderingEngine();
    container = document.createElement('div');
    Ion.defaultAccessToken = '';
  });

  const widget = (): MockWidget =>
    (CesiumWidget as unknown as { lastInstance: MockWidget }).lastInstance;

  describe('initialize', () => {
    it('creates a widget in the container with the free OSM provider by default', async () => {
      await engine.initialize(container, {});

      expect(widget().container).toBe(container);
      expect(widget().options.baseLayer!.provider).toBeInstanceOf(OpenStreetMapImageryProvider);
    });

    it('disables sky box and atmosphere for integrated-GPU performance', async () => {
      await engine.initialize(container, {});

      expect(widget().options.skyBox).toBe(false);
      expect(widget().options.skyAtmosphere).toBe(false);
    });

    it('starts the clock in realtime mode', async () => {
      await engine.initialize(container, {});

      expect(widget().clock.shouldAnimate).toBe(true);
      expect(widget().clock.clockStep).toBe(ClockStep.SYSTEM_CLOCK_MULTIPLIER);
    });

    it('uses the bundled Sentinel-2 satellite imagery when configured', async () => {
      await engine.initialize(container, { tileProvider: { type: 'satellite' } });

      const provider = widget().options.baseLayer!.provider;
      expect(provider).toBeInstanceOf(UrlTemplateImageryProvider);
      const { options } = provider as unknown as {
        options: { url: string; credit: string };
      };
      expect(options.url).toContain('s2cloudless');
      // CC BY 4.0 requires the attribution to travel with the imagery.
      expect(options.credit).toMatch(/EOX/);
    });

    it('uses a custom tile provider when configured', async () => {
      await engine.initialize(container, {
        tileProvider: { type: 'custom', url: 'https://tiles.example.com/{z}/{x}/{y}.png' },
      });

      expect(widget().options.baseLayer!.provider).toBeInstanceOf(UrlTemplateImageryProvider);
    });

    it('rejects a custom tile provider without a url', async () => {
      await expect(
        engine.initialize(container, { tileProvider: { type: 'custom' } })
      ).rejects.toThrow(/url is required/);
    });

    it('sets the Ion token only when one is supplied', async () => {
      await engine.initialize(container, { ionToken: 'token-123' });
      expect(Ion.defaultAccessToken).toBe('token-123');
    });

    it('leaves the Ion token untouched by default', async () => {
      await engine.initialize(container, {});
      expect(Ion.defaultAccessToken).toBe('');
    });

    it('rejects double initialization', async () => {
      await engine.initialize(container, {});
      await expect(engine.initialize(container, {})).rejects.toThrow(/called twice/);
    });
  });

  describe('before initialization', () => {
    it.each([
      ['addSatellite', () => engine.addSatellite({ id: 'x', tle: ISS_TLE })],
      ['updateSatellite', () => engine.updateSatellite('x', {})],
      ['removeSatellite', () => engine.removeSatellite('x')],
      [
        'addTerminal',
        () =>
          engine.addTerminal({
            id: 'x',
            position: { latitude: 0, longitude: 0, altitude: 0 },
          }),
      ],
      ['updateTerminal', () => engine.updateTerminal('x', {})],
      ['removeTerminal', () => engine.removeTerminal('x')],
      ['setTimeConfig', () => engine.setTimeConfig({ mode: 'realtime' })],
    ])('%s throws a clear not-initialized error', (_name, call) => {
      expect(call).toThrow(/not initialized/);
    });
  });

  describe('entity delegation', () => {
    beforeEach(async () => {
      await engine.initialize(container, {});
    });

    it('adds, updates, and removes satellites through the manager', () => {
      engine.addSatellite({ id: 'iss', tle: ISS_TLE });
      expect(widget().entities.getById('satellite:iss')).toBeDefined();

      engine.updateSatellite('iss', { label: 'ISS' });
      expect(widget().entities.getById('satellite:iss')).toMatchObject({
        label: { text: 'ISS' },
      });

      engine.removeSatellite('iss');
      expect(widget().entities.getById('satellite:iss')).toBeUndefined();
    });

    it('adds, updates, and removes terminals through the manager', () => {
      engine.addTerminal({ id: 't1', position: { latitude: 1, longitude: 2, altitude: 3 } });
      expect(widget().entities.getById('terminal:t1')).toBeDefined();

      engine.updateTerminal('t1', { label: 'Gateway' });
      expect(widget().entities.getById('terminal:t1')).toMatchObject({
        label: { text: 'Gateway' },
      });

      engine.removeTerminal('t1');
      expect(widget().entities.getById('terminal:t1')).toBeUndefined();
    });

    it('honors configured performance limits', async () => {
      const limited = new CesiumRenderingEngine();
      await limited.initialize(document.createElement('div'), {
        performance: { maxSatellites: 1, maxTerminals: 1 },
      });

      limited.addSatellite({ id: 'a', tle: ISS_TLE });
      expect(() => limited.addSatellite({ id: 'b', tle: ISS_TLE })).toThrow(/maxSatellites=1/);

      limited.addTerminal({ id: 'a', position: { latitude: 0, longitude: 0, altitude: 0 } });
      expect(() =>
        limited.addTerminal({ id: 'b', position: { latitude: 0, longitude: 0, altitude: 0 } })
      ).toThrow(/maxTerminals=1/);
    });

    it('applies time configuration to the clock', () => {
      engine.setTimeConfig({ mode: 'realtime', multiplier: 10 });
      expect(widget().clock.multiplier).toBe(10);
    });
  });

  describe('post-v1 surface', () => {
    beforeEach(async () => {
      await engine.initialize(container, {});
    });

    it('rejects custom entity operations with explicit errors', () => {
      const entity = {
        id: 'b1',
        position: { latitude: 0, longitude: 0, altitude: 0 },
        model: { url: 'b.glb', format: 'glb' as const },
      };
      expect(() => engine.addCustomEntity(entity)).toThrow(/not implemented in v1/);
      expect(() => engine.updateCustomEntity('b1', {})).toThrow(/not implemented in v1/);
      expect(() => engine.removeCustomEntity('b1')).toThrow(/not implemented in v1/);
    });

    it('rejects coverage configuration with explicit errors', () => {
      expect(() =>
        engine.setCoverageConfig({
          coveredColor: { r: 0, g: 255, b: 0, a: 1 },
          showLinkLines: false,
        })
      ).toThrow(/not implemented in v1/);
      expect(() => engine.setLinkLinesVisible(true)).toThrow(/not implemented in v1/);
    });

    it('exposes interaction streams that can be subscribed', () => {
      const click = jest.fn();
      const hover = jest.fn();
      const placed = jest.fn();
      engine.entityClick$.subscribe(click);
      engine.entityHover$.subscribe(hover);
      engine.terminalPlaced$.subscribe(placed);
      // Streams are part of the contract but do not emit until post-v1.
      expect(click).not.toHaveBeenCalled();
      expect(hover).not.toHaveBeenCalled();
      expect(placed).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('destroys the widget and is idempotent', async () => {
      await engine.initialize(container, {});
      const w = widget();

      engine.destroy();
      engine.destroy(); // Must not throw.

      expect(w.isDestroyed()).toBe(true);
      expect(() => engine.addSatellite({ id: 'x', tle: ISS_TLE })).toThrow(/not initialized/);
    });

    it('is a no-op before initialization', () => {
      expect(() => engine.destroy()).not.toThrow();
    });

    it('allows re-initialization after destroy', async () => {
      await engine.initialize(container, {});
      engine.destroy();
      await expect(engine.initialize(container, {})).resolves.toBeUndefined();
    });
  });
});
