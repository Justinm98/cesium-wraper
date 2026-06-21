import {
  CallbackProperty,
  Cartesian3,
  Color,
  CylinderGraphics,
  EllipseGraphics,
  EntityCollection,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Quaternion,
} from '@cesium/engine';

import { BeamDefinition, BeamGeometry } from '../../../core/models/beam.model';
import { ColorConfig } from '../../../core/models/position.model';
import { computeBoresightFrame, Vec3 } from '../services/coverage-geometry';

/**
 * Beam entity ids extend the existing `satellite:` / `terminal:` namespacing so
 * a satellite's beams never collide and are bulk-removable per satellite.
 */
const ID_PREFIX = 'beam:';

/** Engine default beam fill color: a neutral accent cyan (FR-A-03, OQ-6). */
const DEFAULT_COLOR: ColorConfig = { r: 0, g: 200, b: 255, a: 1 };

/** Engine default fill opacity: translucent volume (FR-A-04, OQ-6). */
const DEFAULT_OPACITY = 0.3;

/**
 * Length of the rendered cone, meters. Long enough to reach the ground from
 * any LEO/MEO/GEO satellite so the volume always intersects the ellipsoid.
 * The footprint outline is drawn separately at the true ellipsoid intersection.
 */
const CONE_LENGTH = 50_000_000;

/**
 * A satellite's live ECEF position for the current tick, or `undefined` when
 * propagation has no value (e.g. before the first valid tick).
 */
export type SatellitePositionAccessor = (
  satelliteId: string,
  time: JulianDate | undefined
) => Cartesian3 | undefined;

/**
 * Owns the lifecycle of beam *visuals* for all satellites. Beams render
 * regardless of coverage (FR-A-01/09a); this manager has NO dependency on
 * coverage computation. All Cesium geometry choices are encapsulated here.
 *
 * Position and orientation are driven by Cesium callback properties evaluated
 * inside the render loop, so a beam tracks its satellite every tick (FR-A-05)
 * with zero per-frame Angular work (NFR-A-02, review H1). The beam reuses the
 * satellite's already-propagated position (no re-propagation) via the injected
 * {@link SatellitePositionAccessor}.
 */
export class BeamManager {
  /** Applied beams per satellite, keyed by beam id (diff-not-replace state). */
  private readonly bySatellite = new Map<string, Map<string, BeamDefinition>>();

  constructor(
    private readonly entities: EntityCollection,
    private readonly maxBeamsPerSatellite: number,
    private readonly getSatellitePosition: SatellitePositionAccessor
  ) {}

  /**
   * Adds, updates, or removes beams for a satellite so the rendered set matches
   * `nextBeams`, without recreating unaffected beam entities (FR-A-06). The
   * WHOLE set is validated first; if it is invalid (over-limit or bad params)
   * the call throws before touching any entity (FR-A-07/08), so a satellite is
   * never left with a partially-applied beam set.
   */
  syncBeams(satelliteId: string, nextBeams: readonly BeamDefinition[] | undefined): void {
    const next = nextBeams ?? [];
    // Zero/absent beams is a no-op, not an error (FR-A-20). Still run through
    // the diff so any previously-applied beams are removed.
    this.validateSet(satelliteId, next);

    const applied = this.bySatellite.get(satelliteId) ?? new Map<string, BeamDefinition>();
    const nextById = new Map(next.map((beam) => [beam.id, beam]));

    // Remove beams that are gone.
    for (const beamId of [...applied.keys()]) {
      if (!nextById.has(beamId)) {
        this.entities.removeById(this.entityId(satelliteId, beamId));
        applied.delete(beamId);
      }
    }
    // Add new beams and update changed ones; leave unchanged beams untouched.
    for (const beam of next) {
      const previous = applied.get(beam.id);
      if (previous === undefined) {
        this.entities.add(this.buildEntityOptions(satelliteId, beam));
        applied.set(beam.id, beam);
      } else if (previous !== beam) {
        this.entities.removeById(this.entityId(satelliteId, beam.id));
        this.entities.add(this.buildEntityOptions(satelliteId, beam));
        applied.set(beam.id, beam);
      }
    }

    if (applied.size === 0) {
      this.bySatellite.delete(satelliteId);
    } else {
      this.bySatellite.set(satelliteId, applied);
    }
  }

  /** Removes all beams for a satellite (used when the satellite is removed). */
  removeSatellite(satelliteId: string): void {
    const applied = this.bySatellite.get(satelliteId);
    if (applied === undefined) {
      return;
    }
    for (const beamId of applied.keys()) {
      this.entities.removeById(this.entityId(satelliteId, beamId));
    }
    this.bySatellite.delete(satelliteId);
  }

