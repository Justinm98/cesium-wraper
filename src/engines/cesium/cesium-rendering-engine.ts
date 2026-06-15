import {
  CesiumWidget,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
} from '@cesium/engine';
import { Observable, Subject } from 'rxjs';

import { RenderingEngine } from '../../core/interfaces/rendering-engine.interface';
import { CoverageConfig } from '../../core/models/coverage.model';
import { CustomEntityConfig } from '../../core/models/custom-entity.model';
import { EntityEvent, TerminalPlacedEvent } from '../../core/models/events.model';
import { GlobeConfig } from '../../core/models/globe-config.model';
import { SatelliteConfig } from '../../core/models/satellite.model';
import { TerminalConfig } from '../../core/models/terminal.model';
import { TimeConfig } from '../../core/models/time.model';
import { SatelliteManager } from './managers/satellite.manager';
import { TerminalManager } from './managers/terminal.manager';
import { ModelLoader } from './services/model-loader.service';
import { TimeController } from './services/time-controller';

const DEFAULT_MAX_SATELLITES = 100;
const DEFAULT_MAX_TERMINALS = 5000;
const DEFAULT_ASSET_BASE_URL = 'assets/cesium-wrapper';

/** Thrown by every scene method when initialize() has not completed. */
const NOT_INITIALIZED =
  'CesiumRenderingEngine is not initialized; call initialize(container, config) first.';

/**
 * CesiumJS implementation of {@link RenderingEngine}.
 *
 * This class is the only place a Cesium Viewer/Widget is created; all
 * Cesium types stay behind this file and the managers it owns. It uses
 * CesiumWidget from @cesium/engine (not the full Viewer) because the
 * library renders its own UI through Angular and must not bundle Cesium's
 * widget chrome.
 */
export class CesiumRenderingEngine implements RenderingEngine {
  private widget: CesiumWidget | undefined;
  private satellites: SatelliteManager | undefined;
  private terminals: TerminalManager | undefined;
  private timeController: TimeController | undefined;

  // Interaction streams are part of the engine contract but only produce
  // values post-v1, when picking is implemented (docs/architecture.md §10).
  private readonly entityClickSubject = new Subject<EntityEvent>();
  private readonly entityHoverSubject = new Subject<EntityEvent>();
  private readonly terminalPlacedSubject = new Subject<TerminalPlacedEvent>();

  readonly entityClick$: Observable<EntityEvent> = this.entityClickSubject.asObservable();
  readonly entityHover$: Observable<EntityEvent> = this.entityHoverSubject.asObservable();
  readonly terminalPlaced$: Observable<TerminalPlacedEvent> =
    this.terminalPlacedSubject.asObservable();

  async initialize(container: HTMLElement, config: GlobeConfig): Promise<void> {
    if (this.widget !== undefined) {
      throw new Error('CesiumRenderingEngine.initialize() called twice; call destroy() first.');
    }
    if (config.ionToken !== undefined) {
      Ion.defaultAccessToken = config.ionToken;
    }
    this.widget = new CesiumWidget(container, {
      baseLayer: new ImageryLayer(this.createImageryProvider(config), {}),
      // The library renders no stars/atmosphere chrome; skipping them saves
      // GPU time on the integrated-graphics machines we target.
      skyBox: false,
      skyAtmosphere: false,
    });

    const modelLoader = new ModelLoader(config.assetBaseUrl ?? DEFAULT_ASSET_BASE_URL);
    this.satellites = new SatelliteManager(
      this.widget.entities,
      modelLoader,
      config.performance?.maxSatellites ?? DEFAULT_MAX_SATELLITES
    );
    this.terminals = new TerminalManager(
      this.widget.entities,
      modelLoader,
      config.performance?.maxTerminals ?? DEFAULT_MAX_TERMINALS
    );
    this.timeController = new TimeController(this.widget.clock);
    // Satellites must move out of the box; realtime is the v1 default.
    this.timeController.apply({ mode: 'realtime' });
  }

  destroy(): void {
    if (this.widget === undefined) {
      return; // Idempotent by contract.
    }
    if (!this.widget.isDestroyed()) {
      this.widget.destroy();
    }
    this.widget = undefined;
    this.satellites = undefined;
    this.terminals = undefined;
    this.timeController = undefined;
  }

  addSatellite(config: SatelliteConfig): void {
    this.requireSatellites().add(config);
  }

  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void {
    this.requireSatellites().update(id, patch);
  }

  removeSatellite(id: string): void {
    this.requireSatellites().remove(id);
  }

  addTerminal(config: TerminalConfig): void {
    this.requireTerminals().add(config);
  }

  updateTerminal(id: string, patch: Partial<TerminalConfig>): void {
    this.requireTerminals().update(id, patch);
  }

  removeTerminal(id: string): void {
    this.requireTerminals().remove(id);
  }

  addCustomEntity(_config: CustomEntityConfig): void {
    throw new Error('Custom entities are not implemented in v1 (docs/architecture.md §10).');
  }

  updateCustomEntity(_id: string, _patch: Partial<CustomEntityConfig>): void {
    throw new Error('Custom entities are not implemented in v1 (docs/architecture.md §10).');
  }

  removeCustomEntity(_id: string): void {
    throw new Error('Custom entities are not implemented in v1 (docs/architecture.md §10).');
  }

  setTimeConfig(config: TimeConfig): void {
    if (this.timeController === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    this.timeController.apply(config);
  }

  setCoverageConfig(_config: CoverageConfig): void {
    throw new Error('Coverage visualization is not implemented in v1 (docs/architecture.md §10).');
  }

  setLinkLinesVisible(_visible: boolean): void {
    throw new Error('Link lines are not implemented in v1 (docs/architecture.md §10).');
  }

  private createImageryProvider(
    config: GlobeConfig
  ): OpenStreetMapImageryProvider | UrlTemplateImageryProvider {
    const provider = config.tileProvider;
    if (provider === undefined || provider.type === 'osm') {
      return new OpenStreetMapImageryProvider({});
    }
    if (provider.url === undefined) {
      throw new Error("TileProviderConfig.url is required when type is 'custom'.");
    }
    return new UrlTemplateImageryProvider({ url: provider.url });
  }

  private requireSatellites(): SatelliteManager {
    if (this.satellites === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.satellites;
  }

  private requireTerminals(): TerminalManager {
    if (this.terminals === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.terminals;
  }
}
