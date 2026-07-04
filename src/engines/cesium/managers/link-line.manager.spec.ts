import { Cartesian3, EntityCollection, JulianDate } from '@cesium/engine';

import { LinkLineManager, LinkPair } from './link-line.manager';

interface MockLinkEntity {
  id: string;
  polyline: {
    options: {
      positions: { getValue(time: JulianDate | undefined): unknown };
      material: { red: number; green: number; blue: number; alpha: number };
    };
  };
}

const SAT_POS = new Cartesian3(7_000_000, 0, 0);
const TERMINAL_POS = { x: 6_378_137, y: 0, z: 0 };

describe('LinkLineManager', () => {
  let entities: EntityCollection;
  let manager: LinkLineManager;

  const get = (satId: string, termId: string): MockLinkEntity =>
    entities.getById(`link:${satId}:${termId}`) as unknown as MockLinkEntity;

  const pair = (satelliteId: string, terminalId: string): LinkPair => ({ satelliteId, terminalId });

  beforeEach(() => {
    entities = new EntityCollection();
    manager = new LinkLineManager(
      entities,
      () => SAT_POS,
      () => TERMINAL_POS
    );
  });

  it('draws exactly one line per covered pair with namespaced ids (FR-A-13)', () => {
    manager.sync([pair('s1', 't1'), pair('s2', 't1')]);

    // A terminal covered by two satellites shows two lines.
    expect(get('s1', 't1')).toBeDefined();
    expect(get('s2', 't1')).toBeDefined();
    expect(manager.count).toBe(2);
  });

  it('tracks the live satellite endpoint via a callback (FR-A-15)', () => {
    manager.sync([pair('s1', 't1')]);

    const positions = get('s1', 't1').polyline.options.positions.getValue(undefined) as Cartesian3[];
    expect(positions[0]).toBe(SAT_POS);
    expect(positions[1].x).toBe(TERMINAL_POS.x);
  });

  it('diffs add/remove instead of rebuilding (FR-A-15)', () => {
    manager.sync([pair('s1', 't1')]);
    const addSpy = jest.spyOn(entities, 'add');

    manager.sync([pair('s1', 't1'), pair('s1', 't2')]);

    expect(addSpy).toHaveBeenCalledTimes(1); // only the new pair
    expect(manager.count).toBe(2);
  });

  it('removes a line within the tick once a pair leaves coverage', () => {
    manager.sync([pair('s1', 't1'), pair('s1', 't2')]);
    manager.sync([pair('s1', 't1')]);

    expect(get('s1', 't1')).toBeDefined();
    expect(get('s1', 't2')).toBeUndefined();
  });

  it('uses the default yellow color when none is set (FR-A-14)', () => {
    manager.sync([pair('s1', 't1')]);
    const def = get('s1', 't1').polyline.options.material;
    expect(def.red).toBeCloseTo(1, 5);
    expect(def.green).toBeCloseTo(1, 5);
    expect(def.blue).toBeCloseTo(0, 5);
  });

  it('recolors by clearing and recreating lines on the next sync (FR-A-14)', () => {
    manager.sync([pair('s1', 't1')]);

    // setColor removes existing lines so the new color applies on re-sync.
    manager.setColor({ r: 0, g: 0, b: 255, a: 1 });
    expect(manager.count).toBe(0);

    manager.sync([pair('s1', 't1')]);
    expect(get('s1', 't1').polyline.options.material.blue).toBeCloseTo(1, 5);
  });

  it('does not clear drawn lines when the color is unchanged (L3)', () => {
    // The engine calls setColor on every setCoverageConfig; a config change that
    // does not alter the link color must not tear down and rebuild every line.
    manager.setColor({ r: 0, g: 0, b: 255, a: 1 });
    manager.sync([pair('s1', 't1')]);
    const addSpy = jest.spyOn(entities, 'add');

    // Re-setting the SAME color is a no-op: no clear, no rebuild.
    manager.setColor({ r: 0, g: 0, b: 255, a: 1 });
    expect(manager.count).toBe(1);

    manager.sync([pair('s1', 't1')]);
    expect(addSpy).not.toHaveBeenCalled(); // line survived, nothing recreated
  });

  it('applies a color set before any lines exist', () => {
    manager.setColor({ r: 255, g: 0, b: 0, a: 1 });
    manager.sync([pair('s1', 't1')]);

    expect(get('s1', 't1').polyline.options.material.red).toBeCloseTo(1, 5);
  });

  it('falls back to the origin endpoint when the terminal position is unknown', () => {
    manager = new LinkLineManager(
      entities,
      () => SAT_POS,
      () => undefined
    );
    manager.sync([pair('s1', 'ghost')]);

    const positions = get('s1', 'ghost').polyline.options.positions.getValue(undefined) as
      | Cartesian3[];
    // Satellite endpoint present; terminal endpoint is the (0,0,0) fallback.
    expect(positions[1].x).toBe(0);
  });

  it('yields an empty position list while the satellite has no position', () => {
    manager = new LinkLineManager(
      entities,
      () => undefined,
      () => TERMINAL_POS
    );
    manager.sync([pair('s1', 't1')]);

    const positions = get('s1', 't1').polyline.options.positions.getValue(undefined) as unknown[];
    expect(positions).toHaveLength(0);
  });

  it('clears all lines', () => {
    manager.sync([pair('s1', 't1'), pair('s2', 't2')]);
    manager.clear();

    expect(manager.count).toBe(0);
    expect(entities.values).toHaveLength(0);
  });
});
