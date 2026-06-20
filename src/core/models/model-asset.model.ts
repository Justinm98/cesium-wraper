/**
 * 3D model formats the library accepts.
 *
 * @remarks
 * - `gltf` / `glb` are loaded natively by the rendering engine.
 * - `czml` is loaded natively by CesiumJS-based engines.
 * - `obj` is converted to glTF at load time (post-v1).
 *
 * Only license-unencumbered formats are supported by design; see
 * docs/requirements.md section 3.3.
 */
export type ModelFormat = 'gltf' | 'glb' | 'czml' | 'obj';

/** A reference to a 3D model asset supplied by the developer. */
export interface ModelAsset {
  /** Absolute or app-relative URL of the model file. */
  url: string;
  /** Format of the file at {@link ModelAsset.url}. */
  format: ModelFormat;
}

/**
 * Controls how a 3D model's apparent screen size responds to camera distance.
 *
 * @remarks
 * Cesium keeps the model at `minimumPixelSize` regardless of distance unless
 * `maximumScale` is also set. Without `maximumScale` the model appears at a
 * constant pixel size at every zoom level (the most common complaint).
 * Setting `maximumScale` creates a transition point: beyond a certain distance
 * the model can no longer grow to maintain the pixel floor and it naturally
 * shrinks as the camera moves away — giving users proportional zoom feedback.
 * Within the transition distance the model stays at `minimumPixelSize`; below
 * a few hundred metres it grows according to its real-world geometry.
 */
export interface ModelScaleConfig {
  /**
   * Minimum apparent size in pixels, regardless of camera distance. Prevents
   * the model from disappearing when zoomed out. Cesium uses this as a target
   * pixel size and scales the model geometry to maintain it.
   *
   * @default 32 for satellites, 24 for terminals
   */
  minimumPixelSize?: number;

  /**
   * Maximum scale multiplier that `minimumPixelSize` enforcement may apply.
   * Once the required scale exceeds this value, the pixel floor is no longer
   * honoured and the model shrinks naturally with distance — enabling
   * proportional scaling as the user zooms in and out.
   *
   * Tune this to the expected viewing distance: a small value makes the model
   * scale-responsive at closer range; a large value extends the constant-size
   * zone further out. Setting this too small makes the model invisible at
   * typical distances; too large approaches the flat "always same size"
   * behaviour of having no cap at all.
   *
   * @default 20000 for satellites (scales from ~5px at global view to 32px at
   *   regional view), 2000 for terminals (scales proportionally within a
   *   few hundred kilometres)
   */
  maximumScale?: number;
}

/**
 * Tooltip behavior for a single entity. Content is data-driven: developers
 * supply label/value pairs rather than markup, which keeps rendering inside
 * the library and avoids injecting arbitrary HTML (XSS surface).
 */
export interface TooltipConfig {
  /** Whether a hover tooltip is shown for this entity. */
  enabled: boolean;
  /** Label-to-value pairs rendered in the tooltip, in insertion order. */
  fields?: Record<string, string>;
}
