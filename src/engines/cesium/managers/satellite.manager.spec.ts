import { EntityCollection, JulianDate } from '@cesium/engine';
import * as satelliteJs from 'satellite.js';

import { SatelliteConfig } from '../../../core/models/satellite.model';
import { ModelLoader } from '../services/model-loader.service';
import { SatelliteManager } from './satellite.manager';

// A historic ISS TLE — real orbital data keeps the propagation test honest.
const ISS_TLE = {
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
  line2: '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    15',
};

/**
 * Structural view of what the manager hands to entities.add(). Specs type
 * against this rather than Cesium's Entity because the runtime collection
 * is the jsdom-safe mock (see jest.config.mjs moduleNameMapper).
 */
interface MockEntity {
  id: string;
  position: {
    callback: (time: JulianDate) => { x: number; y: number; z: number } | undefined;
    isConstant: boolean;
  };
  model: { uri: string; minimumPixelSize: number };
  label?: { text: string };
}

describe('SatelliteManager', () => {
  let entities: EntityCollection;
  let manager: SatelliteManager;

  const config = (overrides: Partial<SatelliteConfig> = {}): SatelliteConfig => ({
    id: 'iss',
    tle: ISS_TLE,
    ...overrides,
  });

  beforeEach(() => {
    entities = new EntityCollection();
    manager = new SatelliteManager(entities, new ModelLoader('assets/cesium-wrapper'), 100);
  });

  it('adds a satellite entity with a namespaced id and the default model', () => {
    manager.add(config());

    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    expect(entity).toBeDefined();
    expect(entity.model.uri).toBe('assets/cesium-wrapper/default-satellite.glb');
    expect(manager.count).toBe(1);
  });

  it('uses a developer-supplied model when given', () => {
    manager.add(config({ model: { url: 'models/custom.glb', format: 'glb' } }));

    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    expect(entity.model.uri).toBe('models/custom.glb');
  });

  it('renders a label only when configured', () => {
    manager.add(config({ id: 'a', label: 'ISS' }));
    manager.add(config({ id: 'b' }));

    expect((entities.getById('satellite:a') as unknown as MockEntity).label).toEqual({ text: 'ISS' });
    expect((entities.getById('satellite:b') as unknown as MockEntity).label).toBeUndefined();
  });

  it('propagates the TLE to an earth-fixed position in meters', () => {
    manager.add(config());
    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    const date = new Date('2024-01-01T12:00:00Z');

    const position = entity.position.callback(JulianDate.fromDate(date));

    // Independently computed expectation via satellite.js.
    const satrec = satelliteJs.twoline2satrec(ISS_TLE.line1, ISS_TLE.line2);
    const pv = satelliteJs.propagate(satrec, date);
    const ecf = satelliteJs.eciToEcf(
      pv!.position as satelliteJs.EciVec3<number>,
      satelliteJs.gstime(date)
    );
    expect(position).toBeDefined();
    expect(position!.x).toBeCloseTo(ecf.x * 1000, 3);
    expect(position!.y).toBeCloseTo(ecf.y * 1000, 3);
    expect(position!.z).toBeCloseTo(ecf.z * 1000, 3);
    // Sanity: ISS orbits at ~6800 km geocentric radius.
    const radius = Math.hypot(position!.x, position!.y, position!.z);
    expect(radius).toBeGreaterThan(6.5e6);
    expect(radius).toBeLessThan(7.1e6);
  });

  it('marks the position property as non-constant so it re-evaluates each tick', () => {
    manager.add(config());
    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    expect(entity.position.isConstant).toBe(false);
  });

  it('returns undefined from the position callback when propagation fails', () => {
    manager.add(config());
    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    const spy = jest
      .spyOn(satelliteJs, 'propagate')
      .mockReturnValue(null as unknown as ReturnType<typeof satelliteJs.propagate>);

    expect(entity.position.callback(JulianDate.fromDate(new Date()))).toBeUndefined();
    spy.mockRestore();
  });

  it('returns undefined instead of crashing the render loop when propagation throws (M4)', () => {
    manager.add(config());
    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    const spy = jest.spyOn(satelliteJs, 'propagate').mockImplementation(() => {
      throw new Error('SatRecError');
    });

    expect(entity.position.callback(JulianDate.fromDate(new Date()))).toBeUndefined();
    spy.mockRestore();
  });

  it('rejects an unparseable TLE at add time', () => {
    expect(() =>
      manager.add(config({ tle: { line1: 'garbage', line2: 'garbage' } }))
    ).toThrow(/TLE could not be parsed/);
    expect(manager.count).toBe(0);
  });

  it('rejects duplicate ids', () => {
    manager.add(config());
    expect(() => manager.add(config())).toThrow(/already exists/);
  });

  it('enforces the configured satellite limit', () => {
    const small = new SatelliteManager(entities, new ModelLoader('assets'), 1);
    small.add(config({ id: 'one' }));
    expect(() => small.add(config({ id: 'two' }))).toThrow(/maxSatellites=1/);
  });

  it('updates a satellite by merging the patch', () => {
    manager.add(config());

    manager.update('iss', { label: 'Station' });

    const entity = entities.getById('satellite:iss') as unknown as MockEntity;
    expect(entity.label).toEqual({ text: 'Station' });
    expect(entity.model.uri).toBe('assets/cesium-wrapper/default-satellite.glb');
    expect(manager.count).toBe(1);
  });

  it('rejects updates to unknown satellites', () => {
    expect(() => manager.update('nope', {})).toThrow(/unknown satellite 'nope'/);
  });

  it('removes a satellite and ignores unknown ids', () => {
    manager.add(config());

    manager.remove('iss');
    manager.remove('iss'); // Second call must be a no-op.

    expect(entities.getById('satellite:iss')).toBeUndefined();
    expect(manager.count).toBe(0);
  });

  it('removes all satellites', () => {
    manager.add(config({ id: 'a' }));
    manager.add(config({ id: 'b' }));

    manager.removeAll();

    expect(manager.count).toBe(0);
    expect(entities.values).toHaveLength(0);
  });
});
