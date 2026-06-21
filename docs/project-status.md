# Project Status

**Last updated:** 2026-06-20
**Maintained by:** Project Manager agent
**Companion doc:** [roadmap.md](roadmap.md)

A point-in-time snapshot of what exists, what is verified, and what is
stubbed. For the forward plan and phase gates, see the roadmap.

---

## Summary

v1 is shipped and QA-verified. The project is entering v2, currently at the
**Requirements gate** for Epic A (Beams & Coverage). No v2 code has been
written and none should be until v2 Requirements and Architecture are
approved.

---

## Health

| Signal | State |
|---|---|
| Tests | 101 passing, 8 suites |
| Coverage | ~98% statements / ~97% branches (threshold 90%) |
| Lint | Clean (`angular-eslint` + `typescript-eslint` flat config) |
| Build | `ng-packagr` produces a publishable package (FESM2022, types, assets) |
| `tsc --noEmit` (strict, incl. specs) | Clean |
| Dependency audit (`--omit=dev`) | 0 vulnerabilities |
| Licensing | All runtime deps Apache-2.0 / MIT |
| Published to npm | No (built publish-ready; not released) |

---

## What is implemented (v1)

**Core (`src/core/`) — the full public API contract for *all* features**,
not just v1. Engine- and Angular-agnostic.
- Models: position, model-asset, beam, satellite, terminal, custom-entity,
  time, coverage, globe-config, events.
- Interfaces: `RenderingEngine`, `AuthTokenProvider`.

**Cesium engine (`src/engines/cesium/`)**
- `CesiumRenderingEngine`: `initialize()` / `destroy()`, OSM default tiles,
  optional custom tile provider, zone-safe render loop.
- `SatelliteManager`: add/update/remove, TLE propagation via `satellite.js`,
  default satellite model, throwing-callback guard.
- `TerminalManager`: add/update/remove, lat/lon/alt placement with range
  validation, default terminal model.
- `ModelLoader`: GLTF/GLB.
- `TimeController`: realtime clock.

**Angular (`src/angular/`)**
- `CesiumGlobeComponent` (`<cesium-globe>`), `CesiumGlobeService`,
  `provideGlobe()`, `RENDERING_ENGINE` token. Zone-safe init, `initError`
  output, destroy-during-init guard.

---

## What is stubbed (designed, throws explicit errors)

These have public types in `core/` but the engine throws
"not implemented in v1" today:

| Feature | v2? |
|---|---|
| Beams (`BeamDefinition`) | ✅ v2 (Epic A) |
| Coverage + link lines (`setCoverageConfig`, `setLinkLinesVisible`) | ✅ v2 (Epic A) |
| Click / hover events, tooltips | v3+ (Epic B) |
| Drag-drop terminal placement | v3+ (Epic B) |
| Custom entities (`addCustomEntity` …) | v3+ (Epic D) |
| OBJ / CZML model formats | v3+ (Epic D) |
| Playback / simulation time modes | v3+ (Epic C) |
| REST + Keycloak auth (`AuthTokenProvider`) | v3+ (Epic C) |

---

## Open items from the v1 review

From [review.md](review.md), accepted for v1 and still open:
- **M1** — one engine instance ⇒ max one `<cesium-globe>` per app.
- **M2 (code)** — OSM is dev-only; production needs a configured tile source
  (documented; default unchanged).
- **L1–L7** — assorted robustness/typing cleanups.
- **Forward-looking** — no real-Cesium integration test (addressed as a v2
  quality gate); 5k-entity scale strategy unproven; tooltip XSS risk when
  Epic B lands; `AuthTokenProvider` declared but unused until Epic C.

---

## Decisions of record

- **2026-06-20** — v2 scope = Epic A (Beams & Coverage) only; B/C/D parked.
- **2026-06-20** — Alternate rendering engines dropped as a product goal;
  Cesium-only. Interface retained as internal seam.
- **2026-06-20** — v2 adds a real-Cesium smoke-test quality gate.

See [decisions/v2-scope.md](decisions/v2-scope.md).
