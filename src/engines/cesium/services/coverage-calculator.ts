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
   * Enables/disables the GEOMETRIC computation (FR-A-09a/09b). Enabling evaluates
   * immediately; disabling reverts every geometry-recolored terminal to its model
   * default and removes its link lines — within one tick — while beams keep
   * rendering (owned by BeamManager). An external assignment, if present, stays
   * authoritative for its named terminals regardless of this toggle (M3); see
   * {@link setAssignment} and {@link syncTickSubscription}.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    this.syncTickSubscription();
    // Applies the new state in this call: when enabling, evaluate now; when
    // disabling, the recompute reverts geometry-covered terminals while leaving
    // any externally-assigned terminals colored.
    this.recompute();
  }

  /**
   * Subscribes to / unsubscribes from the clock tick so the per-tick
   * {@link recompute} runs exactly when there is something to drive each frame:
   * the geometric computation (`enabled`) OR a non-empty external assignment,
   * which is authoritative for its named terminals regardless of the computation
   * toggle (FR-A-12a, M3). A fully-idle calculator (disabled, no assignment)
   * holds no listener, so it costs nothing per tick.
   *
   * L1 (review-v2): although this may run from INSIDE the Angular zone (via
   * ngOnChanges → setCoverage*), the listener FIRES inside Cesium's render loop,
   * which the engine starts under `runOutsideAngular` in `initialize`. zone.js
   * keys re-entry off where a listener fires, not where it is registered, so the
   * per-tick `recompute` introduces NO Angular change detection (NFR-A-02).
   */
  private syncTickSubscription(): void {
    const active = this.enabled || this.assignment.assignments.length > 0;
    if (active && this.unsubscribe === undefined) {
      this.unsubscribe = this.clock.onTick.addEventListener(() => this.recompute());
    } else if (!active && this.unsubscribe !== undefined) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Full teardown for engine destroy: unconditionally removes the tick listener
   * and reverts all visuals (recolors + link lines). Distinct from
   * `setEnabled(false)`, which may KEEP a live external assignment (M3); destroy
   * drops everything so nothing survives teardown (review-v2 M5).
   */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.enabled = false;
    this.assignment = { assignments: [] };
    this.revertAll();
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
    // Reapply with the new colors/visibility; recompute is a no-op while idle.
    this.recompute();
  }

  /**
   * Imperative link-line visibility override (FR-A-16). Wins over
   * `CoverageConfig.showLinkLines` until the next {@link setConfig}.
   */
  setLinkLinesVisible(visible: boolean): void {
    this.linkLinesVisible = visible;
    this.overrideActive = true;
    this.recompute();
  }

  /**
   * Replaces the external assignment wholesale (FR-A-12a/12c).
   *
   * The assignment is authoritative for the terminals it names and is APPLIED
   * regardless of the computation toggle (M3, review-v2 — resolved 2026-06-23 to
   * "apply standalone"): with computation OFF, the named terminals are still
   * colored/linked from the assignment and unnamed terminals stay at their model
   * default (no geometry runs); with computation ON, unnamed terminals fall back
   * to the engine's own FR-A-09d computation (FR-A-12b). A non-empty assignment
   * therefore subscribes to the tick on its own ({@link syncTickSubscription}) so
   * it tracks scene changes even when computation is disabled.
   *
   * Unknown terminal/satellite ids are silently ignored: a phantom `terminalId`
   * is never visited (recompute iterates scene terminals), and a `satelliteId`
   * link to a non-existent satellite resolves to an empty endpoint and draws
   * nothing (L5, review-v2).
   */
  setAssignment(assignment: CoverageAssignment): void {
    this.assignment = assignment;
    // A newly non-empty assignment may need the tick even with computation off; a
    // now-empty one with computation off can release it.
    this.syncTickSubscription();
    this.recompute();
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
    const config = this.config;
    if (config === undefined) {
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
    // `computeBoresightFrame` allocation that dominated the inner loop. Only
    // needed when the geometric computation is enabled (M3: with it off, only
    // externally-assigned terminals are driven, so no frames are built).
    //
    // Accepted v2 debt (toward the v3 fps gate, NFR-A-01): there is still no
    // static terminal spatial index or per-beam footprint bounding cap, so the
    // covered test remains O(satellites × beams × terminals) after the
    // per-(sat, terminal) line-of-sight cull. Those broad-phase structures are
    // intentionally deferred to v3 (architecture-v2 Decision D); v2's bar is
    // correctness at 5k terminals, which this satisfies.
    const satelliteFrames = this.enabled ? this.computeSatelliteFrames(time) : [];

    // Covered → coveredColor; explicitly uncovered → uncoveredColor (or model
    // default). A terminal that is neither externally assigned NOR geometrically
    // evaluated (computation off) is left untouched here and reverts to its
    // model default via the pass below (FR-A-09a/12d).
    const applyColor = (terminalId: string, covered: boolean): void => {
      if (covered) {
        this.deps.setTerminalColor(terminalId, config.coveredColor);
        nextColored.add(terminalId);
      } else {
        this.deps.setTerminalColor(terminalId, config.uncoveredColor);
        if (config.uncoveredColor !== undefined) {
          nextColored.add(terminalId);
        }
      }
    };

    for (const terminalId of this.deps.terminalIds()) {
      const external = assignmentByTerminal.get(terminalId);
      if (external !== undefined) {
        // External assignment is authoritative for this terminal (FR-A-12a/12c),
        // whether or not computation is enabled (M3).
        applyColor(terminalId, this.coveredFromAssignment(external, pairs, terminalId));
      } else if (this.enabled) {
        applyColor(terminalId, this.coveredFromComputation(terminalId, satelliteFrames, pairs));
      }
      // else: computation off and not assigned → model default (revert pass below).
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
