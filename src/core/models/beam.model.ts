import { ColorConfig } from './position.model';

/**
 * Right circular cone geometry: a single half-angle about the boresight
 * (FR-A-01a). Use this when the antenna pattern is radially symmetric.
 */
export interface CircularBeamGeometry {
  /** Discriminator selecting the circular-cone geometry. */
  readonly kind: 'circular';
  /**
   * Half the total beamwidth, in degrees. Must be in the open interval
   * (0, 90); validated at add/update time (FR-A-08).
   */
  halfAngle: number;
}

/**
 * Elliptical cone geometry: independent azimuth/elevation beamwidths
 * (FR-A-01b). Both values are HALF-angles, kept dimensionally consistent with
 * {@link CircularBeamGeometry.halfAngle} so that an elliptical beam whose two
 * half-angles are equal collapses to the circular case.
 *
 * v2 rendering note (M1, review-v2 — user decision: footprint-only for v2):
 * the FOOTPRINT outline and the COVERAGE COMPUTATION are TRULY elliptical (the
 * ground ellipse uses the two distinct half-angles, and the covered test is an
 * exact elliptical-cone surface test — see {@link ../engines/cesium/services/coverage-geometry}).
 * The solid translucent VOLUME, however, renders in v2 as a bounding
 * radially-symmetric cone sized by the LARGER half-angle, not a true elliptical
 * cone. A true elliptical-cone volume primitive is explicitly deferred past v2
 * (architecture-v2 OQ-3); this is a documented limitation, not hidden magic.
 */
export interface EllipticalBeamGeometry {
  /** Discriminator selecting the elliptical-cone geometry. */
  readonly kind: 'elliptical';
  /**
   * Half-beamwidth in the azimuth plane, in degrees. Must be in (0, 90);
   * validated at add/update time (FR-A-08).
   */
  azimuthHalfAngle: number;
  /**
   * Half-beamwidth in the elevation plane, in degrees. Must be in (0, 90);
   * validated at add/update time (FR-A-08).
   */
  elevationHalfAngle: number;
}

/**
 * Discriminated union of beam geometries (FR-A-01c). New geometries (e.g.
 * `'rectangular'`, `'shaped'`) are added as NEW members carrying their own
 * `kind`; existing `'circular'`/`'elliptical'` configurations keep compiling
 * and rendering unchanged (open/closed principle). Consumers of the union
 * switch exhaustively on `kind`, so `tsc` flags any unhandled member — adding
 * a geometry is a compile-time checklist, not a silent gap.
 */
export type BeamGeometry = CircularBeamGeometry | EllipticalBeamGeometry;

/**
 * A single antenna beam projected from a satellite toward the ground,
 * rendered as a translucent solid volume of the configured geometry plus its
 * ground-footprint outline. The footprint is the volume's intersection with
 * the ellipsoid.
 */
export interface BeamDefinition {
  /** Unique beam id within its parent satellite. */
  id: string;
  /** Boresight azimuth in degrees, clockwise from north. */
  azimuth: number;
  /** Boresight elevation in degrees above the satellite's local horizontal. */
  elevation: number;
  /**
   * Beam volume geometry (FR-A-01a/01b/01c). REQUIRED — every beam must
   * declare its geometry; there is no legacy `halfAngle` fallback (clean
   * break, architecture-v2 OQ-1). A missing geometry is a compile-time error;
   * an invalid one is rejected at add/update time (FR-A-08).
   */
  geometry: BeamGeometry;
  /**
   * Cone/footprint color. Engine default cyan applies when omitted (FR-A-03).
   *
   * Note (L2, review-v2): the cone FILL alpha comes from {@link opacity}
   * (default 0.3), NOT from `color.a`. The `a` channel of this color is ignored
   * for the volume fill; use {@link opacity} to control fill translucency. The
   * footprint and outline render at full opacity regardless.
   */
  color?: ColorConfig;
  /** Cone fill opacity, 0-1. Engine default 0.3 applies when omitted (FR-A-04). */
  opacity?: number;
}
