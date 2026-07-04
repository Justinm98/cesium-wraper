import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CylinderGeometry,
  EllipseGraphics,
  EntityCollection,
  GeometryInstance,
  JulianDate,
  Math as CesiumMath,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  Scene,
} from '@cesium/engine';

import { BeamDefinition, BeamGeometry } from '../../../core/models/beam.model';
import { ColorConfig } from '../../../core/models/position.model';
import {
  computeBoresightFrame,
  computeConeModelMatrix,
  groundFootprintRadius,
  Vec3,
} from '../services/coverage-geometry';

/**
 * Beam entity ids extend the existing `satellite:` / `terminal:` namespacing so
 * a satellite's footprints never collide and are bulk-removable per satellite.
 */
const ID_PREFIX = 'beam:';

/** Engine default beam fill color: a neutral accent cyan (FR-A-03, OQ-6). */
const DEFAULT_COLOR: ColorConfig = { r: 0, g: 200, b: 255, a: 1 };

/** Engine default fill opacity: translucent volume (FR-A-04, OQ-6). */
const DEFAULT_OPACITY = 0.3;

/**
 * Length of the rendered cone, meters. Long enough to reach the ground from any
 * LEO/MEO/GEO satellite so the volume always spans the ellipsoid. The footprint
 * outline is drawn separately at the (approximate) ellipsoid intersection.
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

/** A beam's applied definition plus the scene primitive rendering its volume. */
interface AppliedBeam {
  def: BeamDefinition;
  volume: Primitive;
}

/**
 * Owns the lifecycle of beam *visuals* for all satellites. Beams render
 * regardless of coverage (FR-A-01/09a); this manager has NO dependency on
 * coverage computation. All Cesium geometry choices are encapsulated here.
 *
 * Each beam has two pieces:
 * - **Footprint outline** — an entity `EllipseGraphics` on the ground, always
 *   shown when the beam is configured. Its position follows the satellite via a
 *   render-loop `CallbackProperty` (FR-A-05), so no per-frame Angular work.
 * - **Solid volume** — a translucent cone rendered as a scene `Primitive` whose
 *   geometry is a UNIT cone in object space, placed/scaled each frame by the
 *   primitive's `modelMatrix` (a non-uniform scale ⇒ a true elliptical cone for
 *   elliptical beams, FR-A-01b). Object-space geometry is NOT split in world
 *   coordinates, so a globe-spanning beam does not trip Cesium's longitude split
 *   the way a world-space entity cone does (review-v2 M1/M2). The volume is
 *   hidden by default and toggled per FR-A-01d.
 *
 * The per-frame `modelMatrix`/visibility update runs inside Cesium's render loop
 * via `scene.preRender` — outside the Angular zone (NFR-A-02, review H1).
 */
export class BeamManager {
  /** Applied beams per satellite, keyed by beam id (diff-not-replace state). */
  private readonly bySatellite = new Map<string, Map<string, AppliedBeam>>();

  /**
   * Global default for solid-volume visibility (FR-A-01d). Default OFF: a
   * configured beam shows only its footprint outline until volumes are enabled.
   * Read live by the per-frame update, so toggling needs no entity rebuild.
   */
  private globalVolumesVisible = false;

  /** Removes the per-frame `scene.preRender` listener on {@link destroy}. */
  private readonly stopPreRender: () => void;

  constructor(
    private readonly entities: EntityCollection,
    private readonly scene: Scene,
    private readonly maxBeamsPerSatellite: number,
    private readonly getSatellitePosition: SatellitePositionAccessor
  ) {
    // One render-loop hook drives every beam volume's position/orientation and
    // visibility each frame (FR-A-05/01d). Runs inside Cesium's loop, never the
    // Angular zone.
    this.stopPreRender = this.scene.preRender.addEventListener((_scene, time) =>
      this.updateVolumes(time)
    );
  }

