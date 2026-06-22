import { BeamGeometry } from '../../../core/models/beam.model';

/**
 * Pure geometric helpers for the covered-set computation (FR-A-09d). These
 * functions deliberately depend on NOTHING from Cesium — they operate on plain
 * `{x, y, z}` ECEF vectors (meters) and the core `BeamGeometry` model — so the
 * containment/occlusion math is unit-testable without any Cesium mock
 * (architecture-v2 §5). `CoverageCalculator` adapts Cesium positions into these
 * functions; all Cesium types stay in the calculator/managers, never here.
 *
 * Frame conventions:
 * - ECEF: earth-centered, earth-fixed, right-handed, meters (Cesium's
 *   `Cartesian3` for entity positions is in this frame).
 * - Boresight frame: a local frame at the satellite whose +Z axis is the beam
 *   boresight direction and whose X/Y axes span the plane orthogonal to it
 *   (the "azimuth" and "elevation" planes of the antenna pattern).
 */

/** A plain 3D vector in ECEF meters. Mirrors the shape of Cesium's Cartesian3. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** WGS84 semi-axes (meters); used for the ellipsoid line-of-sight test. */
const WGS84_A = 6_378_137.0;
const WGS84_B = 6_356_752.314245;

const DEG2RAD = Math.PI / 180;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Decomposes a satellite→terminal vector into the boresight frame. The three
 * orthonormal axes describe that frame: `azimuthAxis` and `elevationAxis` span
 * the plane orthogonal to the `boresight` (+Z).
 *
 * The containment test needs an EXACT, orthogonal decomposition (review-v2 H1).
 * The two prior "angular components" computed each as
 * `atan2(in-plane-projection, along-boresight)` were NOT orthogonal — both
 * divided by the same `along` term, so `θ_az² + θ_el² ≠ offAxisAngle²` except on
 * the pure axes, which made the elliptical test wrong on the diagonal and broke
 * the documented "equal half-angles collapse to circular" invariant.
 *
 * Instead we carry the direction COSINES onto each axis — `azimuthCosine =
 * dot(dir, azimuthAxis)`, `elevationCosine = dot(dir, elevationAxis)`. With
 * `dir` a unit vector these are exact projections, and the elliptical-cone
 * surface test in {@link isInsideBeam} is then mathematically exact (and
 * collapses EXACTLY to the circular case when both half-angles are equal —
 * see the proof in {@link isInsideBeam}).
 */
export interface BoresightOffsets {
  /** Angle between the vector and the boresight, radians (always ≥ 0). */
  offAxisAngle: number;
  /** Direction cosine onto the azimuth axis, `dot(dir, azimuthAxis)`, in [-1, 1]. */
  azimuthCosine: number;
  /** Direction cosine onto the elevation axis, `dot(dir, elevationAxis)`, in [-1, 1]. */
  elevationCosine: number;
  /** Straight-line distance from satellite to terminal, meters. */
  range: number;
}

/**
 * Projects `toTerminal` (satellite→terminal, ECEF meters) onto the boresight
 * frame. The frame axes must be orthonormal; `boresight` is +Z. Returns the
 * off-boresight angle plus the direction cosines onto the azimuth/elevation
 * axes (exact projections of the unit direction; see {@link BoresightOffsets}).
 */
export function computeBoresightOffsets(
  toTerminal: Vec3,
  boresight: Vec3,
  azimuthAxis: Vec3,
  elevationAxis: Vec3
): BoresightOffsets {
  const range = length(toTerminal);
  const dir = normalize(toTerminal);
  // Clamp guards against tiny floating-point excursions outside [-1, 1].
  const cos = Math.min(1, Math.max(-1, dot(dir, boresight)));
  const offAxisAngle = Math.acos(cos);
  const azimuthCosine = dot(dir, azimuthAxis);
  const elevationCosine = dot(dir, elevationAxis);
  return { offAxisAngle, azimuthCosine, elevationCosine, range };
}

