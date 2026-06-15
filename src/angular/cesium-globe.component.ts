import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { CoverageConfig } from '../core/models/coverage.model';
import { CustomEntityConfig } from '../core/models/custom-entity.model';
import { EntityEvent, TerminalPlacedEvent } from '../core/models/events.model';
import { GlobeConfig } from '../core/models/globe-config.model';
import { SatelliteConfig } from '../core/models/satellite.model';
import { TerminalConfig } from '../core/models/terminal.model';
import { TimeConfig } from '../core/models/time.model';
import { GLOBE_CONFIG, RENDERING_ENGINE } from './tokens';

/** CRUD operations the diffing sync needs from the engine, per entity kind. */
interface EntityOps<T extends { id: string }> {
  add(config: T): void;
  update(id: string, patch: Partial<T>): void;
  remove(id: string): void;
}

/**
 * Declarative Angular face of the globe.
 *
 * Entity arrays are diffed by id and object reference on every change —
 * the scene is patched (add/update/remove), never rebuilt, so feeding a
 * new array with one extra satellite touches exactly one entity
 * (docs/architecture.md §6.1).
 *
 * Initialization is asynchronous (the engine loads imagery providers), so
 * input changes arriving before the engine is ready are held and applied
 * once initialization completes.
 */
@Component({
  selector: 'cesium-globe',
  standalone: true,
  template: `<div #container style="width:100%;height:100%"></div>`,
})
export class CesiumGlobeComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('container', { static: true })
  private containerRef!: ElementRef<HTMLElement>;

  @Input() satellites: readonly SatelliteConfig[] = [];
  @Input() terminals: readonly TerminalConfig[] = [];
  @Input() customEntities: readonly CustomEntityConfig[] = [];
  @Input() timeConfig?: TimeConfig;
  @Input() coverageConfig?: CoverageConfig;
  /** Per-instance globe configuration; overrides the provideGlobe() default. */
  @Input() globeConfig?: GlobeConfig;

  @Output() entityClicked = new EventEmitter<EntityEvent>();
  @Output() entityHovered = new EventEmitter<EntityEvent>();
  @Output() terminalPlaced = new EventEmitter<TerminalPlacedEvent>();
  /**
   * Emits when engine initialization fails (e.g., WebGL unavailable, bad
   * custom tile URL). Without a handler the globe stays empty; applications
   * should surface this to the user.
   */
  @Output() initError = new EventEmitter<Error>();

  private readonly engine = inject(RENDERING_ENGINE);
  private readonly defaultConfig = inject(GLOBE_CONFIG, { optional: true });
  private readonly zone = inject(NgZone);
  private readonly subscriptions = new Subscription();

  private ready = false;
  private destroyed = false;
  private readonly appliedSatellites = new Map<string, SatelliteConfig>();
  private readonly appliedTerminals = new Map<string, TerminalConfig>();
  private readonly appliedCustomEntities = new Map<string, CustomEntityConfig>();

  async ngOnInit(): Promise<void> {
    // Engine events originate outside Angular (Cesium DOM handlers), so
    // re-enter the zone before emitting or change detection will not run.
    this.subscriptions.add(
      this.engine.entityClick$.subscribe((e) => this.zone.run(() => this.entityClicked.emit(e)))
    );
    this.subscriptions.add(
      this.engine.entityHover$.subscribe((e) => this.zone.run(() => this.entityHovered.emit(e)))
    );
    this.subscriptions.add(
      this.engine.terminalPlaced$.subscribe((e) => this.zone.run(() => this.terminalPlaced.emit(e)))
    );

    try {
      // Outside the zone, or Cesium's requestAnimationFrame loop would
      // trigger Angular change detection on every rendered frame.
      await this.zone.runOutsideAngular(() =>
        this.engine.initialize(
          this.containerRef.nativeElement,
          this.globeConfig ?? this.defaultConfig ?? {}
        )
      );
    } catch (error) {
      this.initError.emit(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (this.destroyed) {
      // The component was destroyed while initialization was in flight;
      // ngOnDestroy already ran, so release whatever initialize() created.
      this.engine.destroy();
      return;
    }
    this.ready = true;

    // Apply whatever inputs were bound while initialization was in flight.
    this.syncAllEntities();
    if (this.timeConfig !== undefined) {
      this.engine.setTimeConfig(this.timeConfig);
    }
    if (this.coverageConfig !== undefined) {
      this.engine.setCoverageConfig(this.coverageConfig);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) {
      return; // ngOnInit applies the latest inputs once the engine is up.
    }
    this.syncAllEntities();
    if ('timeConfig' in changes && this.timeConfig !== undefined) {
      this.engine.setTimeConfig(this.timeConfig);
    }
    if ('coverageConfig' in changes && this.coverageConfig !== undefined) {
      this.engine.setCoverageConfig(this.coverageConfig);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.ready = false;
    this.subscriptions.unsubscribe();
    this.engine.destroy();
  }

  private syncAllEntities(): void {
    this.syncEntities(this.satellites, this.appliedSatellites, {
      add: (c) => this.engine.addSatellite(c),
      update: (id, p) => this.engine.updateSatellite(id, p),
      remove: (id) => this.engine.removeSatellite(id),
    });
    this.syncEntities(this.terminals, this.appliedTerminals, {
      add: (c) => this.engine.addTerminal(c),
      update: (id, p) => this.engine.updateTerminal(id, p),
      remove: (id) => this.engine.removeTerminal(id),
    });
    this.syncEntities(this.customEntities, this.appliedCustomEntities, {
      add: (c) => this.engine.addCustomEntity(c),
      update: (id, p) => this.engine.updateCustomEntity(id, p),
      remove: (id) => this.engine.removeCustomEntity(id),
    });
  }

  /**
   * Diffs the bound array against what is on the globe. A changed object
   * reference counts as an update; developers must treat configs as
   * immutable (replace, don't mutate) — standard Angular change-detection
   * semantics.
   */
  private syncEntities<T extends { id: string }>(
    current: readonly T[],
    applied: Map<string, T>,
    ops: EntityOps<T>
  ): void {
    const currentIds = new Set<string>();
    for (const config of current) {
      currentIds.add(config.id);
      const previous = applied.get(config.id);
      if (previous === undefined) {
        ops.add(config);
        applied.set(config.id, config);
      } else if (previous !== config) {
        ops.update(config.id, config);
        applied.set(config.id, config);
      }
    }
    for (const id of [...applied.keys()]) {
      if (!currentIds.has(id)) {
        ops.remove(id);
        applied.delete(id);
      }
    }
  }
}
