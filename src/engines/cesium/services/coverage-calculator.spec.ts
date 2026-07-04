import { Clock } from '@cesium/engine';

import { BeamDefinition } from '../../../core/models/beam.model';
import { CoverageConfig } from '../../../core/models/coverage.model';
import { LinkPair } from '../managers/link-line.manager';
import { CoverageCalculator, CoverageDeps } from './coverage-calculator';
import { Vec3 } from './coverage-geometry';

// Satellite over the prime meridian at ~7000 km; a nadir beam looks straight
// down at the surface point (6.378e6, 0, 0).
const SAT: Vec3 = { x: 7_000_000, y: 0, z: 0 };
const SURFACE_BELOW: Vec3 = { x: 6_378_137, y: 0, z: 0 };
const FAR_SIDE: Vec3 = { x: -6_378_137, y: 0, z: 0 };

const nadirBeam: BeamDefinition = {
  id: 'b1',
  azimuth: 0,
  elevation: 90,
  geometry: { kind: 'circular', halfAngle: 10 },
};

const config = (overrides: Partial<CoverageConfig> = {}): CoverageConfig => ({
  coveredColor: { r: 0, g: 255, b: 0, a: 1 },
  showLinkLines: false,
  ...overrides,
});

/** A controllable fake of the calculator's collaborators. */
class FakeDeps implements CoverageDeps {
  satellites = new Map<string, { position: Vec3 | undefined; beams: BeamDefinition[] }>();
  terminals = new Map<string, Vec3>();

  colors = new Map<string, CoverageConfig['coveredColor'] | undefined>();
  linkPairs: readonly LinkPair[] = [];
  linkColor: CoverageConfig['linkLineColor'];
  cleared = false;

  satelliteIds(): readonly string[] {
    return [...this.satellites.keys()];
  }
  beamsFor(id: string): readonly BeamDefinition[] {
    return this.satellites.get(id)?.beams ?? [];
  }
  satellitePosition(id: string): Vec3 | undefined {
    return this.satellites.get(id)?.position;
  }
  terminalIds(): readonly string[] {
    return [...this.terminals.keys()];
  }
  terminalPosition(id: string): Vec3 | undefined {
    return this.terminals.get(id);
  }
  setTerminalColor(id: string, color: CoverageConfig['coveredColor'] | undefined): void {
    this.colors.set(id, color);
  }
  syncLinkLines(pairs: readonly LinkPair[]): void {
    this.linkPairs = pairs;
  }
  clearLinkLines(): void {
    this.cleared = true;
    this.linkPairs = [];
  }
  setLinkLineColor(color: CoverageConfig['linkLineColor']): void {
    this.linkColor = color;
  }
}

