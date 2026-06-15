import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';

import { GlobeConfig } from '../core/models/globe-config.model';
import { CesiumRenderingEngine } from '../engines/cesium/cesium-rendering-engine';
import { CesiumGlobeService } from './cesium-globe.service';
import { GLOBE_CONFIG, RENDERING_ENGINE } from './tokens';

/**
 * Wires the globe into a standalone Angular application:
 *
 * ```ts
 * // app.config.ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [provideGlobe({ tileProvider: { type: 'osm' } })],
 * };
 * ```
 *
 * The CesiumJS engine is bound here and only here; providing a different
 * {@link RENDERING_ENGINE} implementation swaps rendering engines without
 * touching any consumer code.
 */
export function provideGlobe(config?: GlobeConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: RENDERING_ENGINE, useClass: CesiumRenderingEngine },
    { provide: GLOBE_CONFIG, useValue: config ?? {} },
    CesiumGlobeService,
  ]);
}
