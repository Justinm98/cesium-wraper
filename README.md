# @enterprise/cesium-wrapper

An enterprise Angular wrapper around CesiumJS for satellite digital-twin
visualization. Applications depend on engine-agnostic abstractions — no
Cesium types appear in the public API, so the rendering engine can be
replaced without touching consumer code.

**v1 scope:** satellites positioned from TLE orbital data and ground
terminals positioned from lat/lon/alt, rendered as 3D models on an
interactive globe with real-time orbital animation. Beams, coverage,
drag-and-drop placement, playback, and click/hover events are designed into
the API but not yet implemented — they fail with explicit errors rather
than silently doing nothing. See [docs/requirements.md](docs/requirements.md)
and [docs/architecture.md](docs/architecture.md).

## Requirements

- Angular ≥ 19 (standalone APIs)
- A WebGL-capable browser (Chrome or Firefox, latest stable)

## Installation

```bash
npm install @enterprise/cesium-wrapper
```

### Required: copy the bundled assets

The library ships default 3D models for satellites and terminals. Your
application must serve them; add this to the `assets` array of your
`angular.json` build options:

```json
{
  "glob": "**/*",
  "input": "node_modules/@enterprise/cesium-wrapper/assets",
  "output": "assets/cesium-wrapper"
}
```

Without this step, entities configured without a custom `model` will fail
to load (HTTP 404 for `assets/cesium-wrapper/default-satellite.glb`). If
you host the assets elsewhere, set `GlobeConfig.assetBaseUrl`.

## Quick start

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideGlobe } from '@enterprise/cesium-wrapper';

export const appConfig: ApplicationConfig = {
  providers: [provideGlobe()],
};
```

```ts
// scene.component.ts
import { Component } from '@angular/core';
import {
  CesiumGlobeComponent,
  SatelliteConfig,
  TerminalConfig,
} from '@enterprise/cesium-wrapper';

@Component({
  selector: 'app-scene',
  standalone: true,
  imports: [CesiumGlobeComponent],
  template: `
    <cesium-globe
      [satellites]="satellites"
      [terminals]="terminals"
      (initError)="onInitError($event)"
      style="display:block;height:100vh"
    />
  `,
})
export class SceneComponent {
  satellites: SatelliteConfig[] = [
    {
      id: 'iss',
      label: 'ISS',
      tle: {
        line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
        line2: '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560532    15',
      },
    },
  ];

  terminals: TerminalConfig[] = [
    {
      id: 'dc-gateway',
      label: 'DC Gateway',
      position: { latitude: 38.9, longitude: -77.0, altitude: 100 },
    },
  ];

  onInitError(error: Error): void {
    // Surface this to your users: typical causes are missing WebGL support
    // or an unreachable tile server.
    console.error('Globe failed to start', error);
  }
}
```

Entity arrays are diffed by `id` and object reference: replace objects to
update them (standard Angular immutable-input semantics), never mutate them
in place.

For imperative control (e.g., entities driven by a live data stream),
inject `CesiumGlobeService` — it shares the same engine instance as the
component:

```ts
private readonly globe = inject(CesiumGlobeService);

this.globe.addSatellite({ id: 'sat-42', tle });
this.globe.updateTerminal('dc-gateway', { label: 'DC Gateway (degraded)' });
```

> **Note:** one `provideGlobe()` environment supports one `<cesium-globe>`
> instance at a time.

## Map imagery

> **⚠️ Production deployments must configure a tile provider.** The default
> is OpenStreetMap's public tile server, which is fine for development but
> [explicitly not for production traffic](https://operations.osmfoundation.org/policies/tiles/).
> Point production apps at a commercial or self-hosted tile source:

```ts
provideGlobe({
  tileProvider: {
    type: 'custom',
    url: 'https://tiles.example.com/{z}/{x}/{y}.png',
  },
});
```

A Cesium Ion token may be supplied via `GlobeConfig.ionToken` if your
organization has an Ion subscription; it is never required.

## Custom 3D models

Pass a `model` on any entity config to replace the bundled default.
glTF/GLB is supported in v1; CZML and OBJ are planned.

```ts
{ id: 'sat-42', tle, model: { url: 'assets/models/my-sat.glb', format: 'glb' } }
```

## Development

```bash
npm test              # jest unit tests
npm run test:coverage # enforces ≥90% coverage
npm run lint          # eslint (angular-eslint + typescript-eslint)
npm run build         # ng-packagr → dist/cesium-wrapper
npm run generate:assets # regenerate default GLB models
```

## License

Apache-2.0. All runtime dependencies (CesiumJS, satellite.js, tslib) are
Apache-2.0/MIT — free to use and distribute.
