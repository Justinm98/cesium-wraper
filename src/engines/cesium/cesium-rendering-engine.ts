import {
  CesiumWidget,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
} from '@cesium/engine';
import { Observable, Subject } from 'rxjs';

import { RenderingEngine } from '../../core/interfaces/rendering-engine.interface';
import { CoverageAssignment } from '../../core/models/coverage-assignment.model';
import { CoverageConfig } from '../../core/models/coverage.model';
import { CustomEntityConfig } from '../../core/models/custom-entity.model';
import { EntityEvent, TerminalPlacedEvent } from '../../core/models/events.model';
import { GlobeConfig } from '../../core/models/globe-config.model';
import { SatelliteConfig } from '../../core/models/satellite.model';
import { TerminalConfig } from '../../core/models/terminal.model';
import { TimeConfig } from '../../core/models/time.model';
import { BeamManager } from './managers/beam.manager';
import { LinkLineManager } from './managers/link-line.manager';
import { SatelliteManager } from './managers/satellite.manager';
import { TerminalManager } from './managers/terminal.manager';
import { CoverageCalculator, CoverageDeps } from './services/coverage-calculator';
import { ModelLoader } from './services/model-loader.service';
import { TimeController } from './services/time-controller';

const DEFAULT_MAX_SATELLITES = 100;
const DEFAULT_MAX_TERMINALS = 5000;
const DEFAULT_MAX_BEAMS_PER_SATELLITE = 10;
const DEFAULT_ASSET_BASE_URL = 'assets/cesium-wrapper';

/**
 * EOX Sentinel-2 cloudless mosaic, served as Web Mercator XYZ tiles. This is
 * the imagery behind {@link TileProviderConfig.type} `'satellite'`.
 *
 * The `_3857` layer is the Web Mercator variant (matrix set `g`), which
 * matches Cesium's default WebMercatorTilingScheme for UrlTemplateImageryProvider.
 */
const SENTINEL2_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';

/**
 * CC BY 4.0 attribution for the Sentinel-2 cloudless mosaic. The licence
 * requires this credit to be shown; passing it to the provider renders it in
 * Cesium's on-screen credit display so consumers are compliant by default.
 */
const SENTINEL2_CREDIT =
  'Sentinel-2 cloudless 2020 by EOX IT Services GmbH — ' +
  'contains modified Copernicus Sentinel data 2020 (CC BY 4.0)';

/**
 * Deepest zoom level EOX serves for this layer. Capping here means a closer
 * zoom re-uses (upsamples) the level-16 tile instead of requesting tiles that
 * do not exist and rendering blank — blurry beats missing.
 */
