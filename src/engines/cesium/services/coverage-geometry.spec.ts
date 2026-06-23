import { BeamGeometry } from '../../../core/models/beam.model';
import {
  BoresightFrame,
  computeBoresightFrame,
  computeBoresightOffsets,
  computeConeModelMatrix,
  groundFootprintRadius,
  hasLineOfSight,
  isInsideBeam,
  Vec3,
} from './coverage-geometry';

// A nadir-pointing satellite directly above the equator/prime-meridian point.
// Earth radius ~6.378e6 m; sat at 7.0e6 m so boresight points down (-X).
const SAT: Vec3 = { x: 7_000_000, y: 0, z: 0 };
const BORESIGHT: Vec3 = { x: -1, y: 0, z: 0 }; // straight down toward Earth
// Azimuth axis along +Y, elevation axis along +Z (an orthonormal frame).
const AZ_AXIS: Vec3 = { x: 0, y: 1, z: 0 };
const EL_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

const circular = (halfAngle: number): BeamGeometry => ({ kind: 'circular', halfAngle });
const elliptical = (azimuthHalfAngle: number, elevationHalfAngle: number): BeamGeometry => ({
  kind: 'elliptical',
  azimuthHalfAngle,
  elevationHalfAngle,
});

describe('coverage-geometry', () => {
  describe('computeConeModelMatrix', () => {
    // A simple right-handed frame (azimuthAxis × elevationAxis = boresight).
    const frame: BoresightFrame = {
      azimuthAxis: { x: 1, y: 0, z: 0 },
      elevationAxis: { x: 0, y: 1, z: 0 },
      boresight: { x: 0, y: 0, z: 1 },
    };
    const sat: Vec3 = { x: 0, y: 0, z: 1000 };

    // Apply a column-major 4x4 to a local point (x, y, z, 1).
    const apply = (m: number[], x: number, y: number, z: number): Vec3 => ({
      x: m[0] * x + m[4] * y + m[8] * z + m[12],
      y: m[1] * x + m[5] * y + m[9] * z + m[13],
      z: m[2] * x + m[6] * y + m[10] * z + m[14],
    });

    it('places the unit-cone apex (local z = -0.5) at the satellite', () => {
      const m = computeConeModelMatrix(sat, frame, 2, 3, 10);
      const apex = apply(m, 0, 0, -0.5);
      expect(apex.x).toBeCloseTo(0, 6);
      expect(apex.y).toBeCloseTo(0, 6);
      expect(apex.z).toBeCloseTo(1000, 6);
    });

    it('opens the cone along the boresight: base center at sat + boresight*length', () => {
      const m = computeConeModelMatrix(sat, frame, 2, 3, 10);
      const base = apply(m, 0, 0, 0.5);
      expect(base.z).toBeCloseTo(1010, 6); // 1000 + 10 along +z boresight
    });

    it('scales the base into an ellipse: azimuthRadius on x, elevationRadius on y', () => {
      const m = computeConeModelMatrix(sat, frame, 2, 3, 10);
      const rimX = apply(m, 1, 0, 0.5);
      const rimY = apply(m, 0, 1, 0.5);
      expect(rimX.x).toBeCloseTo(2, 6); // azimuthRadius
      expect(rimY.y).toBeCloseTo(3, 6); // elevationRadius (distinct ⇒ elliptical)
    });

    it('collapses to a circular base when the radii are equal', () => {
      const m = computeConeModelMatrix(sat, frame, 5, 5, 10);
      expect(apply(m, 1, 0, 0.5).x).toBeCloseTo(5, 6);
      expect(apply(m, 0, 1, 0.5).y).toBeCloseTo(5, 6);
    });
  });

  describe('computeBoresightOffsets', () => {
    it('reports zero off-axis angle for a terminal on the boresight', () => {
      // Terminal directly below the satellite on the surface.
      const terminal: Vec3 = { x: 6_378_137, y: 0, z: 0 };
      const offsets = computeBoresightOffsets(
        { x: terminal.x - SAT.x, y: 0, z: 0 },
        BORESIGHT,
        AZ_AXIS,
        EL_AXIS
      );
      expect(offsets.offAxisAngle).toBeCloseTo(0, 6);
      expect(offsets.azimuthCosine).toBeCloseTo(0, 6);
      expect(offsets.elevationCosine).toBeCloseTo(0, 6);
      expect(offsets.range).toBeCloseTo(SAT.x - terminal.x, 3);
    });

    it('separates azimuth and elevation components in their respective planes', () => {
      // Offset purely in +Y (azimuth plane): boresight -X, so the vector is
      // (-down, +y). Expect a positive azimuth direction cosine, ~zero elevation.
      const toTerminal: Vec3 = { x: -1_000_000, y: 500_000, z: 0 };
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(offsets.azimuthCosine).toBeGreaterThan(0);
      expect(offsets.elevationCosine).toBeCloseTo(0, 6);
    });
  });

  describe('isInsideBeam — circular', () => {
    it('includes a terminal within the half-angle', () => {
      // ~4 degrees off-axis.
      const toTerminal: Vec3 = { x: -1_000_000, y: 70_000, z: 0 };
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(offsets, circular(10))).toBe(true);
    });

    it('excludes a terminal outside the half-angle', () => {
      const toTerminal: Vec3 = { x: -1_000_000, y: 700_000, z: 0 }; // ~35 deg
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(offsets, circular(10))).toBe(false);
    });

    it('excludes a terminal behind the boresight plane', () => {
      const toTerminal: Vec3 = { x: 1_000_000, y: 0, z: 0 }; // points up, away
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(offsets, circular(89))).toBe(false);
    });
  });

  describe('isInsideBeam — elliptical', () => {
    it('includes a terminal inside the elliptical cone', () => {
      // ~5 deg in azimuth, ~0 in elevation; wide azimuth beam covers it.
      const toTerminal: Vec3 = { x: -1_000_000, y: 90_000, z: 0 };
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(offsets, elliptical(20, 5))).toBe(true);
    });

    it('excludes a terminal outside the narrow elevation axis', () => {
      // ~10 deg in elevation; the narrow (5 deg) elevation beam rejects it.
      const toTerminal: Vec3 = { x: -1_000_000, y: 0, z: 176_000 };
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(offsets, elliptical(20, 5))).toBe(false);
    });

    it('matches the circular case when both half-angles are equal', () => {
      const toTerminal: Vec3 = { x: -1_000_000, y: 120_000, z: 120_000 };
      const offsets = computeBoresightOffsets(toTerminal, BORESIGHT, AZ_AXIS, EL_AXIS);
      // Combined off-axis is ~9.7 deg; a 12 deg symmetric ellipse includes it,
      // a 12 deg circle includes it too.
      expect(isInsideBeam(offsets, elliptical(12, 12))).toBe(isInsideBeam(offsets, circular(12)));
    });

    // review-v2 H1 guard: the bug lived in the OFF-axis (diagonal) rim, where the
    // old independent-atan2 decomposition made an equal (h,h) ellipse disagree
    // with circular(h). Sweep a cone of directions at every azimuth phi (not just
    // the principal planes) and assert exact agreement. `dir` is built directly in
    // the boresight frame: z = boresight component, x = azimuth, y = elevation.
    const dirToTerminal = (offAxisDeg: number, phiDeg: number): Vec3 => {
      const off = offAxisDeg * (Math.PI / 180);
      const phi = phiDeg * (Math.PI / 180);
      // BORESIGHT=-X, AZ=+Y, EL=+Z: map frame (x_b,y_b,z_b)->ECEF offset vector.
      const xB = Math.sin(off) * Math.cos(phi); // along azimuth axis
      const yB = Math.sin(off) * Math.sin(phi); // along elevation axis
      const zB = Math.cos(off); // along boresight
      // Scale by an arbitrary range so the function also normalizes.
      const R = 1_000_000;
      return {
        x: R * (zB * BORESIGHT.x), // boresight is -X
        y: R * (xB * AZ_AXIS.y), // azimuth is +Y
        z: R * (yB * EL_AXIS.z), // elevation is +Z
      };
    };

    it('agrees with circular(h) across the full swept rim for an equal (h,h) ellipse', () => {
      // The decisive test (review-v2 H1): if any phi between the principal planes
      // disagreed, the old decomposition would fail here at the 45° diagonal.
      for (const h of [5, 12, 30, 60]) {
        for (let offset = 0; offset <= h + 2; offset += 0.5) {
          for (let phi = 0; phi < 360; phi += 5) {
            const offsets = computeBoresightOffsets(
              dirToTerminal(offset, phi),
              BORESIGHT,
              AZ_AXIS,
              EL_AXIS
            );
            // Avoid asserting on the knife-edge of the boundary (float ties).
            if (Math.abs(offset - h) < 1e-3) {
              continue;
            }
            expect(isInsideBeam(offsets, elliptical(h, h))).toBe(
              isInsideBeam(offsets, circular(h))
            );
          }
        }
      }
    });

    it('includes/excludes the correct diagonal points for a genuinely elliptical beam', () => {
      // Elliptical (20 az, 5 el). At phi=45° an off-axis direction splits its
      // angle between the wide and narrow axes. A point whose elevation component
      // exceeds the 5° narrow half-angle must be excluded even though it is well
      // within the 20° azimuth half-angle.
      const geom = elliptical(20, 5);
      // 7° off-axis at 45°: elevation component ~5° (just over the narrow edge).
      const justOutside = computeBoresightOffsets(
        dirToTerminal(7.5, 45),
        BORESIGHT,
        AZ_AXIS,
        EL_AXIS
      );
      expect(isInsideBeam(justOutside, geom)).toBe(false);
      // 4° off-axis at 45°: both components small enough to sit inside the cone.
      const inside = computeBoresightOffsets(dirToTerminal(4, 45), BORESIGHT, AZ_AXIS, EL_AXIS);
      expect(isInsideBeam(inside, geom)).toBe(true);
      // On the pure (wide) azimuth axis, 18° is still inside the 20° half-angle.
      const onWideAxis = computeBoresightOffsets(
        dirToTerminal(18, 0),
        BORESIGHT,
        AZ_AXIS,
        EL_AXIS
      );
      expect(isInsideBeam(onWideAxis, geom)).toBe(true);
    });
  });

  describe('computeBoresightFrame', () => {
    it('points the boresight to nadir at elevation 90', () => {
      const frame = computeBoresightFrame(SAT, 0, 90);
      // Satellite over +X; nadir boresight points -X.
      expect(frame.boresight.x).toBeCloseTo(-1, 6);
      expect(frame.boresight.y).toBeCloseTo(0, 6);
      expect(frame.boresight.z).toBeCloseTo(0, 6);
    });

    it('produces an orthonormal right-handed frame', () => {
      const { boresight, azimuthAxis, elevationAxis } = computeBoresightFrame(SAT, 35, 60);
      const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
      const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
      expect(len(boresight)).toBeCloseTo(1, 6);
      expect(len(azimuthAxis)).toBeCloseTo(1, 6);
      expect(len(elevationAxis)).toBeCloseTo(1, 6);
      expect(dot(boresight, azimuthAxis)).toBeCloseTo(0, 6);
      expect(dot(boresight, elevationAxis)).toBeCloseTo(0, 6);
      expect(dot(azimuthAxis, elevationAxis)).toBeCloseTo(0, 6);
    });

    it('covers a terminal directly below a nadir beam (end-to-end)', () => {
      const frame = computeBoresightFrame(SAT, 0, 90);
      const terminal: Vec3 = { x: 6_378_137, y: 0, z: 0 };
      const offsets = computeBoresightOffsets(
        { x: terminal.x - SAT.x, y: terminal.y - SAT.y, z: terminal.z - SAT.z },
        frame.boresight,
        frame.azimuthAxis,
        frame.elevationAxis
      );
      expect(isInsideBeam(offsets, circular(5))).toBe(true);
    });
  });

  describe('hasLineOfSight', () => {
    it('grants line-of-sight to a terminal directly below the satellite', () => {
      const terminal: Vec3 = { x: 6_378_137, y: 0, z: 0 };
      expect(hasLineOfSight(SAT, terminal)).toBe(true);
    });

    it('denies line-of-sight to a terminal on the far side of the Earth', () => {
      // Antipodal surface point: the segment passes through the planet.
      const terminal: Vec3 = { x: -6_378_137, y: 0, z: 0 };
      expect(hasLineOfSight(SAT, terminal)).toBe(false);
    });

    it('denies line-of-sight to a terminal just beyond the visible limb', () => {
      // A point on the equator 80 deg of longitude away is below the horizon
      // for a satellite at 7000 km over the prime meridian.
      const lon = 80 * (Math.PI / 180);
      const terminal: Vec3 = {
        x: 6_378_137 * Math.cos(lon),
        y: 6_378_137 * Math.sin(lon),
        z: 0,
      };
      expect(hasLineOfSight(SAT, terminal)).toBe(false);
    });

    it('grants line-of-sight to a nearby terminal within the horizon', () => {
      const lon = 10 * (Math.PI / 180);
      const terminal: Vec3 = {
        x: 6_378_137 * Math.cos(lon),
        y: 6_378_137 * Math.sin(lon),
        z: 0,
      };
      expect(hasLineOfSight(SAT, terminal)).toBe(true);
    });

    it('treats coincident satellite/terminal as line-of-sight (degenerate)', () => {
      expect(hasLineOfSight(SAT, { ...SAT })).toBe(true);
    });
  });

  describe('groundFootprintRadius', () => {
    const R = 6_371_000; // EARTH_MEAN_RADIUS (mirrors the implementation constant)
    // Satellites at three regimes, straight up the +X axis (altitude = |pos| − R).
    const leo: Vec3 = { x: R + 600_000, y: 0, z: 0 };
    const geo: Vec3 = { x: R + 35_786_000, y: 0, z: 0 };

    it('matches the flat-Earth small-angle approximation (altitude·tan α) for a narrow beam', () => {
      const altitude = 600_000;
      const halfAngle = 2;
      const expected = altitude * Math.tan((halfAngle * Math.PI) / 180);
      // Within ~1% of the first-order approximation for a narrow nadir beam.
      expect(groundFootprintRadius(leo, halfAngle)).toBeCloseTo(expected, -2);
    });

    it('increases monotonically with the half-angle', () => {
      const r1 = groundFootprintRadius(leo, 5);
      const r2 = groundFootprintRadius(leo, 15);
      const r3 = groundFootprintRadius(leo, 30);
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });

    it('bounds a beam wider than the Earth disk to the visible horizon', () => {
      // From LEO the Earth's angular radius is ~66°; an 85° beam overshoots the
      // limb and must clamp to the horizon arc, NOT diverge.
      const horizon = R * Math.acos(R / (R + 600_000));
      expect(groundFootprintRadius(leo, 85)).toBeCloseTo(horizon, 0);
      // And never exceeds a quarter circumference, so Cesium can always triangulate.
      expect(groundFootprintRadius(geo, 89)).toBeLessThan((Math.PI / 2) * R);
    });

    it('is far smaller than projecting tan(halfAngle) over the rendered cone length (the bug)', () => {
      const CONE_LENGTH = 50_000_000;
      const halfAngle = 10;
      const buggy = CONE_LENGTH * Math.tan((halfAngle * Math.PI) / 180);
      expect(groundFootprintRadius(leo, halfAngle)).toBeLessThan(buggy);
    });
  });

  describe('degenerate frames', () => {
    it('builds a frame at the pole where East is otherwise undefined', () => {
      // A satellite directly over the north pole: the raw East cross-product is
      // ~zero, exercising the polar fallback branch.
      const polar: Vec3 = { x: 0, y: 0, z: 7_000_000 };
      const frame = computeBoresightFrame(polar, 0, 90);
      const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
      expect(len(frame.boresight)).toBeCloseTo(1, 6);
      // Nadir over the pole points -Z.
      expect(frame.boresight.z).toBeCloseTo(-1, 6);
    });
  });
});
