import { AuthTokenProvider } from '../interfaces/auth-token-provider.interface';

/**
 * Base map imagery source. Defaults to OpenStreetMap so the library works
 * with zero accounts or API keys; Cesium Ion is strictly opt-in (see
 * docs/requirements.md 4.4 — the default stack must be free to distribute).
 */
export interface TileProviderConfig {
  /** `osm` for the free OpenStreetMap provider, `custom` for a WMTS/XYZ URL. */
  type: 'osm' | 'custom';
  /** Tile URL template. Required when {@link TileProviderConfig.type} is `custom`. */
  url?: string;
}

/**
 * Scene scale limits. These exist so applications fail fast with a clear
 * error instead of silently degrading on integrated GPUs.
 */
export interface PerformanceConfig {
  /** Maximum satellites in the scene. Default 100. */
  maxSatellites?: number;
  /** Maximum terminals in the scene. Default 5000. */
  maxTerminals?: number;
  /** Maximum beams per satellite. Default 10. */
  maxBeamsPerSatellite?: number;
}

/** Top-level configuration for the globe. All fields optional by design. */
export interface GlobeConfig {
  /** Base map imagery. Defaults to OpenStreetMap. */
  tileProvider?: TileProviderConfig;
  /**
   * Base URL where the library's bundled assets (default 3D models) are
   * hosted by the consuming app. Defaults to `assets/cesium-wrapper`; apps
   * copy the published package's `assets/` folder there via angular.json.
   */
  assetBaseUrl?: string;
  /** Optional Cesium Ion token; only used when a developer supplies one. */
  ionToken?: string;
  /** Scene scale limits. */
  performance?: PerformanceConfig;
  /** Token provider for authenticated REST calls (e.g., Keycloak). */
  auth?: AuthTokenProvider;
}