/**
 * 3D containment test for the configured geometry (FR-A-09d step 1). Returns
 * true iff the terminal lies inside the beam volume.
 *
 * - Circular: the off-boresight angle is within the half-angle.
 * - Elliptical: an EXACT elliptical-cone surface test in the boresight frame.
 *   With `a = dot(dir, azimuthAxis)` and `e = dot(dir, elevationAxis)` the
 *   direction cosines of the unit satellite→terminal vector, the terminal is
 *   inside the elliptical cone iff
 *   `(a / sin(az))² + (e / sin(el))² ≤ 1`,
 *   where `az`/`el` are the azimuth/elevation half-angles. This is the cone's
 *   intersection with the unit sphere expressed in direction-cosine space.
 *
 *   Why this is exact AND collapses to circular (review-v2 H1): for an equal
 *   ellipse `(h, h)` the test becomes `(a² + e²) / sin(h)² ≤ 1`. Because
 *   `a² + e² = sin(offAxisAngle)²` for a unit vector, this is exactly
 *   `sin(offAxisAngle) ≤ sin(h)`, i.e. `offAxisAngle ≤ h` in the forward
 *   hemisphere — identical to the circular test. The previous independent
 *   `atan2` decomposition did not have this property and wrongly excluded
 *   off-axis rim points.
 *
 * A terminal behind the satellite (off-axis angle ≥ 90°) is never contained,
 * so a wide beam cannot wrap around the back lobe.
 */
export function isInsideBeam(offsets: BoresightOffsets, geometry: BeamGeometry): boolean {
  if (offsets.offAxisAngle >= Math.PI / 2) {
    return false; // Behind the boresight plane — outside any forward beam.
  }
  switch (geometry.kind) {
    case 'circular':
      return offsets.offAxisAngle <= geometry.halfAngle * DEG2RAD;
    case 'elliptical': {
      const sinAz = Math.sin(geometry.azimuthHalfAngle * DEG2RAD);
      const sinEl = Math.sin(geometry.elevationHalfAngle * DEG2RAD);
      const az = offsets.azimuthCosine / sinAz;
      const el = offsets.elevationCosine / sinEl;
      return az * az + el * el <= 1;
    }
  }
}

/**
 * Earth-occlusion / line-of-sight test (FR-A-09d step 2). Returns true iff the
 * terminal has line-of-sight to the satellite — i.e. the segment between them
 * is NOT blocked by the WGS84 ellipsoid. A terminal beyond the limb / below
 * the local horizon is occluded and therefore not covered.
 *
 * Method: scale ECEF into the unit-sphere space where the ellipsoid becomes a
 * unit sphere, then test whether the closest point of the (satellite→terminal)
 * segment to the origin lies inside the unit sphere. If the nearest approach is
 * within the sphere AND falls strictly between the endpoints, the segment dips
 * below the surface and the terminal is occluded.
 */
export function hasLineOfSight(satellite: Vec3, terminal: Vec3): boolean {
  const s = toUnitSphere(satellite);
  const t = toUnitSphere(terminal);
  const d = sub(t, s);
  const dLenSq = dot(d, d);
  if (dLenSq === 0) {
    return true; // Degenerate: coincident points.
  }
  // Parameter of the closest point on the segment to the origin.
  const u = -dot(s, d) / dLenSq;
  if (u <= 0 || u >= 1) {
    // Closest approach is at an endpoint; the segment does not pass "behind"
    // the body between them, so line-of-sight is clear.
    return true;
  }
  const closest: Vec3 = { x: s.x + u * d.x, y: s.y + u * d.y, z: s.z + u * d.z };
  // Inside the unit sphere (radius 1) ⇒ the segment crosses below the surface.
  return dot(closest, closest) >= 1;
}