describe('CoverageCalculator', () => {
  let clock: Clock;
  let deps: FakeDeps;
  let calc: CoverageCalculator;

  const tick = (): void => {
    (clock.onTick as unknown as { raise(c: Clock): void }).raise(clock);
  };

  const listenerCount = (): number =>
    (clock.onTick as unknown as { listenerCount: number }).listenerCount;

  beforeEach(() => {
    clock = new Clock();
    deps = new FakeDeps();
    deps.satellites.set('s1', { position: SAT, beams: [nadirBeam] });
    deps.terminals.set('t1', SURFACE_BELOW);
    calc = new CoverageCalculator(clock, deps);
  });

  describe('enable / disable (FR-A-09a/09b)', () => {
    it('does nothing while disabled — no recolor, no link subscription', () => {
      calc.setConfig(config());
      expect(deps.colors.size).toBe(0);
      expect(listenerCount()).toBe(0);
      expect(calc.isEnabled).toBe(false);
    });

    it('subscribes to the clock tick and colors a covered terminal on enable', () => {
      calc.setConfig(config());
      calc.setEnabled(true);

      expect(listenerCount()).toBe(1);
      expect(deps.colors.get('t1')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    });

    it('reverts recolor, removes link lines, and unsubscribes on disable (FR-A-09b)', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      expect(deps.linkPairs).toHaveLength(1);

      calc.setEnabled(false);

      expect(listenerCount()).toBe(0);
      expect(deps.colors.get('t1')).toBeUndefined();
      expect(deps.linkPairs).toHaveLength(0);
    });

    it('is idempotent on repeated enable/disable', () => {
      calc.setConfig(config());
      calc.setEnabled(true);
      calc.setEnabled(true);
      expect(listenerCount()).toBe(1);
    });

    it('destroy() unsubscribes and reverts even with a live external assignment (M3)', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });
      expect(listenerCount()).toBe(1);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);

      calc.destroy();

      // Unlike setEnabled(false), destroy drops the assignment too — nothing
      // survives teardown (review-v2 M5).
      expect(listenerCount()).toBe(0);
      expect(deps.colors.get('t1')).toBeUndefined();
      expect(deps.cleared).toBe(true);
    });
  });

  describe('the covered test (FR-A-09c/09d)', () => {
    it('colors a terminal inside the cone with line-of-sight', () => {
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
    });

    it('does not color a terminal outside the cone', () => {
      // Move the terminal far off-nadir (different longitude) — outside 10 deg.
      const lon = 5 * (Math.PI / 180);
      deps.terminals.set('t1', {
        x: 6_378_137 * Math.cos(lon),
        y: 6_378_137 * Math.sin(lon),
        z: 0,
      });
      // Widen nothing; 5 deg of longitude is ~ tens of degrees off this nadir
      // boresight as seen from orbit, well outside the 10 deg cone.
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toBeUndefined();
    });

    it('excludes an over-the-horizon (occluded) terminal even if geometrically aligned', () => {
      deps.terminals.set('t1', FAR_SIDE);
      // A very wide beam would geometrically include the far side, but occlusion
      // must still exclude it (FR-A-09d).
      deps.satellites.set('s1', {
        position: SAT,
        beams: [{ ...nadirBeam, geometry: { kind: 'circular', halfAngle: 89 } }],
      });
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toBeUndefined();
    });

    it('covers via an elliptical beam', () => {
      deps.satellites.set('s1', {
        position: SAT,
        beams: [{ ...nadirBeam, geometry: { kind: 'elliptical', azimuthHalfAngle: 8, elevationHalfAngle: 8 } }],
      });
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
    });
  });

  describe('transitions both ways (FR-A-11)', () => {
    it('reverts a previously-covered terminal when it leaves the beam', () => {
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);

      // Satellite drifts so the terminal is no longer below it (far side).
      deps.satellites.set('s1', { position: FAR_SIDE, beams: [nadirBeam] });
      tick();
      expect(deps.colors.get('t1')).toBeUndefined();
    });

    it('re-covers a terminal when it re-enters the beam', () => {
      deps.satellites.set('s1', { position: FAR_SIDE, beams: [nadirBeam] });
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toBeUndefined();

      deps.satellites.set('s1', { position: SAT, beams: [nadirBeam] });
      tick();
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
    });
  });

  describe('uncovered color (FR-A-10)', () => {
    it('applies uncoveredColor to an uncovered terminal when provided', () => {
      deps.terminals.set('t1', FAR_SIDE);
      const cfg = config({ uncoveredColor: { r: 100, g: 100, b: 100, a: 1 } });
      calc.setConfig(cfg);
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toEqual(cfg.uncoveredColor);
    });
  });

  describe('global covered color under multiple beams (FR-A-17)', () => {
    it('uses the single global coveredColor even when covered by two satellites', () => {
      deps.satellites.set('s2', { position: SAT, beams: [nadirBeam] });
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);

      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
      // Multiplicity shows in the lines, not the color: two covered pairs.
      expect(deps.linkPairs).toHaveLength(2);
    });
  });

  describe('external assignment override (FR-A-12)', () => {
    it('colors a terminal from the assignment, suppressing computation (FR-A-12c)', () => {
      // Terminal is geometrically uncovered (far side) but externally declared.
      deps.terminals.set('t1', FAR_SIDE);
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toBeUndefined();

      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
      expect(deps.linkPairs).toEqual([{ satelliteId: 'ext-sat', terminalId: 't1' }]);
    });

    it('force-uncovers a terminal with an empty links array (FR-A-12c)', () => {
      // Geometrically covered, but externally forced uncovered.
      calc.setConfig(config());
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);

      calc.setAssignment({ assignments: [{ terminalId: 't1', links: [] }] });
      expect(deps.colors.get('t1')).toBeUndefined();
    });

    it('reverts to engine computation when the assignment is cleared (FR-A-12d)', () => {
      calc.setConfig(config());
      calc.setEnabled(true);
      calc.setAssignment({ assignments: [{ terminalId: 't1', links: [] }] });
      expect(deps.colors.get('t1')).toBeUndefined();

      calc.clearAssignment();
      // t1 is geometrically covered, so it returns to coveredColor.
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
    });

    it('lets external and computed coverage coexist across terminals (FR-A-12b)', () => {
      deps.terminals.set('t2', FAR_SIDE); // computed-uncovered
      calc.setConfig(config());
      calc.setEnabled(true);
      calc.setAssignment({
        assignments: [{ terminalId: 't2', links: [{ satelliteId: 'ext' }] }],
      });

      expect(deps.colors.get('t1')).toEqual(config().coveredColor); // computed
      expect(deps.colors.get('t2')).toEqual(config().coveredColor); // external
    });

    it('applies an external assignment while computation is DISABLED (M3 — standalone)', () => {
      // Resolved 2026-06-23 (Option A): an external assignment is authoritative
      // regardless of the computation toggle. With computation OFF it still
      // colors and links its named terminals; geometry is not run.
      deps.terminals.set('t1', FAR_SIDE); // geometrically uncovered — only the assignment can color it
      calc.setConfig(config({ showLinkLines: true }));
      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });

      expect(calc.isEnabled).toBe(false);
      // The non-empty assignment subscribes to the tick on its own (M3) so it
      // keeps tracking scene changes even with computation disabled.
      expect(listenerCount()).toBe(1);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
      expect(deps.linkPairs).toEqual([{ satelliteId: 'ext-sat', terminalId: 't1' }]);
    });

    it('defers an assignment supplied before any config until config arrives', () => {
      // Coloring needs CoverageConfig.coveredColor, so an assignment set before
      // config is a harmless no-op (no throw, no color) until setConfig lands.
      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });
      expect(deps.colors.get('t1')).toBeUndefined();

      calc.setConfig(config());
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
    });

    it('drives ONLY assigned terminals while disabled, leaving others at model default (M3)', () => {
      deps.terminals.set('t2', SURFACE_BELOW); // would be geometrically covered if computation ran
      calc.setConfig(config());
      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });

      expect(calc.isEnabled).toBe(false);
      expect(deps.colors.get('t1')).toEqual(config().coveredColor); // assigned
      // t2 is not assigned and computation is off → untouched (model default),
      // even though it sits under the beam. No geometry runs.
      expect(deps.colors.get('t2')).toBeUndefined();
    });

    it('releases the tick and reverts when the assignment is cleared while disabled (M3, FR-A-12d)', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setAssignment({
        assignments: [{ terminalId: 't1', links: [{ satelliteId: 'ext-sat' }] }],
      });
      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
      expect(listenerCount()).toBe(1);

      calc.clearAssignment();

      // Computation off and no assignment → fully idle: terminal reverts to model
      // default, link lines removed, tick listener released (NFR-A-04).
      expect(deps.colors.get('t1')).toBeUndefined();
      expect(deps.linkPairs).toHaveLength(0);
      expect(listenerCount()).toBe(0);
    });

    it('de-dups identical links per terminal so no redundant pairs are emitted (L4)', () => {
      deps.terminals.set('t1', FAR_SIDE);
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      calc.setAssignment({
        assignments: [
          {
            terminalId: 't1',
            // Two identical links to the same satellite must yield ONE pair.
            links: [{ satelliteId: 'ext-sat' }, { satelliteId: 'ext-sat' }],
          },
        ],
      });

      expect(deps.colors.get('t1')).toEqual(config().coveredColor);
      expect(deps.linkPairs).toEqual([{ satelliteId: 'ext-sat', terminalId: 't1' }]);
    });

    it('silently ignores an assignment for an unknown terminal id (L5)', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      // 'ghost' is not in the scene; it must be a no-op (no error, no pair).
      expect(() =>
        calc.setAssignment({
          assignments: [{ terminalId: 'ghost', links: [{ satelliteId: 's1' }] }],
        })
      ).not.toThrow();
      expect(deps.colors.has('ghost')).toBe(false);
      // The only emitted pair is the geometrically-covered t1↔s1, not 'ghost'.
      expect(deps.linkPairs).toEqual([{ satelliteId: 's1', terminalId: 't1' }]);
    });
  });

  describe('link-line precedence state machine (FR-A-16)', () => {
    it('draws no lines by default (showLinkLines false)', () => {
      calc.setConfig(config({ showLinkLines: false }));
      calc.setEnabled(true);
      expect(deps.linkPairs).toHaveLength(0);
    });

    it('draws lines for covered pairs when showLinkLines is true', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      expect(deps.linkPairs).toEqual([{ satelliteId: 's1', terminalId: 't1' }]);
    });

    it('imperative setLinkLinesVisible overrides config until next setConfig', () => {
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      expect(deps.linkPairs).toHaveLength(1);

      calc.setLinkLinesVisible(false); // override wins
      expect(deps.linkPairs).toHaveLength(0);

      // A new setConfig re-establishes the config value and clears the override.
      calc.setConfig(config({ showLinkLines: true }));
      expect(deps.linkPairs).toHaveLength(1);
    });

    it('forwards the link-line color from config', () => {
      calc.setConfig(config({ linkLineColor: { r: 1, g: 2, b: 3, a: 1 } }));
      expect(deps.linkColor).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    });
  });

  describe('no-ops (FR-A-20/21)', () => {
    it('colors nothing and draws nothing when no satellite has a beam', () => {
      deps.satellites.clear();
      calc.setConfig(config({ showLinkLines: true }));
      calc.setEnabled(true);
      expect(deps.colors.get('t1')).toBeUndefined();
      expect(deps.linkPairs).toHaveLength(0);
    });

    it('handles an empty terminal scene without error', () => {
      deps.terminals.clear();
      calc.setConfig(config());
      expect(() => calc.setEnabled(true)).not.toThrow();
      expect(deps.linkPairs).toHaveLength(0);
    });
  });
});
