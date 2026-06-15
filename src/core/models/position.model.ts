/**
 * A position on or above the WGS84 ellipsoid.
 *
 * @remarks
 * Latitude and longitude are in degrees (not radians) because every data
 * source feeding this library (REST APIs, operator input) uses degrees;
 * converting to radians is the rendering engine's responsibility.
 */
export interface GeodeticPosition {
  /** Latitude in degrees, WGS84. Valid range: -90 to 90. */
  latitude: number;
  /** Longitude in degrees, WGS84. Valid range: -180 to 180. */
  longitude: number;
  /** Altitude in meters above the WGS84 ellipsoid. */
  altitude: number;
}

/**
 * An RGBA color. Channels are 0-255 to match common designer tooling;
 * alpha is 0-1 to match CSS conventions.
 */
export interface ColorConfig {
  /** Red channel, 0-255. */
  r: number;
  /** Green channel, 0-255. */
  g: number;
  /** Blue channel, 0-255. */
  b: number;
  /** Alpha, 0 (transparent) to 1 (opaque). */
  a: number;
}
