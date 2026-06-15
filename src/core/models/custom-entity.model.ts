import { ModelAsset, TooltipConfig } from './model-asset.model';
import { GeodeticPosition } from './position.model';

/**
 * Developer-supplied configuration for a generic 3D model placed on the
 * globe (e.g., a building). Unlike satellites and terminals there is no
 * sensible default model, so {@link CustomEntityConfig.model} is required.
 */
export interface CustomEntityConfig {
  /** Unique id across all custom entities in the scene. */
  id: string;
  /** Position of the entity. */
  position: GeodeticPosition;
  /** 3D model to render. Required — custom entities have no default. */
  model: ModelAsset;
  /** Human-readable label rendered next to the model. */
  label?: string;
  /** Hover tooltip configuration. */
  tooltip?: TooltipConfig;
  /** Arbitrary developer payload echoed back in click/hover events. */
  data?: Record<string, unknown>;
}
