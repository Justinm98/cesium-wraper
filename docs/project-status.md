# Project Status

**Last updated:** 2026-06-21
**Maintained by:** Project Manager agent
**Companion doc:** [roadmap.md](roadmap.md)

A point-in-time snapshot of what exists, what is verified, and what is
stubbed. For the forward plan and phase gates, see the roadmap.

---

## Summary

v1 is shipped and QA-verified. **v2 — Epic A (Beams & Coverage) is implemented**
and in the **Testing / QA gate**. Requirements and Architecture are approved; the
post-review remediation (review-v2 H1, M4, M5) and the 2026-06-21 work below have
landed.

Done 2026-06-21:
- **FR-A-01d beam-volume visibility toggle** — translucent volume, default OFF,
  global `setBeamVolumesVisible` / `@Input() showBeamVolumes` + optional per-beam
  `showVolume` (per-beam wins). Approved amendment in requirements-v2/architecture-v2 §2.5.
- **M1 — elliptical beam volume.** The volume is now a **local-space `Primitive`**
  (object-space unit cone placed by a non-uniform `modelMatrix` → a true
  elliptical cone), replacing the entity `CylinderGraphics`. Validated in real
  Cesium (M2). The footprint outline stays an entity.
- **M2 — real-Cesium smoke test (NFR-A-03).** Built under [smoke/](../smoke):
  Playwright drives the actual library against real `@cesium/engine` in headless
  Chromium (SwiftShader software WebGL2 — CI-capable, no GPU). `npm run test:smoke`.
- The harness immediately caught two real browser bugs the node/jsdom unit suite
  could not: **(a)** `global.Math` in beam.manager (Node-only global, crashes in a
  browser) — fixed; **(b)** the old 50,000 km entity cone fill crossed the IDL and
  threw in Cesium's `splitLongitude` — fixed by the M1 primitive (object-space
  geometry is not world-split).

Remaining before the Review gate:
- **M3 (decision).** Should an external coverage assignment apply while
  computation is disabled? One-line product call + doc (no code blocker).
- **Footprint sizing (new, found by M2).** `footprintAxes` projects `tan(halfAngle)`
  over the full 50,000 km cone length, so a wide beam yields an Earth-sized ground
  ellipse that Cesium cannot triangulate. Pre-existing, orthogonal to M1; not yet
  fixed (deferred by decision 2026-06-21).

See [roadmap.md](roadmap.md) and [review-v2.md](review-v2.md).

---

## Health

| Signal | State |
|---|---|
| Tests (unit, jest) | 217 passing, 12 suites (verified 2026-06-21) |
| Coverage | ~97.88% statements / ~95.12% branches (threshold 90%; verified 2026-06-21) |
| Smoke (real Cesium, Playwright) | 3 passing — headless WebGL2 via SwiftShader; `npm run test:smoke` (NFR-A-03) |
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
"not implemented in v1" today. (Beams and coverage + link lines are no longer
listed here — they shipped in the v2 Epic A implementation; see Summary.)

| Feature | Epic |
|---|---|
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
