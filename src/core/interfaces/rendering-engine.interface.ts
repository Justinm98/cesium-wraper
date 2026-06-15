import { Observable } from 'rxjs';

import { CoverageConfig } from '../models/coverage.model';
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

  /** Emits when the end user clicks a 3D model. */
  readonly entityClick$: Observable<EntityEvent>;

  /** Emits when the end user hovers a 3D model. */
  readonly entityHover$: Observable<EntityEvent>;

  /** Emits when the end user drag-drops a terminal onto the globe. */
  readonly terminalPlaced$: Observable<TerminalPlacedEvent>;
}