function toUnitSphere(v: Vec3): Vec3 {
  return { x: v.x / WGS84_A, y: v.y / WGS84_A, z: v.z / WGS84_B };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * The three orthonormal ECEF axes of a beam's boresight frame. +Z is the
 * boresight direction; the azimuth/elevation axes span the orthogonal plane.
 * Both the renderer ({@link BeamManager}) and the covered-test
 * ({@link computeBoresightOffsets}) consume the SAME frame, so the visible
 * volume and the computed coverage cannot diverge (architecture-v2 §3.2.B).
 */
export interface BoresightFrame {
  boresight: Vec3;
  azimuthAxis: Vec3;
  elevationAxis: Vec3;
}

/**
 * Builds the beam boresight frame in ECEF from the satellite's ECEF position
 * and the beam's `azimuth`/`elevation` (degrees). The local East-North-Up
 * frame at the satellite is derived from the spherical position, then the
 * boresight is rotated by azimuth (clockwise from north) and elevation (above
 * the local horizontal), with the convention that elevation 90° points
 * straight down (nadir), matching "elevation above the satellite's local
 * horizontal" pointing groundward.
 *
 * Pure — no Cesium. Operates on plain vectors so it is unit-testable and is the
 * single source of truth for beam orientation shared by renderer and coverage.
 */
export function computeBoresightFrame(
  satelliteEcef: Vec3,
  azimuthDeg: number,
  elevationDeg: number
): BoresightFrame {
  // Local ENU at the satellite. Up is the outward radial; East is the
  // direction of increasing longitude in the equatorial plane; North completes
  // the right-handed set.
  const up = normalize(satelliteEcef);
  // Guard the poles where East is undefined: fall back to a fixed East.
  const eastRaw = cross({ x: 0, y: 0, z: 1 }, up);
  const east = length(eastRaw) < 1e-9 ? { x: 1, y: 0, z: 0 } : normalize(eastRaw);
  const north = normalize(cross(up, east));

  const az = azimuthDeg * DEG2RAD;
  const el = elevationDeg * DEG2RAD;
  // Horizontal heading direction (clockwise from north): north·cos + east·sin.
  const heading = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
  // Elevation tilts from the horizontal toward nadir (-up). At elevation 0 the
  // boresight lies in the horizontal plane; at 90° it points straight down.
  const boresight = normalize(
    add(scale(heading, Math.cos(el)), scale(up, -Math.sin(el)))
  );
  // Azimuth axis: in the horizontal plane, 90° clockwise from heading.
  const azimuthAxis = normalize(cross(boresight, up));
  // Elevation axis completes the orthonormal right-handed frame.
  const elevationAxis = normalize(cross(boresight, azimuthAxis));
  return { boresight, azimuthAxis, elevationAxis };
}

/**
 * Column-major 4x4 model matrix that places a UNIT cone — a Cesium
 * `CylinderGeometry` with `length: 1`, `topRadius: 1`, `bottomRadius: 0` (apex at
 * local z = −0.5, circular base of radius 1 at z = +0.5) — so that:
 *  - the apex sits at the satellite (`satelliteEcef`),
 *  - the cone opens along the beam boresight (toward the ground),
 *  - the base cross-section is an ellipse with semi-axes `azimuthRadius` (along
 *    the azimuth axis) and `elevationRadius` (along the elevation axis),
 *  - the cone spans `length` metres from apex to base.
 *
 * Rendering the cone as a `Primitive` with this matrix keeps its geometry in
 * OBJECT space (only the matrix is applied, on the GPU), so — unlike an entity
 * `CylinderGraphics` sized in world space — Cesium never runs the world-space
 * longitude split that throws for a globe-spanning beam (review-v2 M1/M2).
 *
 * Non-uniform `azimuthRadius` vs `elevationRadius` yields a true elliptical cone
 * (FR-A-01b); equal radii collapse to a circular cone (FR-A-01a). The frame is
 * right-handed (azimuthAxis × elevationAxis = boresight), so the matrix has a
 * positive determinant — no inverted winding. Pure — no Cesium.
 */
export function computeConeModelMatrix(
  satelliteEcef: Vec3,
  frame: BoresightFrame,
  azimuthRadius: number,
  elevationRadius: number,
  length: number
): number[] {
  const col0 = scale(frame.azimuthAxis, azimuthRadius);
  const col1 = scale(frame.elevationAxis, elevationRadius);
  const col2 = scale(frame.boresight, length);
  // Apex (local z = −0.5) maps to the satellite ⇒ T = sat + boresight·(length/2).
  const t = add(satelliteEcef, scale(frame.boresight, length * 0.5));
  // prettier-ignore
  return [
    col0.x, col0.y, col0.z, 0,
    col1.x, col1.y, col1.z, 0,
    col2.x, col2.y, col2.z, 0,
    t.x,    t.y,    t.z,    1,
  ];
}
