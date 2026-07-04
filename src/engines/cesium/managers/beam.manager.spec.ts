import { Cartesian3, CesiumWidget, EntityCollection, JulianDate, Scene } from '@cesium/engine';

import { BeamDefinition } from '../../../core/models/beam.model';
import { BeamManager } from './beam.manager';

/** Mock-only surface (not on the real Cesium types tsc checks against). */
interface MockEvent {
  raise(...args: unknown[]): void;
  listenerCount: number;
}

interface MockColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** Live (callback) numeric property — beam footprint semi-axes are sized per-frame. */
interface MockNumberProperty {
  getValue(time: JulianDate | undefined): number;
}

interface MockFootprint {
  id: string;
  position: { getValue(time: JulianDate | undefined): Cartesian3 | undefined };
  ellipse: {
    options: {
      semiMajorAxis: MockNumberProperty;
      semiMinorAxis: MockNumberProperty;
      outlineColor: MockColor;
      fill: boolean;
    };
  };
}

interface MockVolume {
  show: boolean;
  modelMatrix?: { values: number[] };
  options: {
    geometryInstances: { options: { attributes: { color: { color: MockColor } } } };
    appearance: { options: { translucent: boolean; flat: boolean } };
  };
}

const SAT_POS = new Cartesian3(7_000_000, 0, 0);

const circular = (id: string, overrides: Partial<BeamDefinition> = {}): BeamDefinition => ({
  id,
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'circular', halfAngle: 10 },
  ...overrides,
});

const elliptical = (id: string, overrides: Partial<BeamDefinition> = {}): BeamDefinition => ({
  id,
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'elliptical', azimuthHalfAngle: 20, elevationHalfAngle: 5 },
  ...overrides,
});

