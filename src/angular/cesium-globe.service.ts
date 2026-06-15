import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CoverageConfig } from '../core/models/coverage.model';
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
}
