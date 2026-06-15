import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideGlobe } from '@enterprise/cesium-wrapper';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Default (free) OpenStreetMap imagery — fine for a demo. Production
    // apps must configure a tile provider; see the library README.
    provideGlobe(),
  ],
};
