import { BeamDefinition } from './beam.model';
import { ModelAsset, TooltipConfig } from './model-asset.model';

/**
 * A NORAD Two-Line Element set describing an orbit. TLE is the industry
 * standard interchange format for orbital data and is what end users /
 * upstream systems are expected to provide.
 */
export interface TleData {
  /** TLE line 1 (catalog number, epoch, drag terms). */
  line1: string;
  /** TLE line 2 (inclination, RAAN, eccentricity, mean motion). */
  line2: string;
}

/** Developer-supplied configuration for one satellite. */
export interface SatelliteConfig {
  /** Unique id across all satellites in the scene. */
  id: string;
  /** Orbital elements used to propagate the satellite's position. */
  tle: TleData;
  /** Custom 3D model. Falls back to the bundled default satellite model. */
  model?: ModelAsset;
  /** Human-readable label rendered next to the model. */
  label?: string;
  /** Antenna beams projected from this satellite (post-v1 rendering). */
  beams?: BeamDefinition[];
  /** Hover tooltip configuration. */
  tooltip?: TooltipConfig;
  /**
   * Arbitrary developer payload. Never interpreted by the library; it is
   * echoed back verbatim in click/hover events so applications can drive
   * their own UI.
   */
  data?: Record<string, unknown>;
}
