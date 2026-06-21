import { Clock, JulianDate } from '@cesium/engine';

import { BeamDefinition, BeamGeometry } from '../../../core/models/beam.model';
import {
  CoverageAssignment,
  TerminalCoverageAssignment,
} from '../../../core/models/coverage-assignment.model';
import { CoverageConfig } from '../../../core/models/coverage.model';
import { LinkPair } from '../managers/link-line.manager';
import {
  BoresightFrame,
  computeBoresightFrame,
  computeBoresightOffsets,
  hasLineOfSight,
  isInsideBeam,
  Vec3,
} from './coverage-geometry';

/**
 * The collaborators the calculator reads/writes each tick. Passing these as a
 * plain interface (rather than the concrete managers) keeps the calculator
 * unit-testable with light fakes and keeps the spatial math the single concern
 * here (architecture-v2 §3.2.A / §5).
 */
export interface CoverageDeps {
  /** Satellite ids that currently have beams. */
  satelliteIds(): readonly string[];
  /** Resolved beams for a satellite. */
  beamsFor(satelliteId: string): readonly BeamDefinition[];
  /** Live satellite ECEF position for the current tick, or undefined. */
  satellitePosition(satelliteId: string, time: JulianDate | undefined): Vec3 | undefined;
  /** All terminal ids in the scene. */
  terminalIds(): readonly string[];
  /** Terminal ECEF position, or undefined for an unknown id. */
  terminalPosition(terminalId: string): Vec3 | undefined;
  /** Overlays/clears the terminal coverage color. */
  setTerminalColor(terminalId: string, color: CoverageConfig['coveredColor'] | undefined): void;
  /** Reconciles drawn link lines to exactly these covered pairs. */
  syncLinkLines(pairs: readonly LinkPair[]): void;
  /** Removes all link lines. */
  clearLinkLines(): void;
  /** Sets the link-line color. */
  setLinkLineColor(color: CoverageConfig['linkLineColor']): void;
}

/** A beam's geometry paired with its precomputed boresight frame for this tick. */
interface BeamFrame {
  geometry: BeamGeometry;
  frame: BoresightFrame;
}

/** A satellite's live position and the per-beam frames computed once per tick. */
interface SatelliteFrames {
  satelliteId: string;
  position: Vec3;
  beams: readonly BeamFrame[];
}

/**
 * Per-tick coverage computation, terminal recolor, external-assignment
 * override, and link-line membership. Lazily constructed by the engine on the
 * first `setCoverageComputationEnabled(true)` (NFR-A-04). The covered test is
 * the 3D cone-containment + Earth-occlusion test (FR-A-09d), kept in pure
 * functions ({@link ./coverage-geometry}) so the math is testable without
 * Cesium; this class wires those functions to the live managers and the clock.
 */
export class CoverageCalculator {
  private enabled = false;
  private config: CoverageConfig | undefined;
  private assignment: CoverageAssignment = { assignments: [] };

  // Link-line visibility state machine (FR-A-16). `overrideActive` marks an
  // imperative setLinkLinesVisible that wins until the next setCoverageConfig.
  private linkLinesVisible = false;
  private overrideActive = false;

  /** Terminals colored on the previous tick, so we only clear what we set. */
  private coloredTerminals = new Set<string>();

