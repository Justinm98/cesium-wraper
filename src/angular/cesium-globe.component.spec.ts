import { NgZone } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SatelliteConfig } from '../core/models/satellite.model';
import { createMockEngine, MockRenderingEngine } from './__mocks__/rendering-engine.mock';
import { CesiumGlobeComponent } from './cesium-globe.component';
import { GLOBE_CONFIG, RENDERING_ENGINE } from './tokens';

const sat = (id: string, label?: string): SatelliteConfig => ({
  id,
  tle: { line1: 'l1', line2: 'l2' },
  ...(label !== undefined ? { label } : {}),
});

describe('CesiumGlobeComponent', () => {
  let fixture: ComponentFixture<CesiumGlobeComponent>;
  let engine: MockRenderingEngine;

  /** Initializes the component and flushes the async engine startup. */
  const init = async (): Promise<void> => {
    fixture.detectChanges(); // Triggers ngOnInit.
    await fixture.whenStable();
  };

  const configure = (providers: object[] = []): void => {
    engine = createMockEngine();
    TestBed.configureTestingModule({
      imports: [CesiumGlobeComponent],
      providers: [{ provide: RENDERING_ENGINE, useValue: engine }, ...providers],
    });
    fixture = TestBed.createComponent(CesiumGlobeComponent);
  };

  describe('initialization', () => {
    beforeEach(() => configure());

    it('initializes the engine with the container element and empty config', async () => {
      await init();

      expect(engine.initialize).toHaveBeenCalledTimes(1);
      const [container, config] = (engine.initialize as jest.Mock).mock.calls[0];
      expect(container).toBeInstanceOf(HTMLElement);
      expect(config).toEqual({});
    });

    it('prefers the globeConfig input over the injected default', async () => {
      fixture.componentRef.setInput('globeConfig', { ionToken: 'abc' });
      await init();

      expect(engine.initialize).toHaveBeenCalledWith(expect.any(HTMLElement), {
        ionToken: 'abc',
      });
    });

    it('applies inputs that were bound before the engine became ready', async () => {
      fixture.componentRef.setInput('satellites', [sat('s1')]);
      fixture.componentRef.setInput('timeConfig', { mode: 'realtime' });
      await init();

      expect(engine.addSatellite).toHaveBeenCalledWith(sat('s1'));
      expect(engine.setTimeConfig).toHaveBeenCalledWith({ mode: 'realtime' });
    });

    it('does not touch the engine before initialization completes', () => {
      fixture.componentRef.setInput('satellites', [sat('s1')]);
      // No detectChanges yet — ngOnInit has not run.
      expect(engine.addSatellite).not.toHaveBeenCalled();
    });

    it('initializes the engine outside the Angular zone (H1)', async () => {
      const zone = TestBed.inject(NgZone);
      const outsideSpy = jest.spyOn(zone, 'runOutsideAngular');
      await init();

      expect(outsideSpy).toHaveBeenCalled();
      // The engine call must happen within the outside-zone callback.
      expect(engine.initialize).toHaveBeenCalledTimes(1);
    });

    it('emits initError instead of an unhandled rejection when init fails (H2)', async () => {
      const failure = new Error('WebGL unavailable');
      (engine.initialize as jest.Mock).mockRejectedValue(failure);
      const errors: Error[] = [];
      fixture.componentInstance.initError.subscribe((e) => errors.push(e));

      await init();
      fixture.componentRef.setInput('satellites', [sat('s1')]);
      fixture.detectChanges();

      expect(errors).toEqual([failure]);
      // The component must stay inert after a failed init.
      expect(engine.addSatellite).not.toHaveBeenCalled();
    });

    it('wraps non-Error rejection reasons in an Error (H2)', async () => {
      (engine.initialize as jest.Mock).mockRejectedValue('boom');
      const errors: Error[] = [];
      fixture.componentInstance.initError.subscribe((e) => errors.push(e));

      await init();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('boom');
    });

    it('handles destruction while initialization is in flight (H3)', async () => {
      let resolveInit!: () => void;
      (engine.initialize as jest.Mock).mockReturnValue(
        new Promise<void>((resolve) => (resolveInit = resolve))
      );
      fixture.componentRef.setInput('satellites', [sat('s1')]);
      fixture.detectChanges(); // ngOnInit starts, awaits initialize.

      fixture.destroy(); // ngOnDestroy runs first.
      resolveInit();
      await new Promise<void>((resolve) => setTimeout(resolve));

      // The late continuation must clean up, not sync entities.
      expect(engine.addSatellite).not.toHaveBeenCalled();
      expect(engine.destroy).toHaveBeenCalled();
    });
  });

  describe('with an application-wide default config', () => {
    it('falls back to the provideGlobe() config when no input is given', async () => {
      configure([{ provide: GLOBE_CONFIG, useValue: { assetBaseUrl: 'cdn/models' } }]);
      await init();

      expect(engine.initialize).toHaveBeenCalledWith(expect.any(HTMLElement), {
        assetBaseUrl: 'cdn/models',
      });
    });
  });

  describe('entity diffing', () => {
    beforeEach(async () => {
      configure();
      await init();
    });

    const setSatellites = (value: readonly SatelliteConfig[]): void => {
      fixture.componentRef.setInput('satellites', value);
      fixture.detectChanges();
    };

    it('adds only new entities when the array grows', () => {
      // The same object reference must be reused: a fresh reference would
      // (correctly) be treated as an update by the differ.
      const s1 = sat('s1');
      setSatellites([s1]);
      setSatellites([s1, sat('s2')]);

      expect(engine.addSatellite).toHaveBeenCalledTimes(2);
      expect(engine.updateSatellite).not.toHaveBeenCalled();
      expect(engine.removeSatellite).not.toHaveBeenCalled();
    });

    it('updates entities whose object reference changed', () => {
      const original = sat('s1');
      setSatellites([original]);
      const renamed = sat('s1', 'Renamed');
      setSatellites([renamed]);

      expect(engine.updateSatellite).toHaveBeenCalledWith('s1', renamed);
      expect(engine.addSatellite).toHaveBeenCalledTimes(1);
    });

    it('does not update entities whose reference is unchanged', () => {
      const stable = sat('s1');
      setSatellites([stable]);
      setSatellites([stable, sat('s2')]);

      expect(engine.updateSatellite).not.toHaveBeenCalled();
    });

    it('removes entities missing from the new array', () => {
      setSatellites([sat('s1'), sat('s2')]);
      setSatellites([sat('s2')]);

      expect(engine.removeSatellite).toHaveBeenCalledWith('s1');
      expect(engine.removeSatellite).toHaveBeenCalledTimes(1);
    });

    it('diffs terminals and custom entities the same way', () => {
      const terminal = { id: 't1', position: { latitude: 0, longitude: 0, altitude: 0 } };
      const custom = {
        id: 'c1',
        position: { latitude: 0, longitude: 0, altitude: 0 },
        model: { url: 'b.glb', format: 'glb' as const },
      };
      fixture.componentRef.setInput('terminals', [terminal]);
      fixture.componentRef.setInput('customEntities', [custom]);
      fixture.detectChanges();

      expect(engine.addTerminal).toHaveBeenCalledWith(terminal);
      expect(engine.addCustomEntity).toHaveBeenCalledWith(custom);

      fixture.componentRef.setInput('terminals', []);
      fixture.componentRef.setInput('customEntities', []);
      fixture.detectChanges();

      expect(engine.removeTerminal).toHaveBeenCalledWith('t1');
      expect(engine.removeCustomEntity).toHaveBeenCalledWith('c1');
    });
  });

  describe('time and coverage changes', () => {
    beforeEach(async () => {
      configure();
      await init();
    });

    it('forwards timeConfig changes', () => {
      fixture.componentRef.setInput('timeConfig', { mode: 'realtime', multiplier: 5 });
      fixture.detectChanges();

      expect(engine.setTimeConfig).toHaveBeenCalledWith({ mode: 'realtime', multiplier: 5 });
    });

    it('forwards coverageConfig changes', () => {
      const coverage = { coveredColor: { r: 0, g: 255, b: 0, a: 1 }, showLinkLines: true };
      fixture.componentRef.setInput('coverageConfig', coverage);
      fixture.detectChanges();

      expect(engine.setCoverageConfig).toHaveBeenCalledWith(coverage);
    });

    it('does not reapply time config on unrelated input changes', () => {
      fixture.componentRef.setInput('satellites', [sat('s1')]);
      fixture.detectChanges();

      expect(engine.setTimeConfig).not.toHaveBeenCalled();
    });
  });

  describe('outputs', () => {
    beforeEach(async () => {
      configure();
      await init();
    });

    it('re-emits engine click, hover, and placement events', () => {
      const clicked = jest.fn();
      const hovered = jest.fn();
      const placed = jest.fn();
      fixture.componentInstance.entityClicked.subscribe(clicked);
      fixture.componentInstance.entityHovered.subscribe(hovered);
      fixture.componentInstance.terminalPlaced.subscribe(placed);

      engine.clickSubject.next({ entityId: 's1', entityType: 'satellite', data: { a: 1 } });
      engine.hoverSubject.next({ entityId: 't1', entityType: 'terminal', data: {} });
      engine.placedSubject.next({ position: { latitude: 1, longitude: 2, altitude: 0 } });

      expect(clicked).toHaveBeenCalledWith({
        entityId: 's1',
        entityType: 'satellite',
        data: { a: 1 },
      });
      expect(hovered).toHaveBeenCalledWith({ entityId: 't1', entityType: 'terminal', data: {} });
      expect(placed).toHaveBeenCalledWith({ position: { latitude: 1, longitude: 2, altitude: 0 } });
    });
  });

  describe('destroy', () => {
    it('destroys the engine and stops forwarding events', async () => {
      configure();
      await init();
      const clicked = jest.fn();
      fixture.componentInstance.entityClicked.subscribe(clicked);

      fixture.destroy();
      engine.clickSubject.next({ entityId: 's1', entityType: 'satellite', data: {} });

      expect(engine.destroy).toHaveBeenCalledTimes(1);
      expect(clicked).not.toHaveBeenCalled();
    });
  });
});
