import { ModelAsset } from '../../../core/models/model-asset.model';

/** Entity kinds that ship with a bundled fallback model. */
export type DefaultModelKind = 'satellite' | 'terminal';

/**
 * Resolves a developer-supplied {@link ModelAsset} (or the bundled default)
 * to a URI consumable by Cesium's ModelGraphics.
 *
 * v1 supports glTF/GLB only. CZML and OBJ are accepted by the type system
 * (they are part of the approved public API) but rejected at runtime with
 * an explicit error until post-v1 — failing loudly here beats silently
 * rendering nothing.
 */
export class ModelLoader {
  constructor(private readonly assetBaseUrl: string) {}

  /**
   * Returns the URI to load for an entity's model.
   *
   * @param asset - The developer-supplied asset, or undefined to use the
   *   bundled default for `fallback`.
   * @param fallback - Which bundled default to use when no asset is given.
   */
  resolveUri(asset: ModelAsset | undefined, fallback: DefaultModelKind): string {
    if (asset === undefined) {
      return `${this.assetBaseUrl}/default-${fallback}.glb`;
    }
    switch (asset.format) {
      case 'gltf':
      case 'glb':
        return asset.url;
      case 'czml':
        throw new Error(
          'CZML model loading is not implemented in v1 (see docs/architecture.md section 10).'
        );
      case 'obj':
        throw new Error(
          'OBJ model loading is not implemented in v1 (see docs/architecture.md section 10).'
        );
    }
  }
}