  /** Unsubscribe handle for the clock tick listener, when subscribed. */
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly clock: Clock,
    private readonly deps: CoverageDeps
  ) {}

  /**
   * Enables/disables computation (FR-A-09a/09b). Enabling subscribes to the
   * clock tick and evaluates immediately; disabling unsubscribes, reverts every
   * recolored terminal to its model default, and removes all link lines —
   * within one tick — while beams keep rendering (owned by BeamManager).
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      // L1 (review-v2): although `setEnabled` may be called from INSIDE the
      // Angular zone (via ngOnChanges → setCoverageComputationEnabled), this
      // listener FIRES inside Cesium's render loop, which the engine starts
      // under `runOutsideAngular` in `initialize`. zone.js keys re-entry off
      // where a listener fires, not where it is registered, so the per-tick
      // `recompute` introduces NO Angular change detection regardless of where
      // it was wired up (NFR-A-02).
      this.unsubscribe = this.clock.onTick.addEventListener(() => this.recompute());
      this.recompute();
    } else {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.revertAll();
    }
  }

  /**
   * Applies coverage colors/policy (FR-A-12). Also re-establishes the link-line
   * visibility from config and clears any imperative override (FR-A-16).
   */
  setConfig(config: CoverageConfig): void {
    this.config = config;
    this.linkLinesVisible = config.showLinkLines;
    this.overrideActive = false;
    this.deps.setLinkLineColor(config.linkLineColor);
    if (this.enabled) {
      this.recompute();
    }
  }

  /**
   * Imperative link-line visibility override (FR-A-16). Wins over
   * `CoverageConfig.showLinkLines` until the next {@link setConfig}.
   */
  setLinkLinesVisible(visible: boolean): void {
    this.linkLinesVisible = visible;
    this.overrideActive = true;
    if (this.enabled) {
      this.recompute();
    }
  }

  /**
   * Replaces the external assignment wholesale (FR-A-12a/12c).
   *
   * The assignment is APPLIED only while computation is enabled: it is stored
   * unconditionally, but it drives terminal coloring/link lines only on a
   * `recompute()`, which runs only when `enabled` is true. With computation off
   * the assignment is retained but inert (M3, review-v2 — kept as-built by user
   * decision; documented so it is not hidden magic). Unknown terminal/satellite
   * ids in the assignment are silently ignored: a phantom `terminalId` is never
   * visited (the recompute iterates scene terminals), and a `satelliteId` link
   * to a non-existent satellite resolves to an empty endpoint and draws nothing
   * (L5, review-v2).
   */
  setAssignment(assignment: CoverageAssignment): void {
    this.assignment = assignment;
    if (this.enabled) {
      this.recompute();
    }
  }

  /** Clears the external assignment (FR-A-12d). */
  clearAssignment(): void {
    this.setAssignment({ assignments: [] });
  }

  /** Whether computation is currently enabled. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Recomputes the covered set for the current tick and applies recolor +
   * link-line membership (FR-A-09/10/11/13/17/19). Idempotent within a tick.
   */
  private recompute(): void {
    if (!this.enabled || this.config === undefined) {
      return;
    }
    const time = this.clock.currentTime;
    const assignmentByTerminal = this.indexAssignment();
    const nextColored = new Set<string>();
    const pairs: LinkPair[] = [];

    // M4 (review-v2): the boresight frame depends only on (satellite position
    // this tick, beam azimuth/elevation) — NOT on the terminal. Compute every
    // (satellite, beam) frame ONCE per tick here, then test all terminals
    // against the precomputed frames. This removes the per-(beam × terminal)
    // `computeBoresightFrame` allocation that dominated the inner loop.
    //
    // Accepted v2 debt (toward the v3 fps gate, NFR-A-01): there is still no
    // static terminal spatial index or per-beam footprint bounding cap, so the
    // covered test remains O(satellites × beams × terminals) after the
    // per-(sat, terminal) line-of-sight cull. Those broad-phase structures are
    // intentionally deferred to v3 (architecture-v2 Decision D); v2's bar is
    // correctness at 5k terminals, which this satisfies.
    const satelliteFrames = this.computeSatelliteFrames(time);

    for (const terminalId of this.deps.terminalIds()) {
      const external = assignmentByTerminal.get(terminalId);
      const covered = external
        ? this.coveredFromAssignment(external, pairs, terminalId)
        : this.coveredFromComputation(terminalId, satelliteFrames, pairs);

      if (covered) {
        this.deps.setTerminalColor(terminalId, this.config.coveredColor);
        nextColored.add(terminalId);
      } else {
        // Uncovered: explicit uncoveredColor if provided, else model default.
        this.deps.setTerminalColor(terminalId, this.config.uncoveredColor);
        if (this.config.uncoveredColor !== undefined) {
          nextColored.add(terminalId);
        }
      }
    }

    // Revert terminals colored last tick but not this tick (FR-A-11, FR-A-12d).
    for (const id of this.coloredTerminals) {
      if (!nextColored.has(id)) {
        this.deps.setTerminalColor(id, undefined);
      }
    }
    this.coloredTerminals = nextColored;

    // Link lines only when visible (FR-A-16); always reconcile so removals land.
    this.deps.syncLinkLines(this.linkLinesVisible ? pairs : []);
  }

  /** External override branch (FR-A-12c): colored/linked straight from links. */
  private coveredFromAssignment(
    external: TerminalCoverageAssignment,
    pairs: LinkPair[],
    terminalId: string
  ): boolean {
    if (external.links.length === 0) {
      return false; // Force-uncovered (empty links is meaningful).
    }
    // L4 (review-v2): de-dup links per terminal so two identical
    // `{satelliteId}` entries don't emit redundant LinkPairs. (LinkLineManager
    // already de-dups entities by id, but the pair list should not carry
    // duplicates either.)
    const seen = new Set<string>();
    for (const link of external.links) {
      if (seen.has(link.satelliteId)) {
        continue;
      }
      seen.add(link.satelliteId);
      pairs.push({ satelliteId: link.satelliteId, terminalId });
    }
    return true;
  }

  /**
   * Computes, once per tick, each satellite's live ECEF position plus the
   * boresight frame for every one of its beams (M4 hoist). Satellites with no
   * resolvable position this tick are skipped. The returned frames are reused
   * across all terminals, so the per-beam frame math runs O(satellites × beams)
   * per tick instead of O(satellites × beams × terminals).
   */
  private computeSatelliteFrames(time: JulianDate | undefined): SatelliteFrames[] {
    const result: SatelliteFrames[] = [];
    for (const satelliteId of this.deps.satelliteIds()) {
      const position = this.deps.satellitePosition(satelliteId, time);
      if (position === undefined) {
        continue;
      }
      const beams = this.deps.beamsFor(satelliteId).map((beam) => ({
        geometry: beam.geometry,
        frame: computeBoresightFrame(position, beam.azimuth, beam.elevation),
      }));
      result.push({ satelliteId, position, beams });
    }
    return result;
  }

  /** Engine computation branch (FR-A-12b): geometric covered test (FR-A-09d). */
  private coveredFromComputation(
    terminalId: string,
    satelliteFrames: readonly SatelliteFrames[],
    pairs: LinkPair[]
  ): boolean {
    const terminal = this.deps.terminalPosition(terminalId);
    if (terminal === undefined) {
      return false;
    }
    let covered = false;
    for (const { satelliteId, position, beams } of satelliteFrames) {
      // Broad-phase: a terminal without line-of-sight to this satellite cannot
      // be covered by ANY of its beams, so test occlusion once per (sat,
      // terminal) before the per-beam angular tests (architecture-v2 §3.2.C).
      if (!hasLineOfSight(position, terminal)) {
        continue;
      }
      if (this.satelliteCovers(position, terminal, beams)) {
        covered = true;
        pairs.push({ satelliteId, terminalId });
      }
    }
    return covered;
  }

  /** True iff any of the satellite's beams geometrically contains the terminal. */
  private satelliteCovers(
    satellite: Vec3,
    terminal: Vec3,
    beams: readonly BeamFrame[]
  ): boolean {
    const toTerminal: Vec3 = {
      x: terminal.x - satellite.x,
      y: terminal.y - satellite.y,
      z: terminal.z - satellite.z,
    };
    for (const { geometry, frame } of beams) {
      const offsets = computeBoresightOffsets(
        toTerminal,
        frame.boresight,
        frame.azimuthAxis,
        frame.elevationAxis
      );
      if (isInsideBeam(offsets, geometry)) {
        return true;
      }
    }
    return false;
  }

  private indexAssignment(): Map<string, TerminalCoverageAssignment> {
    const map = new Map<string, TerminalCoverageAssignment>();
    for (const a of this.assignment.assignments) {
      map.set(a.terminalId, a);
    }
    return map;
  }

  /** Disable path (FR-A-09b): revert recolors and remove all link lines. */
  private revertAll(): void {
    for (const id of this.coloredTerminals) {
      this.deps.setTerminalColor(id, undefined);
    }
    this.coloredTerminals = new Set<string>();
    this.deps.clearLinkLines();
  }
}
