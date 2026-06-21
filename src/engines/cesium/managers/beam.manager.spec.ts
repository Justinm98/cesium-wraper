import { Cartesian3, EntityCollection, JulianDate } from '@cesium/engine';

import { BeamDefinition } from '../../../core/models/beam.model';
import { BeamManager } from './beam.manager';

interface MockColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface MockBeamEntity {
  id: string;
  position: { getValue(time: JulianDate | undefined): Cartesian3 | undefined };
  orientation: { getValue(time: JulianDate | undefined): unknown };
  cylinder: { options: { material: MockColor; outlineColor: MockColor } };
  ellipse: {
    options: { semiMajorAxis: number; semiMinorAxis: number; outlineColor: MockColor };
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
  let manager: BeamManager;

  const get = (satId: string, beamId: string): MockBeamEntity =>
    entities.getById(`beam:${satId}:${beamId}`) as unknown as MockBeamEntity;

  beforeEach(() => {
    entities = new EntityCollection();
    manager = new BeamManager(entities, 10, () => SAT_POS);
  });

  it('renders a circular beam with a namespaced id, volume, and footprint', () => {
    manager.syncBeams('s1', [circular('b1')]);

    const entity = get('s1', 'b1');
    expect(entity).toBeDefined();
    expect(entity.cylinder).toBeDefined();
    expect(entity.ellipse).toBeDefined();
    // Circular footprint has equal semi-axes.
    expect(entity.ellipse.options.semiMajorAxis).toBe(entity.ellipse.options.semiMinorAxis);
  });

  it('renders an elliptical beam with distinct footprint semi-axes (FR-A-01b)', () => {
    manager.syncBeams('s1', [elliptical('b1')]);

    const entity = get('s1', 'b1');
    expect(entity.ellipse.options.semiMajorAxis).not.toBe(entity.ellipse.options.semiMinorAxis);
  });

  it('reuses the satellite position via the accessor (no re-propagation, FR-A-05)', () => {
    const accessor = jest.fn(() => SAT_POS);
    manager = new BeamManager(entities, 10, accessor);
    manager.syncBeams('s1', [circular('b1')]);

    const entity = get('s1', 'b1');
    expect(entity.position.getValue(undefined)).toBe(SAT_POS);
    expect(accessor).toHaveBeenCalledWith('s1', undefined);
  });

  it('orients the beam from the satellite position, undefined when no position', () => {
    let position: Cartesian3 | undefined = SAT_POS;
    manager = new BeamManager(entities, 10, () => position);
    manager.syncBeams('s1', [circular('b1')]);

    const entity = get('s1', 'b1');
    expect(entity.orientation.getValue(undefined)).toBeDefined();

    position = undefined;
    expect(entity.orientation.getValue(undefined)).toBeUndefined();
  });

  it('applies the default cyan fill and 0.3 opacity when omitted (FR-A-03/04)', () => {
    manager.syncBeams('s1', [circular('b1')]);

    const material = get('s1', 'b1').cylinder.options.material;
    expect(material.red).toBeCloseTo(0, 5);
    expect(material.green).toBeCloseTo(200 / 255, 5);
    expect(material.blue).toBeCloseTo(1, 5);
    expect(material.alpha).toBeCloseTo(0.3, 5);
  });

  it('draws the footprint outline at full opacity regardless of fill (FR-A-04)', () => {
    manager.syncBeams('s1', [circular('b1', { opacity: 0.1 })]);

    const outline = get('s1', 'b1').ellipse.options.outlineColor;
    expect(outline.alpha).toBe(1);
  });

  it('honours a developer-supplied color and opacity', () => {
    manager.syncBeams('s1', [
      circular('b1', { color: { r: 255, g: 0, b: 0, a: 1 }, opacity: 0.8 }),
    ]);

    const material = get('s1', 'b1').cylinder.options.material;
    expect(material.red).toBeCloseTo(1, 5);
    expect(material.alpha).toBeCloseTo(0.8, 5);
  });

  it('renders multiple beams independently (FR-A-02)', () => {
    manager.syncBeams('s1', [circular('b1'), elliptical('b2')]);

    expect(get('s1', 'b1')).toBeDefined();
    expect(get('s1', 'b2')).toBeDefined();
    expect(manager.getBeams('s1')).toHaveLength(2);
  });

  describe('diff-not-replace (FR-A-06)', () => {
    it('adds only new beams and leaves unchanged beams untouched', () => {
      const b1 = circular('b1');
      manager.syncBeams('s1', [b1]);
      const addSpy = jest.spyOn(entities, 'add');
      const removeSpy = jest.spyOn(entities, 'removeById');

      manager.syncBeams('s1', [b1, circular('b2')]);

      // Only b2 added; b1 not re-added and not removed.
      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('removes dropped beams', () => {
      const b1 = circular('b1');
      manager.syncBeams('s1', [b1, circular('b2')]);
      manager.syncBeams('s1', [b1]);

      expect(get('s1', 'b1')).toBeDefined();
      expect(get('s1', 'b2')).toBeUndefined();
    });

    it('re-renders a beam whose object reference changed', () => {
      manager.syncBeams('s1', [circular('b1', { elevation: 90 })]);
      manager.syncBeams('s1', [circular('b1', { elevation: 45 })]);

      expect(manager.getBeams('s1')[0].elevation).toBe(45);
    });
  });

  describe('limits and validation', () => {
    it('throws on over-limit and renders none of the satellite (FR-A-07)', () => {
      const small = new BeamManager(entities, 1, () => SAT_POS);
      expect(() => small.syncBeams('s1', [circular('b1'), circular('b2')])).toThrow(
        /maxBeamsPerSatellite=1/
      );
      expect(get('s1', 'b1')).toBeUndefined();
      expect(get('s1', 'b2')).toBeUndefined();
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
      expect(get('s1', 'b')).toBeUndefined();
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
      expect(get('s1', 'good')).toBeUndefined();
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

      expect(get('s1', 'b1')).toBeUndefined();
      expect(manager.satelliteIds).toHaveLength(0);
    });

    it('removes all beams for a satellite', () => {
      manager.syncBeams('s1', [circular('b1'), circular('b2')]);
      manager.removeSatellite('s1');

      expect(get('s1', 'b1')).toBeUndefined();
      expect(get('s1', 'b2')).toBeUndefined();
      expect(manager.getBeams('s1')).toHaveLength(0);
    });

    it('removeSatellite on an unknown satellite is a no-op', () => {
      expect(() => manager.removeSatellite('nope')).not.toThrow();
    });
  });
});