  /** Resolved beams for a satellite, for the coverage calculator. */
  getBeams(satelliteId: string): readonly BeamDefinition[] {
    const applied = this.bySatellite.get(satelliteId);
    return applied === undefined ? [] : [...applied.values()];
  }

  /** All satellite ids that currently have at least one beam. */
  get satelliteIds(): readonly string[] {
    return [...this.bySatellite.keys()];
  }

  private entityId(satelliteId: string, beamId: string): string {
    return `${ID_PREFIX}${satelliteId}:${beamId}`;
  }

  /**
   * Validates the whole beam set atomically (FR-A-07/08). Throws a typed,
   * id-prefixed error in the v1 validation style; renders none of the
   * satellite's beams on failure.
   */
  private validateSet(satelliteId: string, beams: readonly BeamDefinition[]): void {
    if (beams.length > this.maxBeamsPerSatellite) {
      throw new Error(
        `Satellite '${satelliteId}': ${beams.length} beams exceeds the limit ` +
          `(maxBeamsPerSatellite=${this.maxBeamsPerSatellite}); ` +
          'raise GlobeConfig.performance.maxBeamsPerSatellite if your hardware allows.'
      );
    }
    const seen = new Set<string>();
    for (const beam of beams) {
      if (seen.has(beam.id)) {
        throw new Error(`Satellite '${satelliteId}': duplicate beam id '${beam.id}'.`);
      }
      seen.add(beam.id);
      this.validateBeam(satelliteId, beam);
    }
  }

  private validateBeam(satelliteId: string, beam: BeamDefinition): void {
    const where = `Satellite '${satelliteId}' beam '${beam.id}'`;
    if (!Number.isFinite(beam.azimuth)) {
      throw new Error(`${where}: azimuth must be a finite number of degrees.`);
    }
    if (!Number.isFinite(beam.elevation)) {
      throw new Error(`${where}: elevation must be a finite number of degrees.`);
    }
    if (beam.opacity !== undefined && (beam.opacity < 0 || beam.opacity > 1)) {
      throw new Error(`${where}: opacity ${beam.opacity} is outside [0, 1].`);
    }
    this.validateGeometry(where, beam.geometry);
  }

