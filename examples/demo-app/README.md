# Satellite Digital Twin — Demo App

A sample Angular 19 application showing off `@enterprise/cesium-wrapper`
with an [Astro UXDS](https://www.astrouxds.com/) mission-control UI. The
demo renders a satellite catalog (toggle tracking on/off), ground terminals
(add/remove at runtime), simulation speed controls, and the v2 **beams &
coverage** features (beam volumes, coverage recolor, link lines, external
coverage feed) — all driven through the library's `@Input()` bindings, never
through Cesium APIs.

## Run it

The app consumes the **built** library from `../../dist/cesium-wrapper`, so
build the library first:

```bash
# from the repository root
npm install
npm run build

# then the demo
cd examples/demo-app
npm install
npm start          # http://localhost:4200
```

After rebuilding the library, re-run `npm install --install-links` here to
pick up the new artifact (npm copies the package rather than symlinking, so
its dependencies resolve locally).

## What it demonstrates

| Feature | Where |
|---|---|
| Globe with free OSM imagery | `provideGlobe()` in [src/app/app.config.ts](src/app/app.config.ts) |
| Satellites from TLE data | `[satellites]` binding in [src/app/app.component.html](src/app/app.component.html) |
| Terminals at lat/lon/alt, added at runtime | "Ground Terminals" panel |
| Realtime orbit animation with speed control | `[timeConfig]` + "Simulation Speed" panel |
| Engine failure surfacing | `(initError)` → `rux-notification` banner |
| Default bundled 3D models | No `model` on any config — the library falls back |
| Antenna beams (circular + elliptical) | `beams` on `SatelliteConfig` in [src/app/app.component.ts](src/app/app.component.ts) |
| Beam volume visibility toggle | `[showBeamVolumes]` ← "Beam volumes" switch |
| Coverage computation (recolor covered terminals) | `[coverageComputationEnabled]` + `[coverageConfig]` ← "Coverage computation" switch |
| Satellite→terminal link lines | `coverageConfig.showLinkLines` ← "Link lines" switch |
| External coverage feed (authoritative override) | `[coverageAssignment]` ← "External feed" switch |

The satellite catalog mixes one real (historic) ISS TLE with synthetic
DEMO-* TLEs derived from it; they are valid orbits but not real spacecraft.

**Beams & Coverage panel.** Beams render their ground footprint outline
always; flip **Beam volumes** to also draw the translucent solid cones. Flip
**Coverage computation** to recolor terminals green while a beam sweeps over
them (raise the simulation speed to see passes quickly), and **Link lines**
to draw a line to each covering satellite. **External feed** forces the DC
gateway covered by the ISS from authoritative data — note it works **even
with Coverage computation off**, because an external assignment is
authoritative regardless of the computation toggle (decision M3).

## Consumer-side integration notes

These live in the app, not the library, and are required by any consumer:

- **`window.CESIUM_BASE_URL`** is set in [src/main.ts](src/main.ts) and the
  matching `Workers/ThirdParty/Assets` directories are copied from
  `@cesium/engine` via the `assets` section of [angular.json](angular.json).
- **Library default models** are copied to `assets/cesium-wrapper` in the
  same section.
- **Cesium's widget CSS** (`@cesium/engine/Source/Widget/CesiumWidget.css`)
  is registered in the `styles` array. Without it the WebGL canvas falls
  back to its intrinsic 300×150 size instead of filling its container.
- **`externalDependencies`** excludes satellite.js's optional Node-only
  WASM runtime (`#wasm-*` lazy imports) from the browser bundle.
- **Astro UXDS** web components are registered once in `main.ts`
  (`defineCustomElements()`); Angular templates use them with
  `CUSTOM_ELEMENTS_SCHEMA`.
