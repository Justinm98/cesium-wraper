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
