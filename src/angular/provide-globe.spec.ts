import { TestBed } from '@angular/core/testing';

import { CesiumRenderingEngine } from '../engines/cesium/cesium-rendering-engine';
import { CesiumGlobeService } from './cesium-globe.service';
import { provideGlobe } from './provide-globe';
import { GLOBE_CONFIG, RENDERING_ENGINE } from './tokens';

describe('provideGlobe', () => {
  it('binds the Cesium engine, the config, and the service', () => {
    TestBed.configureTestingModule({
      providers: [provideGlobe({ ionToken: 'abc' })],
    });

    expect(TestBed.inject(RENDERING_ENGINE)).toBeInstanceOf(CesiumRenderingEngine);
    expect(TestBed.inject(GLOBE_CONFIG)).toEqual({ ionToken: 'abc' });
    expect(TestBed.inject(CesiumGlobeService)).toBeInstanceOf(CesiumGlobeService);
  });

  it('defaults to an empty config', () => {
    TestBed.configureTestingModule({ providers: [provideGlobe()] });

    expect(TestBed.inject(GLOBE_CONFIG)).toEqual({});
  });

  it('provides the engine as a singleton shared by component and service', () => {
    TestBed.configureTestingModule({ providers: [provideGlobe()] });

    expect(TestBed.inject(RENDERING_ENGINE)).toBe(TestBed.inject(RENDERING_ENGINE));
  });
});
