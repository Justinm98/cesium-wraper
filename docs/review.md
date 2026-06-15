# QA / Security Review: v1 MVP Implementation

**Status:** Remediated — H1–H3, M3–M6 fixed and verified on 2026-06-12 (94 tests pass, lint clean, build green); L8 fixed incidentally. M1, M2 (code-side), L1–L7 accepted as documented for v1.
**Date:** 2026-06-12
**Reviewer:** QA Engineer agent
**Scope:** All of `src/`, build config, test suite, generated assets

| Finding | Resolution |
|---|---|
| H1 zone | **Fixed** — `initialize()` runs via `NgZone.runOutsideAngular`; output emissions re-enter the zone. Spec added. |
| H2 init failure | **Fixed** — new `initError` `@Output()`; component stays inert after failure. Specs added. |
| H3 destroy race | **Fixed** — `destroyed` flag guards the post-await continuation. Spec added. |
| M3 position validation | **Fixed** — lat/lon/alt range checks in `TerminalManager` with clear errors. Specs added. |
| M4 callback throw | **Fixed** — `computeEcfPosition` wrapped in try/catch. Spec added. |
| M5 lint | **Fixed** — angular-eslint + typescript-eslint flat config, `npm run lint` clean. |
| M6 README | **Fixed** — README covers install, mandatory assets copy, quick start, tile-provider production warning (also addresses M2's documentation ask). |
| M1, M2 (default change), L1–L7 | Open — accepted for v1, revisit post-v1. |
| L8 stale directive | **Fixed** — removed while cleaning up for lint. |

## Verified

- `tsc --noEmit` (strict, including specs): clean.
- `npm audit --omit=dev`: 0 vulnerabilities.
- 82/82 tests pass; coverage ~98% statements / ~97% branches (threshold 90%).
- ng-packagr build produces a valid npm-publishable package (FESM2022, types, assets).
- All runtime dependencies are Apache-2.0/MIT — licensing requirement (4.4) satisfied.
- No `any` in source; public APIs carry TSDoc.

---

## Findings

### HIGH

**H1. Cesium render loop runs inside the Angular zone.**
`CesiumGlobeComponent.ngOnInit` calls `engine.initialize()` directly, so the
CesiumWidget's `requestAnimationFrame` loop is patched by zone.js and triggers
Angular change detection on **every frame** (~60/s). This defeats the
integrated-GPU performance requirement (4.1) before a single satellite is
added.
*Fix:* inject `NgZone` in the component and wrap `initialize()` (and post-v1
event handler registration) in `ngZone.runOutsideAngular()`; re-enter the zone
only when emitting `@Output()` events.
*Location:* `src/angular/cesium-globe.component.ts` (ngOnInit)

**H2. Engine initialization failure is an unhandled promise rejection.**
`ngOnInit` is `async` but Angular does not await lifecycle hooks. If
`initialize()` rejects (bad custom tile URL, WebGL unavailable — likely on
the low-end hardware we target), the developer gets an unhandled rejection
and a silently dead component.
*Fix:* catch the rejection and either re-throw via an `@Output() initError`
event or an ErrorHandler; add a spec for it.
*Location:* `src/angular/cesium-globe.component.ts` (ngOnInit)

**H3. Destroy-during-init race.**
If the component is destroyed while `initialize()` is in flight (fast route
navigation), `ngOnDestroy` runs `engine.destroy()` first; the still-running
`ngOnInit` continuation then sets `ready = true` and calls add/setTimeConfig
on a destroyed engine, throwing "not initialized" asynchronously.
*Fix:* guard the post-await block with a `destroyed` flag; add a spec.
*Location:* `src/angular/cesium-globe.component.ts`

### MEDIUM

**M1. One engine instance = max one `<cesium-globe>` per application.**
`provideGlobe()` binds `RENDERING_ENGINE` at the environment (root) level, so
two simultaneous globe components share one engine and the second
`initialize()` throws "called twice". The architecture doc never states this
constraint.
*Fix (minimal):* document the single-globe constraint in architecture.md and
throw a clearer error. *Fix (better, post-v1):* provide the engine at
component level or support multiple scenes.

**M2. Default OSM tile provider violates OSM's usage policy in production.**
`tile.openstreetmap.org` is explicitly not for heavy production traffic
(OSMF Tile Usage Policy). Shipping it as the silent default for external
customer apps risks being blocked and embarrasses the product.
*Fix:* keep OSM for development, but document loudly (README + TSDoc on
`TileProviderConfig`) that production deployments must configure a
commercial/self-hosted tile source.

**M3. No input validation on geodetic positions.**
`TerminalConfig.position` accepts latitude 95, longitude 500, NaN, etc.
`Cartesian3.fromDegrees` will silently produce garbage placement. The models
document valid ranges but nothing enforces them.
*Fix:* validate ranges in `TerminalManager.add/update` (throw with the same
clear-error style used for TLEs); add specs.
*Location:* `src/engines/cesium/managers/terminal.manager.ts`

**M4. Satellite position callback can throw inside the render loop.**
`computeEcfPosition` guards null/non-finite results, but satellite.js can
also throw (`SatRecError`) for some degenerate inputs. An exception inside a
`CallbackPositionProperty` evaluation aborts Cesium's render frame — once per
frame, forever.
*Fix:* wrap the callback body in try/catch returning `undefined`; add a spec
with a throwing `propagate` mock.
*Location:* `src/engines/cesium/managers/satellite.manager.ts`

**M5. No lint tooling.**
CLAUDE.md mandates Angular style, but there is no ESLint config, so "lint
passes" is unverifiable and style drift is unchecked.
*Fix:* add `angular-eslint` + `typescript-eslint` flat config and a `lint`
script; wire into CI when CI exists.

**M6. No README / consumer documentation.**
The package is npm-publishable but undocumented: no install steps, no
`provideGlobe()` example, no instruction to copy `assets/` via angular.json
(without which default models 404 at runtime — a guaranteed first-user
failure).
*Fix:* write README.md covering setup, the assets copy step, and a minimal
app example.

### LOW

**L1. Trial propagation validates at "now".** A historic TLE for a decayed
satellite fails `addSatellite()` even though it would be valid for playback
windows (post-v1). Acceptable for realtime-only v1; revisit with playback.

**L2. `removeAll()` on both managers is dead production code** — only tests
call it. Either wire it into `destroy()`/a public `clear()` or delete it.

**L3. `Ion.defaultAccessToken` is global mutable state** shared across the
page; two engines with different tokens would fight. Acceptable v1; document.

**L4. Engine subjects are never `complete()`d on destroy** — late subscribers
hang forever instead of completing. Call `.complete()` in `destroy()`.

**L5. `buildEntityOptions` returns `object`** — type information is thrown
away at the EntityCollection boundary. Define a narrow local options
interface to keep strict typing end to end.

**L6. `assetBaseUrl` trailing-slash not normalized** (`'assets/'` →
`assets//default-satellite.glb`). Harmless but sloppy; normalize in
`ModelLoader`.

**L7. Duplicate ids inside one input array** silently collapse (last wins)
in the component differ. Consider throwing — silent data loss violates the
"no hidden magic" principle.

**L8. Stale `eslint-disable` comment** in the Cesium mock file references a
rule that is not configured and an `any` that does not exist.

### Forward-looking (not v1 defects)

- **Scale strategy absent:** 5,000 terminals as individual Cesium entities
  with glTF models will not hold 60 fps on integrated GPUs. Post-v1 beams/
  coverage work should evaluate point primitives + model LOD swapping or
  instancing before building on the entity-per-terminal pattern.
- **Tooltip rendering (post-v1) must use text nodes, never innerHTML** —
  `TooltipConfig.fields` is developer/end-user data and is an XSS vector if
  ever rendered as markup.
- **No integration test against real Cesium** — the mock boundary means a
  Cesium upgrade could break entity option shapes invisibly. A small
  Playwright/WebGL smoke test would close this.
- **`AuthTokenProvider` is declared but unused** in v1 (no REST fetching
  exists yet). Fine, but don't forget to actually honor it post-v1.

---

## Recommendation

H1–H3 should be fixed before this is handed to any consuming team — all
three are cheap fixes in one file. M3 and M4 are cheap robustness wins in the
engine layer. M2 and M6 are documentation tasks that block real-world use.
Nothing found warrants an architecture change.
