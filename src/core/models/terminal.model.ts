import { ModelAsset, TooltipConfig } from './model-asset.model';
import { GeodeticPosition } from './position.model';

/** Developer-supplied configuration for one ground terminal. */
export interface TerminalConfig {
  /** Unique id across all terminals in the scene. */
  id: string;
  /** Ground position of the terminal. */
  position: GeodeticPosition;
  /** Custom 3D model. Falls back to the bundled default terminal model. */
  model?: ModelAsset;
  /** Human-readable label rendered next to the model. */
  label?: string;
  /** Hover tooltip configuration. */
  tooltip?: TooltipConfig;
  /** Arbitrary developer payload echoed back in click/hover events. */
  data?: Record<string, unknown>;
}