const SENTINEL2_MAX_LEVEL = 16;

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
  private beams: BeamManager | undefined;
  private linkLines: LinkLineManager | undefined;
  private timeController: TimeController | undefined;

  /**
   * Coverage computation is opt-in (FR-A-09a). The calculator is constructed
   * lazily on the first {@link setCoverageComputationEnabled}(true) so a
   * beams-only consumer pays nothing at runtime (NFR-A-04). These fields hold
   * the latest config/assignment/link-visibility so a later lazy construction
   * starts in the correct state.
   */
  private coverage: CoverageCalculator | undefined;
  private coverageConfig: CoverageConfig | undefined;
  private coverageAssignment: CoverageAssignment = { assignments: [] };
  private linkLinesVisibleOverride: boolean | undefined;

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
    this.beams = new BeamManager(
      this.widget.entities,
      config.performance?.maxBeamsPerSatellite ?? DEFAULT_MAX_BEAMS_PER_SATELLITE,
      (satId, time) => this.satellites?.getPosition(satId, time)
    );
    this.linkLines = new LinkLineManager(
      this.widget.entities,
      (satId, time) => this.satellites?.getPosition(satId, time),
      (terminalId) => this.terminals?.getPositionEcef(terminalId)
    );
    this.timeController = new TimeController(this.widget.clock);
    // Satellites must move out of the box; realtime is the v1 default.
    this.timeController.apply({ mode: 'realtime' });
  }

  destroy(): void {
    if (this.widget === undefined) {
      return; // Idempotent by contract.
    }
    // M5 (review-v2): explicitly tear down the coverage tick listener BEFORE
    // destroying the widget/clock, rather than relying on `widget.destroy()`
    // implicitly disposing the clock's onTick event. `setEnabled(false)`
    // removes the registered listener (and reverts recolors / clears link
    // lines) so no per-tick `recompute()` can survive teardown.
    this.coverage?.setEnabled(false);
    if (!this.widget.isDestroyed()) {
      this.widget.destroy();
    }
    this.widget = undefined;
    this.satellites = undefined;
    this.terminals = undefined;
    this.beams = undefined;
    this.linkLines = undefined;
    this.timeController = undefined;
    // Drop coverage so a re-initialized engine starts disabled (FR-A-09a) and
    // re-constructs the calculator lazily on next enable (NFR-A-04).
    this.coverage = undefined;
    // L7 (review-v2, closes review.md L4): complete the interaction subjects so
    // any subscribers receive completion and do not leak past engine teardown.
    this.entityClickSubject.complete();
    this.entityHoverSubject.complete();
    this.terminalPlacedSubject.complete();
  }

  addSatellite(config: SatelliteConfig): void {
    // Add the satellite model first, then its beams (the beam position
    // accessor reads the satellite's now-registered propagation callback).
    this.requireSatellites().add(config);
    this.requireBeams().syncBeams(config.id, config.beams);
  }

  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void {
    this.requireSatellites().update(id, patch);
    // Re-sync beams only when the patch carried a `beams` key, so a model-only
    // update does not churn beams (FR-A-06; architecture-v2 §3.1.D).
    if ('beams' in patch) {
      this.requireBeams().syncBeams(id, patch.beams);
    }
  }

  removeSatellite(id: string): void {
    this.requireSatellites().remove(id);
    this.requireBeams().removeSatellite(id);
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

  setCoverageConfig(config: CoverageConfig): void {
    this.requireInitialized();
    this.coverageConfig = config;
    // A new config re-establishes link-line visibility and clears any imperative
    // override (FR-A-16), so drop the stored override.
    this.linkLinesVisibleOverride = undefined;
    this.requireLinkLines().setColor(config.linkLineColor);
    this.coverage?.setConfig(config);
  }

  setLinkLinesVisible(visible: boolean): void {
    this.requireInitialized();
    this.linkLinesVisibleOverride = visible;
    this.coverage?.setLinkLinesVisible(visible);
  }

  setCoverageComputationEnabled(enabled: boolean): void {
    this.requireInitialized();
    if (enabled) {
      // Lazy construction on first enable (NFR-A-04): a beams-only consumer
      // never instantiates the calculator nor registers its tick listener.
      this.ensureCoverage().setEnabled(true);
    } else {
      // If never constructed, disabled is already the state — nothing to do.
      this.coverage?.setEnabled(false);
    }
  }

  setCoverageAssignment(assignment: CoverageAssignment): void {
    this.requireInitialized();
    this.coverageAssignment = assignment;
    this.coverage?.setAssignment(assignment);
  }

  clearCoverageAssignment(): void {
    this.setCoverageAssignment({ assignments: [] });
  }

  private createImageryProvider(
    config: GlobeConfig
  ): OpenStreetMapImageryProvider | UrlTemplateImageryProvider {
    const provider = config.tileProvider;
    // OSM remains the zero-config default (free, no key, street map).
    if (provider === undefined || provider.type === 'osm') {
      return new OpenStreetMapImageryProvider({});
    }
    if (provider.type === 'satellite') {
      // Bundled cloud-free satellite imagery. CC BY 4.0, so the credit must
      // travel with it (see SENTINEL2_CREDIT) to keep consumers compliant.
      return new UrlTemplateImageryProvider({
        url: SENTINEL2_URL,
        credit: SENTINEL2_CREDIT,
        maximumLevel: SENTINEL2_MAX_LEVEL,
      });
    }
    // type === 'custom'
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

  private requireBeams(): BeamManager {
    if (this.beams === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.beams;
  }

  private requireLinkLines(): LinkLineManager {
    if (this.linkLines === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    return this.linkLines;
  }

  private requireInitialized(): void {
    if (this.widget === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
  }

  /**
   * Constructs the {@link CoverageCalculator} on first use and restores the
   * latest config/assignment/link-visibility into it, so enabling coverage
   * after config was already set behaves identically to setting it after.
   */
  private ensureCoverage(): CoverageCalculator {
    if (this.coverage !== undefined) {
      return this.coverage;
    }
    if (this.widget === undefined) {
      throw new Error(NOT_INITIALIZED);
    }
    const beams = this.requireBeams();
    const terminals = this.requireTerminals();
    const satellites = this.requireSatellites();
    const linkLines = this.requireLinkLines();
    const deps: CoverageDeps = {
      satelliteIds: () => beams.satelliteIds,
      beamsFor: (id) => beams.getBeams(id),
      satellitePosition: (id, time) => satellites.getPosition(id, time),
      terminalIds: () => terminals.ids,
      terminalPosition: (id) => terminals.getPositionEcef(id),
      setTerminalColor: (id, color) => terminals.setCoverageColor(id, color),
      syncLinkLines: (pairs) => linkLines.sync(pairs),
      clearLinkLines: () => linkLines.clear(),
      setLinkLineColor: (color) => linkLines.setColor(color),
    };
    const calculator = new CoverageCalculator(this.widget.clock, deps);
    // Restore the latest state captured before lazy construction.
    if (this.coverageConfig !== undefined) {
      calculator.setConfig(this.coverageConfig);
    }
    calculator.setAssignment(this.coverageAssignment);
    if (this.linkLinesVisibleOverride !== undefined) {
      calculator.setLinkLinesVisible(this.linkLinesVisibleOverride);
    }
    this.coverage = calculator;
    return calculator;
  }
}