describe('BeamManager', () => {
  let entities: EntityCollection;
  let scene: Scene;
  let manager: BeamManager;

  const footprint = (satId: string, beamId: string): MockFootprint =>
    entities.getById(`beam:${satId}:${beamId}`) as unknown as MockFootprint;
  const volumes = (): readonly MockVolume[] =>
    (scene.primitives as unknown as { values: readonly MockVolume[] }).values;
  const preRender = (): MockEvent => scene.preRender as unknown as MockEvent;
  // Simulate a render frame so the per-frame volume update (modelMatrix +
  // visibility) runs, mirroring how coverage tests raise clock.onTick.
  const renderFrame = (): void => preRender().raise(scene, undefined);

  beforeEach(() => {
    // A mock CesiumWidget gives correctly-typed entities + scene (the runtime
    // values are the jest mock; see __mocks__/cesium-engine.mock).
    const widget = new CesiumWidget(document.createElement('div'));
    entities = widget.entities;
    scene = widget.scene;
    manager = new BeamManager(entities, scene, 10, () => SAT_POS);
  });

  // Footprint semi-axes are live (callback) properties sized from the satellite's
  // current altitude each frame; read their value at the SAT_POS the manager sees.
  const axes = (satId: string, beamId: string): { major: number; minor: number } => {
    const e = footprint(satId, beamId);
    return {
      major: e.ellipse.options.semiMajorAxis.getValue(undefined),
      minor: e.ellipse.options.semiMinorAxis.getValue(undefined),
    };
  };

  it('renders a circular beam: a namespaced footprint entity + a volume primitive', () => {
    manager.syncBeams('s1', [circular('b1')]);

    const entity = footprint('s1', 'b1');
    expect(entity).toBeDefined();
    expect(entity.ellipse).toBeDefined();
    expect(scene.primitives.length).toBe(1);
    // Circular footprint has equal, positive semi-axes.
    const { major, minor } = axes('s1', 'b1');
    expect(major).toBe(minor);
    expect(major).toBeGreaterThan(0);
  });

  it('renders an elliptical beam with distinct footprint semi-axes (FR-A-01b)', () => {
    manager.syncBeams('s1', [elliptical('b1')]);

    const { major, minor } = axes('s1', 'b1');
    expect(major).not.toBe(minor);
    // The larger half-angle maps to the major axis (Cesium needs major ≥ minor).
    expect(major).toBeGreaterThan(minor);
  });

  it('sizes the footprint from altitude and bounds even a very wide beam to the horizon', () => {
    // Regression guard for the footprint-sizing bug: projecting tan(halfAngle) over
    // the rendered cone length (50,000 km) produced an Earth-sized ellipse Cesium
    // could not triangulate. The radius must be sized from the satellite's altitude
    // and clamped to the visible horizon, so it stays well under a quarter
    // circumference (~10,000 km) for ANY half-angle.
    const altitude = Cartesian3.magnitude(SAT_POS) - 6_371_000; // ~629 km above mean radius
    manager.syncBeams('s1', [
      circular('narrow', { geometry: { kind: 'circular', halfAngle: 5 } }),
      circular('wide', { geometry: { kind: 'circular', halfAngle: 80 } }),
    ]);

    const narrow = axes('s1', 'narrow').major;
    const wide = axes('s1', 'wide').major;
    // Narrow nadir spot ≈ altitude·tan(halfAngle) (first-order); bounded, not 50,000 km·tan.
    expect(narrow).toBeLessThan(altitude); // ~55 km, far below the old tan-over-cone value
    expect(wide).toBeGreaterThan(narrow);
    // The horizon bound keeps even an 80° beam triangulable.
    expect(wide).toBeLessThan(10_000_000);
  });

  it('sizes the footprint to an inert 0 while the satellite has no position', () => {
    let position: Cartesian3 | undefined = SAT_POS;
    manager.destroy();
    manager = new BeamManager(entities, scene, 10, () => position);
    manager.syncBeams('s1', [circular('b1')]);

    // With a position the axis is positive; with none, Cesium skips the entity, so
    // the callback returns a harmless 0 rather than a value that would throw.
    expect(axes('s1', 'b1').major).toBeGreaterThan(0);
    position = undefined;
    expect(axes('s1', 'b1').major).toBe(0);
  });

  it('positions the footprint from the satellite accessor (no re-propagation, FR-A-05)', () => {
    const accessor = jest.fn(() => SAT_POS);
    manager.destroy();
    manager = new BeamManager(entities, scene, 10, accessor);
    manager.syncBeams('s1', [circular('b1')]);

    expect(footprint('s1', 'b1').position.getValue(undefined)).toBe(SAT_POS);
    expect(accessor).toHaveBeenCalledWith('s1', undefined);
  });

  it('points the volume at the satellite each frame, hidden when no position (FR-A-05)', () => {
    let position: Cartesian3 | undefined = SAT_POS;
    manager.destroy();
    manager = new BeamManager(entities, scene, 10, () => position);
    manager.setVolumesVisible(true);
    manager.syncBeams('s1', [circular('b1')]);

    renderFrame();
    const volume = volumes()[0];
    expect(volume.show).toBe(true);
    expect(volume.modelMatrix?.values).toHaveLength(16);

    position = undefined;
    renderFrame();
    expect(volume.show).toBe(false);
  });

  it('points an elliptical beam volume each frame (distinct cone radii, M1)', () => {
    manager.setVolumesVisible(true);
    manager.syncBeams('s1', [elliptical('b1')]);

    renderFrame();
    const volume = volumes()[0];
    expect(volume.show).toBe(true);
    expect(volume.modelMatrix?.values).toHaveLength(16);
  });

  it('applies the default cyan fill and 0.3 opacity when omitted (FR-A-03/04)', () => {
    manager.syncBeams('s1', [circular('b1')]);

    const fill = volumes()[0].options.geometryInstances.options.attributes.color.color;
    expect(fill.red).toBeCloseTo(0, 5);
    expect(fill.green).toBeCloseTo(200 / 255, 5);
    expect(fill.blue).toBeCloseTo(1, 5);
    expect(fill.alpha).toBeCloseTo(0.3, 5);
  });

  it('renders the volume with a translucent appearance', () => {
    manager.syncBeams('s1', [circular('b1')]);
    expect(volumes()[0].options.appearance.options.translucent).toBe(true);
  });

  it('draws the footprint outline at full opacity regardless of fill (FR-A-04)', () => {
    manager.syncBeams('s1', [circular('b1', { opacity: 0.1 })]);

    expect(footprint('s1', 'b1').ellipse.options.outlineColor.alpha).toBe(1);
  });

  it('honours a developer-supplied color and opacity', () => {
    manager.syncBeams('s1', [circular('b1', { color: { r: 255, g: 0, b: 0, a: 1 }, opacity: 0.8 })]);

    const fill = volumes()[0].options.geometryInstances.options.attributes.color.color;
    expect(fill.red).toBeCloseTo(1, 5);
    expect(fill.alpha).toBeCloseTo(0.8, 5);
  });

  it('renders multiple beams independently (FR-A-02)', () => {
    manager.syncBeams('s1', [circular('b1'), elliptical('b2')]);

    expect(footprint('s1', 'b1')).toBeDefined();
    expect(footprint('s1', 'b2')).toBeDefined();
    expect(scene.primitives.length).toBe(2);
    expect(manager.getBeams('s1')).toHaveLength(2);
  });

  describe('diff-not-replace (FR-A-06)', () => {
    it('adds only new beams and leaves unchanged beams untouched', () => {
      const b1 = circular('b1');
      manager.syncBeams('s1', [b1]);
      const entityAdd = jest.spyOn(entities, 'add');
      const entityRemove = jest.spyOn(entities, 'removeById');
      const primitiveAdd = jest.spyOn(scene.primitives, 'add');
      const primitiveRemove = jest.spyOn(scene.primitives, 'remove');

      manager.syncBeams('s1', [b1, circular('b2')]);

      // Only b2 added; b1 not re-added and not removed.
      expect(entityAdd).toHaveBeenCalledTimes(1);
      expect(primitiveAdd).toHaveBeenCalledTimes(1);
      expect(entityRemove).not.toHaveBeenCalled();
      expect(primitiveRemove).not.toHaveBeenCalled();
    });

    it('removes dropped beams (footprint + volume)', () => {
      const b1 = circular('b1');
      manager.syncBeams('s1', [b1, circular('b2')]);
      manager.syncBeams('s1', [b1]);

      expect(footprint('s1', 'b1')).toBeDefined();
      expect(footprint('s1', 'b2')).toBeUndefined();
      expect(scene.primitives.length).toBe(1);
    });

    it('re-renders a beam whose object reference changed', () => {
      manager.syncBeams('s1', [circular('b1', { elevation: 90 })]);
      manager.syncBeams('s1', [circular('b1', { elevation: 45 })]);

      expect(manager.getBeams('s1')[0].elevation).toBe(45);
      expect(scene.primitives.length).toBe(1);
    });
  });

  describe('limits and validation', () => {
    it('throws on over-limit and renders none of the satellite (FR-A-07)', () => {
      const small = new BeamManager(entities, scene, 1, () => SAT_POS);
      expect(() => small.syncBeams('s1', [circular('b1'), circular('b2')])).toThrow(
        /maxBeamsPerSatellite=1/
      );
      expect(footprint('s1', 'b1')).toBeUndefined();
      expect(scene.primitives.length).toBe(0);
      small.destroy();
    });

    it.each([
      ['circular halfAngle 0', circular('b', { geometry: { kind: 'circular', halfAngle: 0 } }), /halfAngle/],
      ['circular halfAngle 90', circular('b', { geometry: { kind: 'circular', halfAngle: 90 } }), /halfAngle/],
      [
        'elliptical azimuth 0',
        elliptical('b', { geometry: { kind: 'elliptical', azimuthHalfAngle: 0, elevationHalfAngle: 5 } }),
        /azimuthHalfAngle/,
      ],
      [
        'elliptical elevation 95',
        elliptical('b', { geometry: { kind: 'elliptical', azimuthHalfAngle: 5, elevationHalfAngle: 95 } }),
        /elevationHalfAngle/,
      ],
      ['opacity > 1', circular('b', { opacity: 1.5 }), /opacity/],
      ['non-finite azimuth', circular('b', { azimuth: NaN }), /azimuth/],
      ['non-finite elevation', circular('b', { elevation: Infinity }), /elevation/],
    ])('rejects %s (FR-A-08)', (_name, beam, message) => {
      expect(() => manager.syncBeams('s1', [beam])).toThrow(message);
      expect(footprint('s1', 'b')).toBeUndefined();
      expect(scene.primitives.length).toBe(0);
    });

    it('rejects duplicate beam ids', () => {
      expect(() => manager.syncBeams('s1', [circular('b1'), circular('b1')])).toThrow(
        /duplicate beam id/
      );
    });

    it('validates the whole set atomically — a bad beam blocks the good one', () => {
      expect(() =>
        manager.syncBeams('s1', [circular('good'), circular('bad', { opacity: 2 })])
      ).toThrow(/opacity/);
      expect(footprint('s1', 'good')).toBeUndefined();
      expect(scene.primitives.length).toBe(0);
    });
  });

  describe('no-ops and removal', () => {
    it('treats zero/absent beams as a no-op, not an error (FR-A-20)', () => {
      expect(() => manager.syncBeams('s1', [])).not.toThrow();
      expect(() => manager.syncBeams('s1', undefined)).not.toThrow();
      expect(manager.getBeams('s1')).toHaveLength(0);
      expect(manager.satelliteIds).toHaveLength(0);
    });

    it('clears beams when synced to an empty set', () => {
      manager.syncBeams('s1', [circular('b1')]);
      manager.syncBeams('s1', []);

      expect(footprint('s1', 'b1')).toBeUndefined();
      expect(scene.primitives.length).toBe(0);
      expect(manager.satelliteIds).toHaveLength(0);
    });

    it('removes all beams (footprints + volumes) for a satellite', () => {
      manager.syncBeams('s1', [circular('b1'), circular('b2')]);
      manager.removeSatellite('s1');

      expect(footprint('s1', 'b1')).toBeUndefined();
      expect(footprint('s1', 'b2')).toBeUndefined();
      expect(scene.primitives.length).toBe(0);
      expect(manager.getBeams('s1')).toHaveLength(0);
    });

    it('removeSatellite on an unknown satellite is a no-op', () => {
      expect(() => manager.removeSatellite('nope')).not.toThrow();
    });
  });

  describe('volume visibility (FR-A-01d)', () => {
    const showOf = (index = 0): boolean => volumes()[index].show;

    it('hides the volume by default while still rendering the footprint', () => {
      manager.syncBeams('s1', [circular('b1')]);
      renderFrame();
      expect(showOf()).toBe(false);
      // The footprint outline is NOT gated by the volume toggle — always present.
      expect(footprint('s1', 'b1').ellipse).toBeDefined();
    });

    it('shows every beam volume when the global toggle is enabled', () => {
      manager.syncBeams('s1', [circular('b1'), circular('b2')]);
      manager.setVolumesVisible(true);
      renderFrame();
      expect(showOf(0)).toBe(true);
      expect(showOf(1)).toBe(true);
    });

    it('reflects the global toggle live, with no entity/primitive rebuild', () => {
      manager.syncBeams('s1', [circular('b1')]);
      const entityAdd = jest.spyOn(entities, 'add');
      const primitiveAdd = jest.spyOn(scene.primitives, 'add');
      const primitiveRemove = jest.spyOn(scene.primitives, 'remove');

      manager.setVolumesVisible(true);
      renderFrame();
      expect(showOf()).toBe(true);
      manager.setVolumesVisible(false);
      renderFrame();
      expect(showOf()).toBe(false);

      // Toggling is a live per-frame read — no add/remove churn.
      expect(entityAdd).not.toHaveBeenCalled();
      expect(primitiveAdd).not.toHaveBeenCalled();
      expect(primitiveRemove).not.toHaveBeenCalled();
    });

    it('lets a per-beam showVolume:true override a global OFF (explicit wins)', () => {
      manager.syncBeams('s1', [circular('b1', { showVolume: true })]);
      renderFrame();
      expect(showOf()).toBe(true); // global default is OFF
    });

    it('lets a per-beam showVolume:false override a global ON', () => {
      manager.syncBeams('s1', [circular('b1', { showVolume: false }), circular('b2')]);
      manager.setVolumesVisible(true);
      renderFrame();
      expect(showOf(0)).toBe(false); // per-beam false wins
      expect(showOf(1)).toBe(true); // inherits global ON
    });

    it('inherits the global setting when showVolume is undefined', () => {
      manager.syncBeams('s1', [circular('b1')]);
      manager.setVolumesVisible(true);
      renderFrame();
      expect(showOf()).toBe(true);
      manager.setVolumesVisible(false);
      renderFrame();
      expect(showOf()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('removes the per-frame render hook and all volume primitives', () => {
      manager.syncBeams('s1', [circular('b1')]);
      expect(preRender().listenerCount).toBe(1);
      expect(scene.primitives.length).toBe(1);

      manager.destroy();

      expect(preRender().listenerCount).toBe(0);
      expect(scene.primitives.length).toBe(0);
    });
  });
});