  /**
   * Adds, updates, or removes beams for a satellite so the rendered set matches
   * `nextBeams`, without recreating unaffected beams (FR-A-06). The WHOLE set is
   * validated first; if it is invalid (over-limit or bad params) the call throws
   * before touching any entity/primitive (FR-A-07/08), so a satellite is never
   * left with a partially-applied beam set.
   */
  syncBeams(satelliteId: string, nextBeams: readonly BeamDefinition[] | undefined): void {
    const next = nextBeams ?? [];
    // Zero/absent beams is a no-op, not an error (FR-A-20). Still run the diff so
    // any previously-applied beams are removed.
    this.validateSet(satelliteId, next);

    const applied = this.bySatellite.get(satelliteId) ?? new Map<string, AppliedBeam>();
    const nextById = new Map(next.map((beam) => [beam.id, beam]));

    // Remove beams that are gone.
    for (const [beamId, beam] of [...applied]) {
      if (!nextById.has(beamId)) {
        this.removeBeam(satelliteId, beam);
        applied.delete(beamId);
      }
    }
    // Add new beams and update changed ones; leave unchanged beams untouched.
    for (const beam of next) {
      const previous = applied.get(beam.id);
      if (previous === undefined) {
        applied.set(beam.id, this.addBeam(satelliteId, beam));
      } else if (previous.def !== beam) {
        this.removeBeam(satelliteId, previous);
        applied.set(beam.id, this.addBeam(satelliteId, beam));
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
    for (const beam of applied.values()) {
      this.removeBeam(satelliteId, beam);
    }
    this.bySatellite.delete(satelliteId);
  }

  /**
   * Sets the GLOBAL solid-volume visibility (FR-A-01d). Per-beam `showVolume`
   * overrides this for individual beams. No rebuild: the next render frame reads
   * the effective visibility and shows/hides each volume — zero Angular work.
   */
  setVolumesVisible(visible: boolean): void {
    this.globalVolumesVisible = visible;
  }

  /** Resolved beams for a satellite, for the coverage calculator. */
  getBeams(satelliteId: string): readonly BeamDefinition[] {
    const applied = this.bySatellite.get(satelliteId);
    return applied === undefined ? [] : [...applied.values()].map((beam) => beam.def);
  }

  /** All satellite ids that currently have at least one beam. */
  get satelliteIds(): readonly string[] {
    return [...this.bySatellite.keys()];
  }

  /**
   * Tears down the render-loop hook and removes every beam volume primitive.
   * Called by the engine on destroy so no per-frame update survives teardown.
   */
  destroy(): void {
    this.stopPreRender();
    for (const [satelliteId, applied] of this.bySatellite) {
      for (const beam of applied.values()) {
        this.removeBeam(satelliteId, beam);
      }
    }
    this.bySatellite.clear();
  }

  private addBeam(satelliteId: string, beam: BeamDefinition): AppliedBeam {
    this.entities.add(this.buildFootprintEntity(satelliteId, beam));
    const volume = this.buildVolumePrimitive(beam);
    this.scene.primitives.add(volume);
    return { def: beam, volume };
  }

  private removeBeam(satelliteId: string, beam: AppliedBeam): void {
    this.entities.removeById(this.entityId(satelliteId, beam.def.id));
    this.scene.primitives.remove(beam.volume);
  }

  private entityId(satelliteId: string, beamId: string): string {
    return `${ID_PREFIX}${satelliteId}:${beamId}`;
  }

  /**
   * Effective solid-volume visibility for one beam (FR-A-01d precedence): the
   * per-beam `showVolume`, when defined, overrides the global; otherwise the
   * beam inherits the global `setVolumesVisible` state. Explicit per-beam wins.
   */
  private effectiveVolumeVisible(beam: BeamDefinition): boolean {
    return beam.showVolume ?? this.globalVolumesVisible;
  }

  /**
   * Per-frame update of every beam volume (FR-A-05/01d), invoked from
   * `scene.preRender`. Re-points each primitive's `modelMatrix` from the
   * satellite's current position and the beam's boresight frame, and applies the
   * effective volume visibility. A beam with no current position is hidden until
   * propagation yields one (so a beam never renders detached from its satellite).
   */
  private updateVolumes(time: JulianDate | undefined): void {
    for (const [satelliteId, applied] of this.bySatellite) {
      const position = this.getSatellitePosition(satelliteId, time);
      for (const beam of applied.values()) {
        if (position === undefined || !this.effectiveVolumeVisible(beam.def)) {
          beam.volume.show = false;
          continue;
        }
        const ecef = { x: position.x, y: position.y, z: position.z };
        const frame = computeBoresightFrame(ecef, beam.def.azimuth, beam.def.elevation);
        const { azimuthRadius, elevationRadius } = coneRadii(beam.def.geometry);
        const matrix = computeConeModelMatrix(ecef, frame, azimuthRadius, elevationRadius, CONE_LENGTH);
        beam.volume.modelMatrix = Matrix4.fromColumnMajorArray(matrix);
        beam.volume.show = true;
      }
    }
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
   * The ground footprint outline entity (full opacity, FR-A-04). Both its
   * position AND its semi-axes track the satellite via render-loop callbacks
   * (FR-A-05): the axes are sized from the satellite's LIVE altitude each frame
   * ({@link footprintAxes} → {@link groundFootprintRadius}), not a fixed cone
   * length, so the footprint stays a correctly-sized ground spot as the satellite
   * moves and never balloons to an un-triangulable Earth-sized ellipse. Circular
   * beams yield equal semi-axes; elliptical beams yield distinct semi-axes (the
   * larger half-angle always maps to the major axis, as Cesium requires
   * semiMajorAxis ≥ semiMinorAxis).
   */
  private buildFootprintEntity(satelliteId: string, beam: BeamDefinition): object {
    const outline = this.resolveColor(beam.color); // full opacity for legibility
    // One live property per axis. With no current position the entity has no
    // position either, so Cesium skips it and these are not evaluated; 0 is a safe
    // inert fallback for that frame.
    const semiAxis = (pick: (axes: FootprintAxes) => number): CallbackProperty =>
      new CallbackProperty((time) => {
        const position = this.getSatellitePosition(satelliteId, time);
        return position === undefined
          ? 0
          : pick(footprintAxes(beam.geometry, { x: position.x, y: position.y, z: position.z }));
      }, false);
    return {
      id: this.entityId(satelliteId, beam.id),
      position: new CallbackProperty(
        (time) => this.getSatellitePosition(satelliteId, time),
        false
      ),
      ellipse: new EllipseGraphics({
        semiMajorAxis: semiAxis((axes) => axes.semiMajorAxis),
        semiMinorAxis: semiAxis((axes) => axes.semiMinorAxis),
        fill: false,
        outline: true,
        outlineColor: outline,
      }),
    };
  }

  /**
   * The translucent solid-volume primitive: a UNIT cone (apex at the origin,
   * opening along +Z) carried in OBJECT space, placed/scaled each frame by the
   * primitive's `modelMatrix` ({@link updateVolumes}). A non-uniform scale yields
   * a true elliptical cone for elliptical beams (FR-A-01b); equal radii give a
   * circular cone (FR-A-01a). Hidden until the first frame sets its matrix and
   * the effective visibility (FR-A-01d default OFF).
   */
  private buildVolumePrimitive(beam: BeamDefinition): Primitive {
    return new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new CylinderGeometry({
          length: 1,
          topRadius: 1, // base (radius 1) at +Z
          bottomRadius: 0, // apex (radius 0) at -Z
          slices: 32,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(this.resolveFill(beam)),
        },
      }),
      appearance: new PerInstanceColorAppearance({ translucent: true, flat: true, closed: false }),
      asynchronous: false,
      show: false,
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

/** Cone base semi-axes (meters) for either geometry, sized over the cone length. */
function coneRadii(geometry: BeamGeometry): { azimuthRadius: number; elevationRadius: number } {
  const project = (deg: number): number => CONE_LENGTH * Math.tan(CesiumMath.toRadians(deg));
  switch (geometry.kind) {
    case 'circular': {
      const r = project(geometry.halfAngle);
      return { azimuthRadius: r, elevationRadius: r };
    }
    case 'elliptical':
      return {
        azimuthRadius: project(geometry.azimuthHalfAngle),
        elevationRadius: project(geometry.elevationHalfAngle),
      };
  }
}

/** Footprint ellipse semi-axes (meters); `semiMajorAxis ≥ semiMinorAxis`. */
interface FootprintAxes {
  semiMajorAxis: number;
  semiMinorAxis: number;
}

/**
 * Footprint semi-axes (meters) for the beam's ground spot, sized from the
 * satellite's actual altitude at `satelliteEcef` ({@link groundFootprintRadius}).
 * Circular → equal axes; elliptical → distinct axes. Because the ground radius is
 * monotonic in the half-angle, the larger half-angle is always the major axis, so
 * `semiMajorAxis ≥ semiMinorAxis` (Cesium's `EllipseGeometry` requirement) holds.
 */
function footprintAxes(geometry: BeamGeometry, satelliteEcef: Vec3): FootprintAxes {
  switch (geometry.kind) {
    case 'circular': {
      const r = groundFootprintRadius(satelliteEcef, geometry.halfAngle);
      return { semiMajorAxis: r, semiMinorAxis: r };
    }
    case 'elliptical': {
      const a = groundFootprintRadius(satelliteEcef, geometry.azimuthHalfAngle);
      const b = groundFootprintRadius(satelliteEcef, geometry.elevationHalfAngle);
      return { semiMajorAxis: Math.max(a, b), semiMinorAxis: Math.min(a, b) };
    }
  }
}
