import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CoverageConfig } from '../core/models/coverage.model';
import { CoverageAssignment } from '../core/models/coverage-assignment.model';
import { CustomEntityConfig } from '../core/models/custom-entity.model';
import { EntityEvent, TerminalPlacedEvent } from '../core/models/events.model';
import { SatelliteConfig } from '../core/models/satellite.model';
import { TerminalConfig } from '../core/models/terminal.model';
import { TimeConfig } from '../core/models/time.model';
import { RENDERING_ENGINE } from './tokens';

/**
 * Imperative API for the globe, for use cases where `@Input()` bindings on
 * CesiumGlobeComponent are insufficient (e.g., updates driven by real-time
 * data streams).
 *
 * The service and the component deliberately share state through the
 * injected {@link RenderingEngine} singleton — not through Angular state —
 * so entities added here appear on the component-rendered globe.
 */
@Injectable()
export class CesiumGlobeService {
  private readonly engine = inject(RENDERING_ENGINE);

  /** Emits when the end user clicks a 3D model. */
  readonly entityClick$: Observable<EntityEvent> = this.engine.entityClick$;
  /** Emits when the end user hovers a 3D model. */
  readonly entityHover$: Observable<EntityEvent> = this.engine.entityHover$;
  /** Emits when the end user drag-drops a terminal onto the globe. */
  readonly terminalPlaced$: Observable<TerminalPlacedEvent> = this.engine.terminalPlaced$;

  addSatellite(config: SatelliteConfig): void {
    this.engine.addSatellite(config);
  }

  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void {
    this.engine.updateSatellite(id, patch);
  }

  removeSatellite(id: string): void {
    this.engine.removeSatellite(id);
  }

  addTerminal(config: TerminalConfig): void {
    this.engine.addTerminal(config);
  }

  updateTerminal(id: string, patch: Partial<TerminalConfig>): void {
    this.engine.updateTerminal(id, patch);
  }

  removeTerminal(id: string): void {
    this.engine.removeTerminal(id);
  }

  addCustomEntity(config: CustomEntityConfig): void {
    this.engine.addCustomEntity(config);
  }

  updateCustomEntity(id: string, patch: Partial<CustomEntityConfig>): void {
    this.engine.updateCustomEntity(id, patch);
  }

  removeCustomEntity(id: string): void {
    this.engine.removeCustomEntity(id);
  }

  setTimeConfig(config: TimeConfig): void {
    this.engine.setTimeConfig(config);
  }

  setCoverageConfig(config: CoverageConfig): void {
    this.engine.setCoverageConfig(config);
  }

  setLinkLinesVisible(visible: boolean): void {
    this.engine.setLinkLinesVisible(visible);
  }

  /** Enables or disables coverage computation at runtime (FR-A-09a/09b). */
  setCoverageComputationEnabled(enabled: boolean): void {
    this.engine.setCoverageComputationEnabled(enabled);
  }

  /**
   * Supplies/replaces external coverage assignments (FR-A-12a).
   *
   * Applied only while coverage computation is ENABLED (M3, review-v2 — user
   * decision): call {@link setCoverageComputationEnabled}(true) for the
   * assignment to drive coloring/link lines; with computation off it is stored
   * but inert. Unknown terminal/satellite/beam ids are silently ignored (L5).
   */
  setCoverageAssignment(assignment: CoverageAssignment): void {
    this.engine.setCoverageAssignment(assignment);
  }

  /** Clears all external coverage assignments (FR-A-12d). */
  clearCoverageAssignment(): void {
    this.engine.clearCoverageAssignment();
  }
}
