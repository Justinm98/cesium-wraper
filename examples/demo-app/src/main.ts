import { bootstrapApplication } from '@angular/platform-browser';
import { defineCustomElements } from '@astrouxds/astro-web-components/loader';

import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// CesiumJS loads its web workers and static assets from this base URL at
// runtime; angular.json copies node_modules/@cesium/engine/Build/* there.
// Must be set before the first Cesium import executes any rendering code.
declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}
window.CESIUM_BASE_URL = 'cesium';

// Registers all Astro UXDS web components (rux-*) with the browser.
defineCustomElements();

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