  private validateGeometry(where: string, geometry: BeamGeometry): void {
    const inRange = (value: number): boolean => Number.isFinite(value) && value > 0 && value < 90;
    switch (geometry.kind) {
      case 'circular':
        if (!inRange(geometry.halfAngle)) {
          throw new Error(`${where}: circular halfAngle ${geometry.halfAngle} must be in (0, 90).`);
        }
        return;
      case 'elliptical':
        if (!inRange(geometry.azimuthHalfAngle)) {
          throw new Error(
            `${where}: elliptical azimuthHalfAngle ${geometry.azimuthHalfAngle} must be in (0, 90).`
          );
        }
        if (!inRange(geometry.elevationHalfAngle)) {
          throw new Error(
            `${where}: elliptical elevationHalfAngle ${geometry.elevationHalfAngle} ` +
              'must be in (0, 90).'
          );
        }
        return;
      default: {
        // Exhaustiveness guard: a new BeamGeometry member without validation is
        // a compile-time error here (FR-A-01c).
        const exhaustive: never = geometry;
        throw new Error(`Unsupported beam geometry: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * Builds the Cesium entity for one beam: a translucent solid volume that
   * tracks the satellite's position/orientation, plus a full-opacity ground
   * footprint outline (FR-A-01/03/04).
   */
  private buildEntityOptions(satelliteId: string, beam: BeamDefinition): object {
    const fill = this.resolveFill(beam);
    const outline = this.resolveColor(beam.color); // full opacity for legibility
    return {
      id: this.entityId(satelliteId, beam.id),
      // Position is the satellite's live position — reused, never re-propagated.
      position: new CallbackProperty(
        (time) => this.getSatellitePosition(satelliteId, time),
        false
      ),
      // Orientation derives from the shared boresight frame each tick.
      orientation: new CallbackProperty(
        (time) => this.computeOrientation(satelliteId, beam, time),
        false
      ),
      cylinder: this.buildVolume(beam.geometry, fill, outline),
      ellipse: this.buildFootprint(beam.geometry, outline),
    };
  }

  /**
   * Computes the beam orientation quaternion from the shared boresight frame
   * (the SAME frame the coverage test uses, so visual and computed coverage
   * cannot diverge). Returns `undefined` when the satellite has no position
   * yet, so Cesium simply skips drawing until propagation yields a value.
   */
  private computeOrientation(
    satelliteId: string,
    beam: BeamDefinition,
    time: JulianDate | undefined
  ): Quaternion | undefined {
    const position = this.getSatellitePosition(satelliteId, time);
    if (position === undefined) {
      return undefined;
    }
    const ecef: Vec3 = { x: position.x, y: position.y, z: position.z };
    const frame = computeBoresightFrame(ecef, beam.azimuth, beam.elevation);
    // Cesium cylinders extend along +Z; our boresight frame's +Z is the
    // boresight, so the column-major rotation matrix maps local axes to ECEF.
    const matrix = Matrix3.fromColumnMajorArray([
      frame.azimuthAxis.x,
      frame.azimuthAxis.y,
      frame.azimuthAxis.z,
      frame.elevationAxis.x,
      frame.elevationAxis.y,
      frame.elevationAxis.z,
      frame.boresight.x,
      frame.boresight.y,
      frame.boresight.z,
    ]);
    return Quaternion.fromRotationMatrix(matrix);
  }

  /**
   * The translucent cone volume. Both geometries render as a Cesium cylinder
   * cone (apex at the satellite); the bottom radius is sized from the
   * representative (larger) half-angle.
   *
   * v2 limitation (M1, review-v2 — user decision: footprint-only for v2): an
   * ELLIPTICAL beam's solid VOLUME renders here as a bounding SYMMETRIC cone of
   * the larger half-angle, while its FOOTPRINT outline ({@link buildFootprint})
   * and the covered-set COMPUTATION are truly elliptical. A true elliptical-cone
   * volume primitive (architecture-v2 OQ-3) is explicitly deferred past v2. This
   * is documented, not hidden: see {@link EllipticalBeamGeometry}.
   */
  private buildVolume(geometry: BeamGeometry, fill: Color, outline: Color): CylinderGraphics {
    const halfAngle = representativeHalfAngle(geometry);
    const bottomRadius = CONE_LENGTH * global.Math.tan(CesiumMath.toRadians(halfAngle));
    return new CylinderGraphics({
      length: CONE_LENGTH,
      topRadius: 0,
      bottomRadius,
      material: fill,
      outline: true,
      outlineColor: outline,
      numberOfVerticalLines: 0,
    });
  }

  /**
   * The ground footprint outline at full opacity (FR-A-04). Circular beams use
   * equal semi-axes; elliptical beams use semi-axes derived from the two
   * half-angles, so the elliptical footprint reads as an ellipse.
   */
  private buildFootprint(geometry: BeamGeometry, outline: Color): EllipseGraphics {
    const { semiMajorAxis, semiMinorAxis } = footprintAxes(geometry);
    return new EllipseGraphics({
      semiMajorAxis,
      semiMinorAxis,
      fill: false,
      outline: true,
      outlineColor: outline,
    });
  }

  private resolveFill(beam: BeamDefinition): Color {
    const opacity = beam.opacity ?? DEFAULT_OPACITY;
    const base = beam.color ?? DEFAULT_COLOR;
    return Color.fromBytes(base.r, base.g, base.b, 255).withAlpha(opacity);
  }

  private resolveColor(color: ColorConfig | undefined): Color {
    const base = color ?? DEFAULT_COLOR;
    return Color.fromBytes(base.r, base.g, base.b, 255).withAlpha(1);
  }
}

/** Half-angle used to size the rendered cone for either geometry. */
function representativeHalfAngle(geometry: BeamGeometry): number {
  switch (geometry.kind) {
    case 'circular':
      return geometry.halfAngle;
    case 'elliptical':
      // Use the larger half-angle so the volume bounds the elliptical footprint.
      return global.Math.max(geometry.azimuthHalfAngle, geometry.elevationHalfAngle);
  }
}

/**
 * Footprint semi-axes (meters) approximated from the half-angle(s) projected
 * over the cone length. Circular → equal axes; elliptical → distinct axes.
 */
function footprintAxes(geometry: BeamGeometry): {
  semiMajorAxis: number;
  semiMinorAxis: number;
} {
  const project = (deg: number): number => CONE_LENGTH * global.Math.tan(CesiumMath.toRadians(deg));
  switch (geometry.kind) {
    case 'circular': {
      const r = project(geometry.halfAngle);
      return { semiMajorAxis: r, semiMinorAxis: r };
    }
    case 'elliptical': {
      const a = project(geometry.azimuthHalfAngle);
      const b = project(geometry.elevationHalfAngle);
      return { semiMajorAxis: global.Math.max(a, b), semiMinorAxis: global.Math.min(a, b) };
    }
  }
}
