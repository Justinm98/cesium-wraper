import { Cartesian3, EntityCollection } from '@cesium/engine';

import { TerminalConfig } from '../../../core/models/terminal.model';
import { ModelLoader } from '../services/model-loader.service';
import { TerminalManager } from './terminal.manager';

interface MockEntity {
  id: string;
  position: Cartesian3;
  model: { uri: string; minimumPixelSize: number; maximumScale: number };
  label?: { text: string };
}

describe('TerminalManager', () => {
  let entities: EntityCollection;
  let manager: TerminalManager;

  const config = (overrides: Partial<TerminalConfig> = {}): TerminalConfig => ({
    id: 't1',
    position: { latitude: 38.9, longitude: -77.0, altitude: 120 },
    ...overrides,
  });

  beforeEach(() => {
    entities = new EntityCollection();
    manager = new TerminalManager(entities, new ModelLoader('assets/cesium-wrapper'), 5000);
  });

  it('adds a terminal entity with a namespaced id and the default model', () => {
    manager.add(config());

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    expect(entity).toBeDefined();
    expect(entity.model.uri).toBe('assets/cesium-wrapper/default-terminal.glb');
    expect(manager.count).toBe(1);
  });

  it('applies default scale limits so models respond to zoom', () => {
    manager.add(config());

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    expect(entity.model.minimumPixelSize).toBe(1_000);
    expect(entity.model.maximumScale).toBe(20_000);
  });

  it('honours a developer-supplied scale config', () => {
    manager.add(config({ scale: { minimumPixelSize: 12, maximumScale: 500 } }));

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    expect(entity.model.minimumPixelSize).toBe(12);
    expect(entity.model.maximumScale).toBe(500);
  });

  it('allows partial scale config — unset fields fall back to defaults', () => {
    manager.add(config({ scale: { maximumScale: 4_000 } }));

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    expect(entity.model.minimumPixelSize).toBe(1_000); // falls back to DEFAULT_MIN_PIXEL_SIZE
    expect(entity.model.maximumScale).toBe(4_000);
  });

  it('positions the terminal from lat/lon/alt with Cesium argument order (lon, lat, alt)', () => {
    manager.add(config());

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    // The mock's fromDegrees stores its inputs as (x, y, z) = (lon, lat, alt).
    expect(entity.position.x).toBe(-77.0);
    expect(entity.position.y).toBe(38.9);
    expect(entity.position.z).toBe(120);
  });

  it('uses a developer-supplied model when given', () => {
    manager.add(config({ model: { url: 'models/dish.glb', format: 'glb' } }));

    expect((entities.getById('terminal:t1') as unknown as MockEntity).model.uri).toBe('models/dish.glb');
  });

  it('renders a label only when configured', () => {
    manager.add(config({ id: 'a', label: 'DC Gateway' }));
    manager.add(config({ id: 'b' }));

    expect((entities.getById('terminal:a') as unknown as MockEntity).label).toEqual({ text: 'DC Gateway' });
    expect((entities.getById('terminal:b') as unknown as MockEntity).label).toBeUndefined();
  });

  it.each([
    ['latitude above 90', { latitude: 90.1, longitude: 0, altitude: 0 }, /latitude 90.1/],
    ['latitude below -90', { latitude: -95, longitude: 0, altitude: 0 }, /latitude -95/],
    ['longitude above 180', { latitude: 0, longitude: 500, altitude: 0 }, /longitude 500/],
    ['longitude below -180', { latitude: 0, longitude: -181, altitude: 0 }, /longitude -181/],
    ['NaN latitude', { latitude: NaN, longitude: 0, altitude: 0 }, /latitude NaN/],
    ['infinite altitude', { latitude: 0, longitude: 0, altitude: Infinity }, /altitude/],
  ])('rejects %s at add time (M3)', (_name, position, message) => {
    expect(() => manager.add(config({ position }))).toThrow(message);
    expect(manager.count).toBe(0);
  });

  it('rejects invalid positions at update time (M3)', () => {
    manager.add(config());
    expect(() =>
      manager.update('t1', { position: { latitude: 91, longitude: 0, altitude: 0 } })
    ).toThrow(/latitude 91/);
  });

  it('rejects duplicate ids', () => {
    manager.add(config());
    expect(() => manager.add(config())).toThrow(/already exists/);
  });

  it('enforces the configured terminal limit', () => {
    const small = new TerminalManager(entities, new ModelLoader('assets'), 2);
    small.add(config({ id: 'one' }));
    small.add(config({ id: 'two' }));
    expect(() => small.add(config({ id: 'three' }))).toThrow(/maxTerminals=2/);
  });

  it('updates a terminal by merging the patch', () => {
    manager.add(config());

    manager.update('t1', { position: { latitude: 0, longitude: 10, altitude: 5 } });

    const entity = entities.getById('terminal:t1') as unknown as MockEntity;
    expect(entity.position.x).toBe(10);
    expect(entity.position.y).toBe(0);
    expect(entity.position.z).toBe(5);
    expect(manager.count).toBe(1);
  });

  it('rejects updates to unknown terminals', () => {
    expect(() => manager.update('nope', {})).toThrow(/unknown terminal 'nope'/);
  });

  it('removes a terminal and ignores unknown ids', () => {
    manager.add(config());

    manager.remove('t1');
    manager.remove('t1'); // Second call must be a no-op.

    expect(entities.getById('terminal:t1')).toBeUndefined();
    expect(manager.count).toBe(0);
  });

  it('removes all terminals', () => {
    manager.add(config({ id: 'a' }));
    manager.add(config({ id: 'b' }));

    manager.removeAll();

    expect(manager.count).toBe(0);
    expect(entities.values).toHaveLength(0);
  });
});
