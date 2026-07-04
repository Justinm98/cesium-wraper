import { Cartesian3, Color, EntityCollection } from '@cesium/engine';

import { ColorConfig, GeodeticPosition } from '../../../core/models/position.model';
import { TerminalConfig } from '../../../core/models/terminal.model';
import { ModelLoader } from '../services/model-loader.service';

/** See SatelliteManager for why ids are namespaced. */
const ID_PREFIX = 'terminal:';

/** Pixel floor so terminals remain visible when the camera is zoomed out. */
const DEFAULT_MIN_PIXEL_SIZE = 1_000;

/**
 * Maximum scale for minimumPixelSize enforcement. Matches the satellite
 * default so terminals remain visible at continental zoom (~5 000 km camera
 * altitude → ~35 px) and scale proportionally as the camera descends.
 *
 * Transition distance (constant-pixel zone begins) ≈
 *   DEFAULT_MAX_SCALE × model_width_m × (viewport_px / FOV_rad) / DEFAULT_MIN_PIXEL_SIZE
 * ≈ 20 000 × 1.8 m × 979 / 1 000 ≈ 35 000 m ≈ 35 km from the terminal.
 */
const DEFAULT_MAX_SCALE = 20_000;

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

  /** Ids of all terminals currently in the scene (consumer-facing, un-namespaced). */
  get ids(): readonly string[] {
    return [...this.configs.keys()];
  }

  /**
   * The terminal's earth-fixed position in meters, for the coverage
   * computation. Returns `undefined` for an unknown id.
   */
  getPositionEcef(id: string): { x: number; y: number; z: number } | undefined {
    const config = this.configs.get(id);
    if (config === undefined) {
      return undefined;
    }
    const { latitude, longitude, altitude } = config.position;
    const c = Cartesian3.fromDegrees(longitude, latitude, altitude);
    return { x: c.x, y: c.y, z: c.z };
  }

  /**
   * Overlays a coverage color on the terminal's model, or clears the overlay
   * (reverting to the developer-supplied model default) when `color` is
   * `undefined`. The overlay is kept separate from the base config so the
   * coverage disable/clear path reverts cleanly without disturbing the model
   * the developer supplied (FR-A-09/10/11; architecture-v2 §3.2.E). No-op on
   * an unknown id.
   */
  setCoverageColor(id: string, color: ColorConfig | undefined): void {
    // Cesium's Entity types the model graphic strictly; the overlay sets the
    // glTF `model.color` directly, so the entity is treated structurally (via
    // unknown) to set a plain Color the same way the unit tests assert it.
    const entity = this.entities.getById(ID_PREFIX + id) as unknown as
      | { model?: { color?: Color | undefined } }
      | undefined;
    if (entity === undefined || entity.model === undefined) {
      return;
    }
    entity.model.color =
      color === undefined ? undefined : Color.fromBytes(color.r, color.g, color.b, color.a * 255);
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
        minimumPixelSize: config.scale?.minimumPixelSize ?? DEFAULT_MIN_PIXEL_SIZE,
        maximumScale: config.scale?.maximumScale ?? DEFAULT_MAX_SCALE,
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
