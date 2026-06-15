import { ColorConfig } from './position.model';

/**
 * How beam coverage is visualized on terminals (post-v1 rendering).
 */
export interface CoverageConfig {
  /** Color applied to a terminal while inside any beam footprint. */
  coveredColor: ColorConfig;
  /** Color applied while outside all footprints. Model default if omitted. */
  uncoveredColor?: ColorConfig;
  /** Whether satellite-to-terminal link lines are drawn for covered terminals. */
  showLinkLines: boolean;
  /** Link line color. Engine default applies when omitted. */
  linkLineColor?: ColorConfig;
}
