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

Done 2026-06-23:
- **Footprint sizing (found by M2) — fixed.** `footprintAxes` no longer projects
  `tan(halfAngle)` over the 50,000 km cone length (that length sizes the *volume*
  cone, not the slant range to the ground). The footprint semi-axes are now sized
  from the satellite's **live altitude** per frame via the pure, spherical
  `groundFootprintRadius` helper and **clamped to the visible horizon**, so any
  beam — including wide ones — yields a ground ellipse Cesium can triangulate. New
  unit tests for the helper (monotonic, small-angle ≈ altitude·tan, horizon bound)
  and a **wide-beam (80°) real-Cesium smoke test** (regression guard) were added.
- **M3 — resolved (Option A: external assignment applies standalone).** An
  external coverage assignment now drives its named terminals **regardless of the
  computation toggle**; with computation off, only assigned terminals are colored/
  linked and no geometry runs. The engine constructs the calculator lazily for a
  non-empty assignment (beams-only stays lazy, NFR-A-04), and a dedicated
  `CoverageCalculator.destroy()` tears the tick listener down unconditionally
  (preserves M5). Requirements FR-A-12a clarified; decision recorded in
  [decisions/m3-external-assignment.md](decisions/m3-external-assignment.md).

- **Example demo updated for v2 (Workflow Rule 4).** `examples/demo-app` now
  exercises beams (circular + elliptical via `SatelliteConfig.beams`), the beam-
  volume toggle, coverage computation + recolor, link lines, and an external
  coverage feed (demonstrating M3) — all through the public `@Input()` surface.
  Verified to build against the freshly-built library. Stale public TSDoc that
  predated the M1/M3 fixes (`beam.model` elliptical-volume note, the
  `coverageAssignment` `@Input()`) was corrected to match shipped behavior.
- **Process:** "update the example demo with every feature/version" is now a
  standing workflow rule — [CLAUDE.md](../CLAUDE.md) Rule 4, wired into the
  implementation-engineer / qa-engineer / project-manager agent charters and the
  roadmap process.

All review-v2 blockers (H1, M1) and strongly-recommended items (M2, M3, M4, M5)
are now closed; the footprint-sizing bug M2 surfaced is fixed; the demo reflects
v2. **v2 Epic A is ready for the Review gate.**

See [roadmap.md](roadmap.md) and [review-v2.md](review-v2.md).

---

## Health

| Signal | State |
|---|---|
| Tests (unit, jest) | 230 passing, 12 suites (verified 2026-06-23) |
| Coverage | ~98.36% statements / ~96.31% branches (threshold 90%; verified 2026-06-23) |
| Smoke (real Cesium, Playwright) | 4 passing — headless WebGL2 via SwiftShader; `npm run test:smoke` (NFR-A-03) |
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
