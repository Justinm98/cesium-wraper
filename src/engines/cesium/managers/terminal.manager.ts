import { Cartesian3, EntityCollection } from '@cesium/engine';

import { GeodeticPosition } from '../../../core/models/position.model';
import { TerminalConfig } from '../../../core/models/terminal.model';
import { ModelLoader } from '../services/model-loader.service';

/** See SatelliteManager for why ids are namespaced. */
const ID_PREFIX = 'terminal:';

/** Pixel floor so terminals remain visible when the camera is zoomed out. */
const MIN_PIXEL_SIZE = 24;

/**
 * Owns the lifecycle of ground terminal entities: fixed geodetic positions
 * and Cesium entity CRUD.
 */
export class TerminalManager {
  private readonly configs = new Map<string, TerminalConfig>();

  constructor(
    private readonly entities: EntityCollection,
    private readonly modelLoader: ModelLoader,
    private readonly maxTerminals: number
  ) {}

  add(config: TerminalConfig): void {
    if (this.configs.has(config.id)) {
      throw new Error(`Terminal '${config.id}' already exists; use updateTerminal instead.`);
    }
    if (this.configs.size >= this.maxTerminals) {
      throw new Error(
        `Terminal limit reached (maxTerminals=${this.maxTerminals}); ` +
          'raise GlobeConfig.performance.maxTerminals if your hardware allows.'
      );
    }
    this.entities.add(this.buildEntityOptions(config));
    this.configs.set(config.id, config);
  }

  update(id: string, patch: Partial<TerminalConfig>): void {
    const existing = this.configs.get(id);
    if (existing === undefined) {
      throw new Error(`Cannot update unknown terminal '${id}'.`);
    }
    const merged: TerminalConfig = { ...existing, ...patch, id };
    this.entities.removeById(ID_PREFIX + id);
    this.entities.add(this.buildEntityOptions(merged));
    this.configs.set(id, merged);
  }

  remove(id: string): void {
    if (!this.configs.has(id)) {
      return; // Removal is idempotent by contract.
    }
    this.entities.removeById(ID_PREFIX + id);
    this.configs.delete(id);
  }

  removeAll(): void {
    for (const id of [...this.configs.keys()]) {
      this.remove(id);
    }
  }

  get count(): number {
    return this.configs.size;
  }

  private buildEntityOptions(config: TerminalConfig): object {
    this.validatePosition(config.id, config.position);
    const { latitude, longitude, altitude } = config.position;
    return {
      id: ID_PREFIX + config.id,
      // Cesium's fromDegrees argument order is (longitude, latitude).
      position: Cartesian3.fromDegrees(longitude, latitude, altitude),
      model: {
        uri: this.modelLoader.resolveUri(config.model, 'terminal'),
        minimumPixelSize: MIN_PIXEL_SIZE,
      },
      ...(config.label !== undefined ? { label: { text: config.label } } : {}),
    };
  }

  /**
   * Rejects out-of-range coordinates at add/update time. Cesium would
   * silently place garbage values somewhere on (or inside) the globe,
   * which is far harder to debug than an immediate error.
   */
  private validatePosition(id: string, position: GeodeticPosition): void {
    const { latitude, longitude, altitude } = position;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`Terminal '${id}': latitude ${latitude} is outside [-90, 90].`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`Terminal '${id}': longitude ${longitude} is outside [-180, 180].`);
    }
    if (!Number.isFinite(altitude)) {
      throw new Error(`Terminal '${id}': altitude must be a finite number of meters.`);
    }
  }
}
