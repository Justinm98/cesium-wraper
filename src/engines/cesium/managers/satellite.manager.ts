import {
  CallbackPositionProperty,
  Cartesian3,
  EntityCollection,
  JulianDate,
} from '@cesium/engine';
import { eciToEcf, gstime, propagate, twoline2satrec } from 'satellite.js';

import { SatelliteConfig } from '../../../core/models/satellite.model';
import { TleData } from '../../../core/models/satellite.model';
import { ModelLoader } from '../services/model-loader.service';

/**
 * Entity ids are namespaced per manager so a satellite and a terminal with
 * the same developer-supplied id cannot collide inside the shared Cesium
 * EntityCollection.
 */
const ID_PREFIX = 'satellite:';

/**
 * Pixel floor for satellite models. At orbital distances a meter-scale
 * model is sub-pixel; without a floor satellites would be invisible.
 */
const DEFAULT_MIN_PIXEL_SIZE = 1_000;

/**
 * Maximum scale multiplier for minimumPixelSize enforcement. Without this,
 * Cesium scales the model to maintain the pixel floor at every distance,
 * making the model appear the same size regardless of zoom. With this cap,
 * the model shrinks naturally beyond ~100 km from the satellite and grows
 * as the camera approaches — giving users proportional zoom feedback.
 *
 * Transition distance (where constant-pixel zone begins) ≈
 *   DEFAULT_MAX_SCALE × model_width_m × (viewport_px / FOV_rad) / DEFAULT_MIN_PIXEL_SIZE
 * ≈ 20 000 × 5 m × 979 / 1 000 ≈ 98 000 m ≈ 98 km from the satellite.
 */
const DEFAULT_MAX_SCALE = 20_000;

/**
 * Owns the lifecycle of satellite entities: TLE validation, position
 * propagation via satellite.js (Architecture Decision 2), and Cesium
 * entity CRUD.
 */
export class SatelliteManager {
  private readonly configs = new Map<string, SatelliteConfig>();

  constructor(
    private readonly entities: EntityCollection,
    private readonly modelLoader: ModelLoader,
    private readonly maxSatellites: number
  ) {}

  add(config: SatelliteConfig): void {
    if (this.configs.has(config.id)) {
      throw new Error(`Satellite '${config.id}' already exists; use updateSatellite instead.`);
    }
    if (this.configs.size >= this.maxSatellites) {
      throw new Error(
        `Satellite limit reached (maxSatellites=${this.maxSatellites}); ` +
          'raise GlobeConfig.performance.maxSatellites if your hardware allows.'
      );
    }
    this.entities.add(this.buildEntityOptions(config));
    this.configs.set(config.id, config);
  }

  update(id: string, patch: Partial<SatelliteConfig>): void {
    const existing = this.configs.get(id);
    if (existing === undefined) {
      throw new Error(`Cannot update unknown satellite '${id}'.`);
    }
    // Remove-and-re-add keeps update semantics identical to add semantics
    // (one code path builds entities). At v1 scale and update rates this is
    // not a performance concern; revisit if updates become per-frame.
    const merged: SatelliteConfig = { ...existing, ...patch, id };
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

  /**
   * Builds the Cesium entity options object, validating the TLE eagerly so
   * a bad TLE fails at addSatellite() time with a useful message rather
   * than producing a satellite that silently never appears.
   */
  private buildEntityOptions(config: SatelliteConfig): object {
    const positionCallback = this.createPositionCallback(config.id, config.tle);
    return {
      id: ID_PREFIX + config.id,
      // isConstant=false: position changes every clock tick.
      position: new CallbackPositionProperty(positionCallback, false),
      model: {
        uri: this.modelLoader.resolveUri(config.model, 'satellite'),
        minimumPixelSize: config.scale?.minimumPixelSize ?? DEFAULT_MIN_PIXEL_SIZE,
        maximumScale: config.scale?.maximumScale ?? DEFAULT_MAX_SCALE,
      },
      ...(config.label !== undefined ? { label: { text: config.label } } : {}),
    };
  }

  private createPositionCallback(
    id: string,
    tle: TleData
  ): (time: JulianDate | undefined) => Cartesian3 | undefined {
    const satrec = twoline2satrec(tle.line1, tle.line2);
    // satellite.js does not validate input shape at parse time: garbage
    // lines yield satrec.error === 0 but propagate to null coordinates.
    // A trial propagation catches both flagged errors and silent garbage,
    // so a bad TLE fails here, at add time, with a useful message.
    if (satrec.error !== 0 || this.computeEcfPosition(satrec, new Date()) === undefined) {
      throw new Error(`Satellite '${id}': TLE could not be parsed (sgp4 error ${satrec.error}).`);
    }
    // Cesium may invoke the callback without a time, meaning "now".
    return (time: JulianDate | undefined): Cartesian3 | undefined => {
      const date = time !== undefined ? JulianDate.toDate(time) : new Date();
      return this.computeEcfPosition(satrec, date);
    };
  }

  private computeEcfPosition(
    satrec: ReturnType<typeof twoline2satrec>,
    date: Date
  ): Cartesian3 | undefined {
    // This runs inside Cesium's render loop via CallbackPositionProperty.
    // satellite.js reports most failures via null/non-finite coordinates,
    // but some degenerate inputs throw (SatRecError) — and an exception
    // here would abort every render frame, so swallow and hide instead.
    try {
      const pv = propagate(satrec, date);
      if (pv === null || typeof pv.position !== 'object' || pv.position === null) {
        return undefined;
      }
      const { x, y, z } = pv.position;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return undefined;
      }
      // satellite.js works in the inertial (ECI) frame in kilometers;
      // Cesium entity positions are earth-fixed (ECF) meters.
      const ecf = eciToEcf({ x, y, z }, gstime(date));
      return new Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000);
    } catch {
      return undefined;
    }
  }
}
