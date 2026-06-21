import { Observable } from 'rxjs';

import { CoverageConfig } from '../models/coverage.model';
import { CoverageAssignment } from '../models/coverage-assignment.model';
import { CustomEntityConfig } from '../models/custom-entity.model';
import { EntityEvent, TerminalPlacedEvent } from '../models/events.model';
import { GlobeConfig } from '../models/globe-config.model';
import { SatelliteConfig } from '../models/satellite.model';
import { TerminalConfig } from '../models/terminal.model';
import { TimeConfig } from '../models/time.model';

/**
 * The abstraction boundary of the library.
 *
 * Everything above this interface (the Angular layer, consumer apps) knows
 * nothing about CesiumJS; everything below it is engine-specific. A future
 * MapLibre or OpenLayers engine replaces the implementation without touching
 * consumers — this is the central constraint from docs/product-vision.md.
 *
 * Events are RxJS Observables rather than callbacks because consumer apps
 * are Angular/RxJS-native (Architecture Decision 3).
 */
export interface RenderingEngine {
  /**
   * Creates the globe inside `container`. Must be called exactly once
   * before any other method.
   */
  initialize(container: HTMLElement, config: GlobeConfig): Promise<void>;

  /** Tears down the scene and releases GPU resources. Idempotent. */
  destroy(): void;

  /** Adds a satellite. Throws if the id already exists or the scene is at capacity. */
  addSatellite(config: SatelliteConfig): void;
  /** Applies a partial update to an existing satellite. Throws on unknown id. */
  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void;
  /** Removes a satellite. No-op on unknown id. */
  removeSatellite(id: string): void;

  /** Adds a ground terminal. Throws if the id already exists or the scene is at capacity. */
  addTerminal(config: TerminalConfig): void;
  /** Applies a partial update to an existing terminal. Throws on unknown id. */
  updateTerminal(id: string, patch: Partial<TerminalConfig>): void;
  /** Removes a terminal. No-op on unknown id. */
  removeTerminal(id: string): void;

  /** Adds a generic 3D model (e.g., a building). */
  addCustomEntity(config: CustomEntityConfig): void;
  /** Applies a partial update to an existing custom entity. Throws on unknown id. */
  updateCustomEntity(id: string, patch: Partial<CustomEntityConfig>): void;
  /** Removes a custom entity. No-op on unknown id. */
  removeCustomEntity(id: string): void;

  /** Switches time mode / playback parameters. */
  setTimeConfig(config: TimeConfig): void;

  /** Configures coverage visualization (colors, link lines). */
  setCoverageConfig(config: CoverageConfig): void;

  /** Shows or hides satellite-to-terminal link lines. */
  setLinkLinesVisible(visible: boolean): void;

  /**
   * Enables or disables coverage **computation** at runtime (FR-A-09a/09b).
   * Default: disabled — beams still render (FR-A-01), but no terminal is
   * recolored, no covered set is computed, and no link line is drawn until
   * this is enabled. Disabling reverts all coverage recoloring and removes
   * engine-drawn link lines within one clock tick, while beams keep rendering.
   *
   * Orthogonal to {@link setCoverageConfig} (colors/policy) and
   * {@link setLinkLinesVisible} (line visibility) — three distinct axes.
   */
  setCoverageComputationEnabled(enabled: boolean): void;

  /**
   * Supplies/replaces external coverage assignments (FR-A-12a). Wholesale
   * replace, not a delta — the payload is the complete authoritative set. The
   * named terminals are colored/linked exactly as declared, overriding engine
   * computation per-terminal with no merge (FR-A-12c).
   *
   * Requires computation ENABLED (M3, review-v2 — user decision, kept
   * as-built): an assignment is applied only while
   * {@link setCoverageComputationEnabled}(true). With computation off the
   * assignment is stored but INERT — nothing is colored or linked until
   * computation is enabled. There is no error in that case.
   *
   * Unknown ids are silently ignored (L5, review-v2): an assignment naming a
   * `terminalId` not in the scene is a no-op, and a `satelliteId` link to a
   * non-existent satellite draws no visible line. No error or warning is raised.
   */
  setCoverageAssignment(assignment: CoverageAssignment): void;

  /**
   * Clears all external assignments (FR-A-12d). Equivalent to
   * `setCoverageAssignment({ assignments: [] })`. Affected terminals revert
   * within one clock tick to engine computation (if enabled) or to their
   * model-default appearance.
   */
  clearCoverageAssignment(): void;

  /** Emits when the end user clicks a 3D model. */
  readonly entityClick$: Observable<EntityEvent>;

  /** Emits when the end user hovers a 3D model. */
  readonly entityHover$: Observable<EntityEvent>;

  /** Emits when the end user drag-drops a terminal onto the globe. */
  readonly terminalPlaced$: Observable<TerminalPlacedEvent>;
}
