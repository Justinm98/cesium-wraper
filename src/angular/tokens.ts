import { InjectionToken } from '@angular/core';

import { RenderingEngine } from '../core/interfaces/rendering-engine.interface';
import { GlobeConfig } from '../core/models/globe-config.model';

/**
 * The injection seam that keeps the Angular layer engine-agnostic: the
 * component and service inject this token, never a concrete engine class.
 * Swapping engines means swapping the provider in provideGlobe().
 */
export const RENDERING_ENGINE = new InjectionToken<RenderingEngine>(
  'cesium-wrapper.rendering-engine'
);

/** Application-wide default globe configuration supplied via provideGlobe(). */
export const GLOBE_CONFIG = new InjectionToken<GlobeConfig>('cesium-wrapper.globe-config');
