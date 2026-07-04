import {
  CallbackProperty,
  Cartesian3,
  Color,
  EntityCollection,
  JulianDate,
  PolylineGraphics,
} from '@cesium/engine';

import { ColorConfig } from '../../../core/models/position.model';
import { SatellitePositionAccessor } from './beam.manager';

/** Link-line ids extend the existing namespacing convention. */
const ID_PREFIX = 'link:';

/** Engine default link-line color when CoverageConfig.linkLineColor is omitted (FR-A-14). */
const DEFAULT_COLOR: ColorConfig = { r: 255, g: 255, b: 0, a: 1 };

/** A covered (satellite, terminal) pair that should have a link line drawn. */
export interface LinkPair {
  satelliteId: string;
  terminalId: string;
}

/** Resolves a terminal's earth-fixed position for the static line endpoint. */
export type TerminalPositionAccessor = (
  terminalId: string
) => { x: number; y: number; z: number } | undefined;

/**
 * Owns the Cesium entities for satellite↔terminal link lines (FR-A-13).
 * Membership is decided by {@link CoverageCalculator}; this manager only does
 * entity CRUD, keeping spatial math separate from rendering (architecture-v2
 * §3.3). Exactly one line per covered pair, namespaced
 * `link:<satelliteId>:<terminalId>`.
 *
 * The satellite endpoint is a {@link CallbackProperty} reading the live
 * satellite position, so the line tracks motion in the render loop with no
 * Angular work (FR-A-15, NFR-A-02). The terminal endpoint is static.
 */
export class LinkLineManager {
  /** Currently-drawn pairs, keyed by entity id. */
  private readonly drawn = new Set<string>();
  private color: Color = toColor(DEFAULT_COLOR);

  constructor(
    private readonly entities: EntityCollection,
    private readonly getSatellitePosition: SatellitePositionAccessor,
    private readonly getTerminalPosition: TerminalPositionAccessor
  ) {}

  /**
   * Sets the link-line color (from CoverageConfig.linkLineColor or default).
   * Any currently-drawn lines are removed so the next {@link sync} recreates
   * them with the new color — a config change therefore takes effect within one
   * tick (FR-A-14) without reaching into live entity internals (which keeps the
   * implementation identical across the unit mock and real Cesium).
   */
  setColor(color: ColorConfig | undefined): void {
    const next = toColor(color ?? DEFAULT_COLOR);
    // L3 (review-v2): the engine calls setColor on EVERY setCoverageConfig, so a
    // config change that does not touch the link-line color (e.g. only
    // coveredColor) must not tear down and rebuild every drawn line. Only clear
    // when the color actually changed; an unchanged color is a no-op.
    if (this.color.equals(next)) {
      return;
    }
    this.color = next;
    this.clear();
  }

  /**
   * Reconciles the drawn lines to exactly `pairs` (diff add/remove, not
   * rebuild-all): pairs that newly appear get a line, pairs that left coverage
   * have their line removed within the same tick (FR-A-15).
   */
  sync(pairs: readonly LinkPair[]): void {
    const wanted = new Set<string>();
    for (const pair of pairs) {
      const id = this.entityId(pair);
      wanted.add(id);
      if (!this.drawn.has(id)) {
        this.entities.add(this.buildEntityOptions(id, pair));
        this.drawn.add(id);
      }
    }
    for (const id of [...this.drawn]) {
      if (!wanted.has(id)) {
        this.entities.removeById(id);
        this.drawn.delete(id);
      }
    }
  }

  /** Removes every link line (coverage disabled or hidden). */
  clear(): void {
    for (const id of this.drawn) {
      this.entities.removeById(id);
    }
    this.drawn.clear();
  }

  /** Count of drawn link lines, for tests/diagnostics. */
  get count(): number {
    return this.drawn.size;
  }

  private entityId(pair: LinkPair): string {
    return `${ID_PREFIX}${pair.satelliteId}:${pair.terminalId}`;
  }

  private buildEntityOptions(id: string, pair: LinkPair): object {
    const terminal = this.getTerminalPosition(pair.terminalId);
    const terminalPosition =
      terminal === undefined
        ? new Cartesian3(0, 0, 0)
        : new Cartesian3(terminal.x, terminal.y, terminal.z);
    return {
      id,
      polyline: new PolylineGraphics({
        // The satellite endpoint is dynamic; the terminal endpoint is static.
        positions: new CallbackProperty((time: JulianDate | undefined) => {
          const sat = this.getSatellitePosition(pair.satelliteId, time);
          return sat === undefined ? [] : [sat, terminalPosition];
        }, false),
        material: this.color,
        width: 1,
      }),
    };
  }
}

function toColor(color: ColorConfig): Color {
  return Color.fromBytes(color.r, color.g, color.b, color.a * 255);
}
