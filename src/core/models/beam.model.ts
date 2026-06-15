import { ColorConfig } from './position.model';

/**
 * A single antenna beam projected from a satellite toward the ground,
 * rendered as a cone whose intersection with the ellipsoid forms the
 * footprint.
 */
export interface BeamDefinition {
  /** Unique beam id within its parent satellite. */
  id: string;
  /** Boresight azimuth in degrees, clockwise from north. */
  azimuth: number;
  /** Boresight elevation in degrees above the satellite's local horizontal. */
  elevation: number;
  /** Half the total beamwidth, in degrees. */
  halfAngle: number;
  /** Cone/footprint color. Engine default applies when omitted. */
  color?: ColorConfig;
  /** Cone opacity, 0-1. Engine default applies when omitted. */
  opacity?: number;
}
