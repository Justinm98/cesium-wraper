# Architecture: v2 — Beams & Coverage (Epic A)

**Status:** APPROVED — 2026-06-20 (user sign-off; Architecture gate closed)
**Date:** 2026-06-20
**Author:** Architect agent
**Scope:** v2 — Epic A only (beam footprints + coverage computation/visualization + link lines)

**Sign-off note (2026-06-20):** Approved with two user/PM decisions folded in:
- **OQ-1 — CLEAN BREAK (user).** The legacy flat `halfAngle` is **removed**, not
  deprecated; `BeamDefinition.geometry` is **required**. Safe because the v1 beam
  surface was only stubbed (never functionally shipped). §2.1, §2.4, §3.1.E,
  Decision A, and §7 #2 below reflect the clean break (superseding the
  deprecated-fallback design they originally described).
- **OQ-2 — APPROVED by PM (internal).** Beam sync is refactored to run
  independently of the satellite-entity rebuild (no API impact).
- **OQ-3 — deferred to Implementation by PM.** The elliptical-cone Cesium
  primitive choice stays behind `beam.manager.ts`; the real-Cesium smoke test
  (§5) de-risks it.

**Amendment 2026-06-21 (APPROVED — user sign-off):** §2.5 adds a beam-volume
visibility toggle (FR-A-01d — default OFF; global `@Input()`/method + optional
per-beam `showVolume`, per-beam wins) and records the **M1** resolution
(elliptical *volume* = non-uniform scaled cone). **Sequencing:** the toggle is
implemented now; the elliptical-cone *volume* shape (M1) is built with the M2
real-Cesium smoke test (§5) — the only thing that can validate it against real
Cesium — since `BeamManager` renders volumes as entities (no `scene.primitives`
access) and the unit mock cannot model the primitive path. The rest of this
document remains APPROVED (2026-06-20).

**Amends:** This document extends — and stays consistent with — the approved
[architecture.md](architecture.md). It **amends architecture.md §3 (module
layout), §4 (domain model), §5 (RenderingEngine interface), §6 (Angular layer),
§7 (engine internals), §8 (extension points), and §9 (design decisions)**. It
does **not** edit architecture.md; §7 of this document enumerates the exact
deltas for the PM to fold in on v2 sign-off. Everything outside Epic A remains
governed by architecture.md unchanged.

**Design authority:** Designed strictly to the APPROVED
[requirements-v2.md](requirements-v2.md). No scope is added. Where a genuine
architectural decision needs the user, it is surfaced in §8 rather than invented
(per the agent charter).

> **Note on existing code shapes.** architecture.md §4 sketches some types
> loosely; the *implemented* `core/` is the binding source of truth this design
> builds on. Specifically: `ColorConfig`/`GeodeticPosition` live in
> `core/models/position.model.ts` (not a single block as §4 implies);
> `ColorConfig` already carries a required `a` (alpha) channel; and
> `BeamDefinition` keeps `color?` **and** a separate `opacity?` field. This v2
> design preserves those existing shapes and does not "correct" them — doing so
> would be an unrequested breaking change outside Epic A.

---

## 1. Design constraints carried from v1 (non-negotiable)

These v1 invariants bound every decision below. They are restated so the
Implementer cannot accidentally regress them.

1. **No Cesium types in the public API** (architecture.md §1; NFR-A-06). All new
   public types live in `core/`. Cesium primitives appear only under
   `engines/cesium/`.
2. **Diff-not-replace** (architecture.md §6.1; FR-A-06). The component differ
   patches the scene; managers must not rebuild unaffected entities. *Caveat:*
   the existing `SatelliteManager.update()` is currently remove-and-re-add (see
   its own comment "revisit if updates become per-frame"). Beams change that
   calculus — see §3.1 D.
3. **NgZone discipline** (review.md H1; NFR-A-02). The Cesium render loop runs
   **outside** Angular. Nothing in beams/coverage may re-introduce per-frame
   change detection. All per-tick work happens inside Cesium's loop, never via
   an Angular subscription that calls `zone.run`.
4. **Fail-fast typed validation** (review.md M3/M4; FR-A-07/08). Invalid params
   throw a clear, satellite/beam-identifying error at add/update time — the
   style already used for TLEs and terminal positions. No silent clamp, no
   garbage render.
5. **Composition over inheritance** (CLAUDE.md). New managers/services are
   composed into `CesiumRenderingEngine`, never subclassed from existing ones.
6. **Tree-shakeable, no mandatory weight** (NFR-A-04). A consumer who renders
   beams but never enables coverage computation must not pull coverage math into
   a hot path, and ideally not pay for it at all when disabled.

---

## 2. The three required public-API changes (§7 of requirements)

This section designs the three required changes concretely (types + signatures),
then presents the **full public-surface delta** in one place (§2.4).

### 2.1 — `BeamDefinition` geometry selector (FR-A-01a/01b/01c, §7 #1)

**Requirement recap.** A beam must select a **circular cone** (single
half-angle) or an **elliptical** beam (separate azimuth/elevation beamwidths),
shaped so further geometries can be added later *without a breaking change*
(FR-A-01c). Per-geometry validation is required (FR-A-08).

**Chosen model: a discriminated union on a required `geometry` field.** Per the
user's clean-break decision (OQ-1, RESOLVED), the legacy flat `halfAngle` is
**removed** — `geometry` is mandatory. (The originally-proposed deprecated
`halfAngle` fallback is struck; the simpler required-field form below supersedes
it.)

```typescript
// core/models/beam.model.ts  (REVISED)
import { ColorConfig } from './position.model';

/** Right circular cone: a single half-angle about the boresight (FR-A-01a). */
export interface CircularBeamGeometry {
  readonly kind: 'circular';
  /** Half the total beamwidth, in degrees. Must be in (0, 90). */
  halfAngle: number;
}

/**
 * Elliptical cone: independent azimuth/elevation beamwidths (FR-A-01b).
 * Both are HALF-angles, to stay dimensionally consistent with the circular
 * `halfAngle` (so `{azimuth, elevation}` equal collapses to the circular case).
 */
export interface EllipticalBeamGeometry {
  readonly kind: 'elliptical';
  /** Half-beamwidth in the azimuth plane, degrees. Must be in (0, 90). */
  azimuthHalfAngle: number;
  /** Half-beamwidth in the elevation plane, degrees. Must be in (0, 90). */
  elevationHalfAngle: number;
}

/**
 * Discriminated union of beam geometries. New geometries (e.g. 'shaped',
 * 'rectangular') are added as NEW members with their own `kind` — existing
 * 'circular'/'elliptical' configs keep compiling and rendering unchanged
 * (FR-A-01c, open/closed). The Implementer exhaustively switches on `kind`;
 * `tsc` flags any unhandled member, so adding a geometry is a compile-time
 * checklist, not a silent gap.
 */
export type BeamGeometry = CircularBeamGeometry | EllipticalBeamGeometry;

export interface BeamDefinition {
  id: string;
  /** Boresight azimuth in degrees, clockwise from north. */
  azimuth: number;
  /** Boresight elevation in degrees above the satellite's local horizontal. */
  elevation: number;
  /**
   * Beam volume geometry (FR-A-01a/01b/01c). REQUIRED — every beam must declare
   * its geometry; there is no legacy `halfAngle` fallback (clean break, OQ-1).
   */
  geometry: BeamGeometry;
  color?: ColorConfig;
  /** Cone fill opacity, 0-1. Engine default 0.3 applies when omitted (FR-A-04). */
  opacity?: number;
}
```

**Why a discriminated union (vs. alternatives).**

- **Chosen — discriminated union on `kind`.** Each geometry carries exactly the
  fields it needs and no others. The circular variant cannot accidentally carry
  azimuth/elevation beamwidths; the elliptical variant cannot omit them. `tsc`
  enforces exhaustiveness at the render switch (FR-A-01c extensibility becomes a
  type-checked obligation). This is the idiomatic TS encoding of "one of N
  shapes," and it matches the user's "no hidden magic / explicit" priority.
- **Rejected — flat optional fields** (keep `halfAngle?`, add
  `azimuthBeamwidth?`/`elevationBeamwidth?` side by side). This makes every
  illegal combination *representable* (all three set, none set, half a pair),
  pushing correctness entirely into runtime validation and giving the type no
  descriptive power. It also gets worse with each future geometry.
- **Rejected — a `geometryType: string` enum + a loose params bag.** Either
  `Record<string, number>` (loses strict typing, NFR-A-04) or a union of param
  bags (which is just a discriminated union with extra indirection).
- **Rejected — class hierarchy / subtyping per geometry.** Violates
  composition-over-inheritance and would leak constructor patterns into a model
  that must stay a plain serializable interface.

**Clean break — no `halfAngle` (OQ-1 RESOLVED).**

The v1 `BeamDefinition.halfAngle` was part of a **stubbed** surface that threw
"not implemented" and was never functionally shipped, so there is no real
consumer to break. The user chose a **clean break**: `halfAngle` is **removed**
and `geometry` is **required**. This removes the deprecated fallback path
entirely — there is exactly one source of truth for a beam's shape. The
engine-side resolution rule is therefore trivial: `geometry` is always present
(the type enforces it), validated per geometry (FR-A-08); a missing/invalid
`geometry` is a `tsc` error or a validation throw, never a silent default.

### 2.2 — External coverage-assignment input (FR-A-12a–12d, §7 #2)

**Requirement recap.** The consumer supplies terminal→beam/satellite coverage
assignments that **override engine computation per-terminal (no merge)**
(FR-A-12c). Engine computation is the default per-terminal (FR-A-12b). Clearing
reverts cleanly within one tick (FR-A-12d).

**New core model type** — `core/models/coverage-assignment.model.ts`:

```typescript
/**
 * One externally-declared covered pair: a satellite (and optionally the
 * specific beam) that the consumer's authoritative data says covers a terminal.
 * Pair granularity matches link-line granularity (FR-A-13: one line per
 * (satellite, terminal) pair).
 */
export interface CoverageLink {
  /** Satellite id covering the terminal (consumer-facing id, NOT namespaced). */
  satelliteId: string;
  /**
   * Optional beam id on that satellite. Recorded for traceability/future use;
   * v2 colors terminals with the single global covered color regardless of
   * which beam (FR-A-17), so beam id does not change v2 coloring.
   */
  beamId?: string;
}

/**
 * Authoritative external coverage for ONE terminal. Presence of the terminal id
 * as a key means "this terminal is externally governed" — engine computation is
 * fully suppressed for it (FR-A-12c, per-terminal override). An EMPTY `links`
 * array is meaningful: it asserts "externally known to be covered by nothing,"
 * i.e. force-uncovered, distinct from "not externally assigned."
 */
export interface TerminalCoverageAssignment {
  terminalId: string;
  links: readonly CoverageLink[];
}

/**
 * The full external assignment payload. The set of terminalIds present here is
 * exactly the set of terminals the engine will NOT compute for. Terminals
 * absent from this list fall through to engine computation (FR-A-12b).
 */
export interface CoverageAssignment {
  assignments: readonly TerminalCoverageAssignment[];
}
```

**New methods (interface + service + component).** A pair of explicit methods,
not a config field, because assignment is a frequently-replaced data stream
(authoritative feed), conceptually distinct from the static `CoverageConfig`
coloring policy:

```typescript
// on RenderingEngine + CesiumGlobeService
/**
 * Supplies/replaces external coverage assignments (FR-A-12a). Wholesale
 * replace, not a delta — the payload is the complete authoritative set. The
 * named terminals are coloured/linked exactly as declared, overriding engine
 * computation per-terminal with no merge (FR-A-12c).
 */
setCoverageAssignment(assignment: CoverageAssignment): void;

/**
 * Clears all external assignments (FR-A-12d). Equivalent to
 * setCoverageAssignment({ assignments: [] }). Affected terminals revert within
 * one tick to engine computation (if enabled) or model-default appearance.
 */
clearCoverageAssignment(): void;
```

**Why wholesale-replace semantics.** A delta API (add/remove single assignments)
would re-create the same "is it still in effect?" ambiguity FR-A-12d warns
against and complicate the revert-within-one-tick guarantee. A single
replace-the-whole-set call makes "what is externally governed right now" a pure
function of the last call — trivially clearable, trivially diffable against the
previous set to compute reverts.

**Precedence is enforced at one place** — `CoverageCalculator` (§3.2): a terminal
whose id appears in the current `CoverageAssignment` is *skipped entirely* by the
geometric covered-test and is colored/linked straight from its declared `links`.
No union, no merge (FR-A-12c). When the assignment is cleared/replaced, the diff
of (old governed set − new governed set) is exactly the terminals that must
revert to computed/default within one tick (FR-A-12d).

**Component `@Input()`.** `CesiumGlobeComponent` gains
`@Input() coverageAssignment?: CoverageAssignment;` applied in `ngOnInit` and on
`ngOnChanges` (calling `setCoverageAssignment`, or `clearCoverageAssignment` when
it transitions to `undefined`), mirroring the existing `coverageConfig` pattern.

### 2.3 — Coverage-computation enable/disable toggle (FR-A-09a/09b, §7 #3)

**Requirement recap.** Coverage **computation** is opt-in and toggleable at
runtime, **distinct** from `setLinkLinesVisible` and `setCoverageConfig`. Off is
the default (FR-A-09a). Must stay tree-shakeable and not make coverage mandatory
weight (NFR-A-04).

**Chosen mechanism: a dedicated method** `setCoverageComputationEnabled(enabled)`,
**not** an `enabled` flag folded into `CoverageConfig`.

```typescript
// on RenderingEngine + CesiumGlobeService
/**
 * Enables/disables coverage COMPUTATION at runtime (FR-A-09a/09b). Default:
 * disabled — beams still render (FR-A-01), but no terminal is recoloured, no
 * covered set is computed, and no link line is drawn until this is enabled.
 * Disabling reverts all coverage recolouring and removes engine-drawn link
 * lines within one tick, while beams keep rendering.
 *
 * Orthogonal to setCoverageConfig (colours/policy) and setLinkLinesVisible
 * (line visibility). Distinct axes; see architecture-v2 §3.4.
 */
setCoverageComputationEnabled(enabled: boolean): void;
```

**Why a dedicated method (vs. folding `enabled` into `CoverageConfig`).**

- **Chosen — dedicated method.** Cleanly separates the *two independent axes*
  the requirements make central (§3 of requirements: visualization vs.
  computation). Toggling computation at runtime should not force the consumer to
  re-send the entire `CoverageConfig` (and would muddy FR-A-16's "until the next
  `setCoverageConfig`" link-line precedence rule, which keys off
  `setCoverageConfig` calls). It also keeps the *enablement* decision separable
  from *coloring policy*, so the off-state is genuinely a no-op.
- **Tree-shakeability (NFR-A-04).** The dedicated entry point lets the engine
  **lazily construct** `CoverageCalculator` only on first enable. Until a
  consumer calls `setCoverageComputationEnabled(true)`, the calculator is never
  instantiated and its per-tick listener is never registered, so a beams-only
  consumer pays effectively nothing at runtime. (Static import of the class
  still bundles its code; true bundle-level elision is bounded by the
  single-package decision — architecture.md §9 Decision 1 — and is noted as an
  accepted limitation, not a regression.)
- **Rejected — `CoverageConfig.enabled`.** Conflates policy with lifecycle,
  forces full-config re-send to toggle, and entangles with FR-A-16 precedence.
  Requirements explicitly leave this open ("one option the Architect may
  consider") and do not mandate it.

### 2.4 — Full public-surface delta (one place)

Additions are **purely additive** to the v1 surface — no existing signature
changes, satisfying "future engines drop in" and not breaking v1 consumers.

```typescript
// ── core/models/beam.model.ts (REVISED — §2.1) ───────────────────────────────
export interface CircularBeamGeometry   { kind: 'circular';   halfAngle: number; }
export interface EllipticalBeamGeometry { kind: 'elliptical'; azimuthHalfAngle: number; elevationHalfAngle: number; }
export type BeamGeometry = CircularBeamGeometry | EllipticalBeamGeometry;
// BeamDefinition gains a REQUIRED `geometry: BeamGeometry`; legacy `halfAngle` is REMOVED (clean break, OQ-1).
// AMENDMENT 2026-06-21: BeamDefinition also gains optional `showVolume?: boolean` (per-beam volume-visibility override; undefined ⇒ inherit global). §2.5.

// ── core/models/coverage-assignment.model.ts (NEW — §2.2) ─────────────────────
export interface CoverageLink { satelliteId: string; beamId?: string; }
export interface TerminalCoverageAssignment { terminalId: string; links: readonly CoverageLink[]; }
export interface CoverageAssignment { assignments: readonly TerminalCoverageAssignment[]; }

// ── core/interfaces/rendering-engine.interface.ts (REVISED — adds 3 methods) ──
interface RenderingEngine {
  // ... all existing v1 members unchanged ...
  setCoverageConfig(config: CoverageConfig): void;            // v1 — stub replaced
  setLinkLinesVisible(visible: boolean): void;                // v1 — stub replaced
  setCoverageComputationEnabled(enabled: boolean): void;      // NEW (§2.3)
  setCoverageAssignment(assignment: CoverageAssignment): void;// NEW (§2.2)
  clearCoverageAssignment(): void;                            // NEW (§2.2)
  setBeamVolumesVisible(visible: boolean): void;              // NEW (§2.5, amendment 2026-06-21)
}

// ── angular/cesium-globe.service.ts (REVISED — mirrors the 3 new methods) ─────
//   setCoverageComputationEnabled / setCoverageAssignment / clearCoverageAssignment
//   each delegating to this.engine.* (identical pass-through pattern to v1).

// ── angular/cesium-globe.component.ts (REVISED — new @Inputs) ─────────────────
//   @Input() coverageComputationEnabled = false;   // FR-A-09a default OFF
//   @Input() coverageAssignment?: CoverageAssignment;
//   @Input() showBeamVolumes = false;              // FR-A-01d default OFF (amendment 2026-06-21)
//   Applied in ngOnInit + ngOnChanges, mirroring the existing coverageConfig path.
```

`CoverageConfig` is **unchanged** (requirements §7 "confirmed sufficient"): its
`coveredColor`/`uncoveredColor`/`showLinkLines`/`linkLineColor` already cover the
global covered color (FR-A-17) and link-line config (FR-A-14/16). Its TSDoc
"post-v1 rendering" should read "v2" on sign-off (requirements §7 doc-nit) — a
cosmetic comment-only change, listed in §7.

### 2.5 — Beam-volume visibility toggle + M1 elliptical-cone volume (AMENDMENT 2026-06-21, APPROVED)

**Requirement recap (FR-A-01d + M1).** The translucent solid beam *volume* is
visibility-toggleable, **default OFF**; the ground footprint outline is
unaffected (always shown). Control is **global** plus an optional **per-beam**
override. And **M1:** when a volume *is* shown for an elliptical beam, it must be
a true elliptical cone, resolved here as a **non-uniform scaled cone**.

**Public surface (purely additive).**
- `BeamDefinition` gains optional `showVolume?: boolean`.
- `RenderingEngine` + `CesiumGlobeService` gain
  `setBeamVolumesVisible(visible: boolean): void`.
- `CesiumGlobeComponent` gains `@Input() showBeamVolumes = false`, applied in
  `ngOnInit`/`ngOnChanges` exactly like the other coverage inputs.

**Effective visibility + precedence.** `BeamManager` computes, per beam,
`effectiveVolumeVisible = beam.showVolume ?? globalShowBeamVolumes`. A defined
per-beam value **overrides** the global; an undefined one **inherits** it.
Explicit per-beam wins (no hidden magic). Default global `false` ⇒ default
effective `hidden`.

**M1 — non-uniform scaled cone.** Replace the current radially-symmetric
`CylinderGraphics` sized to `representativeHalfAngle = max(azHalf, elHalf)` with a
cone whose cross-section semi-axes are derived independently from the azimuth and
elevation half-angles — a **non-uniform scale** applied via a primitive
`modelMatrix` (the §3.1.C option (b) path) — so the rendered volume is a true
elliptical cone matching the already-correct elliptical footprint and the
corrected elliptical coverage test (`coverage-geometry`, review-v2 H1). The
circular case is the equal-semi-axis special case. All Cesium geometry stays
behind `beam.manager.ts`. This is exactly what the NFR-A-03 smoke test (M2) must
validate against real Cesium.

**Render/teardown semantics.** Toggling visibility shows/hides only the volume;
the footprint-outline entity is never touched. Toggling the global re-evaluates
all beams in O(beams) — no rebuild. Coverage computation (FR-A-09d) is fully
independent of volume visibility.

---

## 3. Internal engine design

No production code here — responsibilities, collaborations, and the Cesium
primitives each manager owns. New internals are composed into
`CesiumRenderingEngine` exactly as `SatelliteManager`/`TerminalManager` are
today.

### 3.1 — `BeamManager`

**Owns:** the lifecycle of beam *visuals* for all satellites. Beams render
**regardless of coverage** (FR-A-01/09a); `BeamManager` has **no dependency** on
`CoverageCalculator`. (This corrects architecture.md §7's sketch, which had
`BeamManager` "trigger CoverageCalculator on each clock tick" — see §7 delta.)

**A. Where it lives & how it is wired.**
`engines/cesium/managers/beam.manager.ts`. Constructed in
`CesiumRenderingEngine.initialize()` with the shared `EntityCollection` and
`maxBeamsPerSatellite` (default 10, from `PerformanceConfig`). The engine routes
satellite add/update/remove that carry `beams` to it. Beam entity ids are
namespaced `beam:<satelliteId>:<beamId>` (extending the existing `satellite:` /
`terminal:` namespacing convention) so they never collide and are bulk-removable
per satellite.

**B. Following the satellite per tick (FR-A-05).** A beam's origin and
orientation must track the moving satellite within one tick **without per-frame
Angular work** (NFR-A-02). The beam entity's position/orientation are driven by
Cesium time-varying properties evaluated inside Cesium's own render loop:
- **Position:** the beam reuses the satellite's `CallbackPositionProperty` (the
  same propagation already computed by `SatelliteManager`) — `BeamManager` is
  given a read accessor to the satellite's position property rather than
  re-propagating, so one TLE evaluation feeds both the model and its beams.
- **Orientation:** a `CallbackProperty<Quaternion>` (or
  `VelocityOrientationProperty` composed with the beam's fixed
  azimuth/elevation offset) computes the boresight each tick from the
  satellite's current position/velocity. Boresight = local-ENU frame rotated by
  the beam's `azimuth`/`elevation`.

Because both are Cesium callback properties evaluated in the render loop, there
is zero Angular involvement per tick — the NgZone fix (review.md H1) is
respected.

**C. Cesium primitives per geometry (FR-A-01a/01b + footprint outline).**

| Beam piece | Circular | Elliptical | Cesium dependency |
|---|---|---|---|
| Translucent solid volume | `CylinderGraphics` with `topRadius=0` (a cone), `length` long enough to reach the ellipsoid, `slantAngle` from `halfAngle` | `CylinderGraphics` with **different** semi-axes is not expressible (cylinder is radially symmetric) → use a `CustomProperty/Primitive`-backed elliptical cone, OR a `WallGraphics`/triangulated cone mesh built from the two half-angles | `@cesium/engine` `CylinderGraphics`, `Cartesian3`, `Quaternion`, `Color`. Encapsulated entirely in `beam.manager.ts`. |
| Ground footprint outline (full opacity, FR-A-04) | `EllipseGraphics` outline at the ellipsoid intersection (a circular cone meets the sphere in a near-ellipse) | `EllipseGraphics` with distinct `semiMajorAxis`/`semiMinorAxis` derived from the two beamwidths | `EllipseGraphics` (outline-only: `fill:false`, `outline:true`). |

**Design recommendation, not a mandate** (the requirement specifies behavior,
not the primitive): for the **circular** case, `CylinderGraphics` as a cone is
the simplest exact fit and is entity-friendly (rides the same time-dynamic
orientation property). For the **elliptical** case, Cesium has no built-in
elliptical-cone entity graphic; the Implementer should evaluate (a) a
parametrically-generated triangle-mesh cone via a `Primitive`/`Geometry`, or
(b) approximating with a scaled cylinder using `modelMatrix`/non-uniform scale
on a primitive. Either keeps **all** Cesium geometry choices behind
`beam.manager.ts`. This is flagged as the highest-uncertainty implementation
area; it is exactly what the real-Cesium smoke test (§5) must pin down.

**D. Diff-not-replace on update (FR-A-06).** This is the one place v2 must
*improve* on a v1 pattern. `SatelliteManager.update()` currently does
remove-and-re-add of the whole satellite entity. For beams that would be
acceptable for the satellite *model* but wasteful for beams, and — more
importantly — FR-A-06 explicitly requires "without recreating unaffected
entities." Design:
- `BeamManager` keeps a per-satellite `Map<beamId, BeamDefinition>` of applied
  beams (mirroring the manager `configs` pattern).
- On `updateSatellite(id, { beams })`, `BeamManager.syncBeams(satId, nextBeams)`
  diffs by `beamId` + object reference (the same algorithm the component differ
  uses): add new, remove dropped, update changed, leave unchanged beams
  **untouched**. This keeps the satellite model's remove-and-re-add (existing
  behavior) decoupled from beam churn. (Surfaced as **OQ-2** in §8: whether to
  also refactor `SatelliteManager.update` to stop tearing down beams when only
  the model changes — a small consistency question.)

**E. Validation & limits (FR-A-07/08).** Before rendering any beam for a
satellite, `BeamManager` validates the **whole** set:
- Count > `maxBeamsPerSatellite` → **throw** a typed error naming the satellite
  and the limit; render *none* of that satellite's beams (FR-A-07, no silent
  clamp). The throw happens at add/update time, atomically, before any entity is
  touched.
- Per-beam, per-geometry validation (FR-A-08): circular `halfAngle ∈ (0,90)`;
  elliptical `azimuthHalfAngle`/`elevationHalfAngle ∈ (0,90)`; `opacity ∈ [0,1]`;
  `azimuth`/`elevation` finite; `geometry` present with a known `kind` (§2.1).
  Errors match the
  existing TLE/position error style (id-prefixed, actionable).
- Zero/absent beams → no-op, not an error (FR-A-20).

**F. Appearance defaults (FR-A-03/04).** Default color cyan `{r:0,g:200,b:255}`,
default fill opacity `0.3`; footprint outline drawn at full opacity. Defaults
are applied in `BeamManager` (engine layer), not baked into the core model, so
the model stays "omitted means engine default" per existing convention.

### 3.2 — `CoverageCalculator`

**Owns:** the per-tick covered-set computation, terminal recolor instructions,
external-assignment override, and link-line membership. Lives at
`engines/cesium/services/coverage-calculator.ts` (matching architecture.md §3's
`services/` placement). **Lazily constructed** by `CesiumRenderingEngine` on the
first `setCoverageComputationEnabled(true)` (§2.3, NFR-A-04).

**A. Collaborators.**
- Reads satellite positions/velocities (from `SatelliteManager`) and resolved
  beam geometries (from `BeamManager`) for the *current* tick.
- Reads terminal positions (from `TerminalManager`).
- Holds the current `CoverageConfig` (colors), the
  computation-enabled flag, the link-line visibility/precedence state (§3.4),
  and the current `CoverageAssignment` (external override).
- Emits recolor + link-line instructions to `TerminalManager` and a
  `LinkLineManager` (§3.3). It does **not** itself create Cesium entities — it
  computes a set and hands membership to the renderers. (Keeps spatial math
  separate from entity CRUD: architecture.md §9 Decision 5 preserved.)

**B. The "covered" test (FR-A-09d).** A terminal is covered by a beam iff BOTH:
1. its 3D position (lat/lon **and altitude** → ECEF `Cartesian3`) lies inside
   the beam's 3D volume for the beam's geometry, **and**
2. it has line-of-sight to the satellite — **not** Earth-occluded.

Containment test, in the satellite's local boresight frame:
- Vector `v = terminalECEF − satelliteECEF`; transform into the beam's boresight
  frame (same orientation `BeamManager` uses, §3.1.B, so visual and computed
  coverage cannot diverge — a single source of geometry).
- **Circular:** angle between `v` and boresight ≤ `halfAngle`.
- **Elliptical:** decompose `v` into azimuth/elevation angular offsets in the
  boresight frame; inside iff `(θ_az/azimuthHalfAngle)² +
  (θ_el/elevationHalfAngle)² ≤ 1` (elliptical-cone test).
- **Occlusion:** standard ellipsoid line-of-sight — the segment
  satellite→terminal must not be blocked by the WGS84 ellipsoid (equivalently,
  the terminal is on the satellite-visible side of the horizon). Cesium's
  `EllipsoidalOccluder` (or an explicit horizon-dot-product test) does this;
  the dependency stays inside the calculator.

**C. Recompute strategy & correctness within one tick (FR-A-19, NFR-A-01).**
Requirement: **correct on every tick** at 100 sats × 10 beams × 5000 terminals;
the *measured fps budget is a parked v3 gate* (NFR-A-01) — so the mandate is
**correct and not pathological**, not micro-optimized.

- **Cadence.** The calculator subscribes to Cesium's clock tick
  (`clock.onTick`) — inside the render loop, **outside** Angular (§3.4, NFR-A-02)
  — and recomputes the covered set each tick while computation is enabled.
- **Naive cost** is O(sats × beams × terminals) = 100×10×5000 = 5,000,000
  containment tests/tick — borderline pathological at 60 Hz. The design
  **recommends broad-phase culling** to make it correct *and* tractable, without
  promising the v3 fps number:
  - **Per-satellite horizon cull:** a terminal beyond the satellite's horizon
    fails occlusion regardless of beam — cull all of a satellite's beams against
    a terminal once per (sat, terminal) using a cheap dot-product before any
    per-beam angular test. Cuts the inner loop by the (typically large)
    fraction of terminals over the horizon.
  - **Spatial index on terminals:** build a bounding structure (e.g. a
    lat/lon grid bucket or a simple bounding-sphere hierarchy) once and update
    incrementally on terminal add/remove (terminals are static in v2 — fixed
    geodetic positions), then query only terminals within each beam's footprint
    bounding cap. Terminals are the large, *static* dimension, so the index is
    built rarely and queried every tick.
  - **Footprint bounding cap per beam:** each beam's ground footprint has a
    bounding circle; only terminals inside it are candidate-tested.
- **Dirty-tracking is permitted but bounded by correctness.** FR-A-19 allows
  internal throttling "only so long as correct within one tick" holds. Because
  satellites move every tick, the covered set is generally dirty every tick;
  the legitimate optimization is *spatial culling per tick*, not *skipping
  ticks*. The design explicitly forbids time-based throttling that would let a
  terminal show a stale color across a tick boundary.
- **This is a recommendation.** Per NFR-A-01, the Implementer chooses the index;
  the architecture's binding requirement is (1) recompute every tick, (2) employ
  broad-phase culling so the inner loop is not the full Cartesian product, and
  (3) keep the result correct. The v3 benchmark gate (parked) will later decide
  if more is needed.

**D. External-assignment override merge-point (FR-A-12a–12d).** Single,
explicit branch at the top of the per-terminal evaluation:
```
for each terminal t:
  if t.id ∈ currentAssignment:           # per-terminal override (FR-A-12c)
     covered := (assignment[t].links is non-empty)
     coveredColor / links := straight from assignment[t].links   # no geometry
  else:                                   # engine computation (FR-A-12b)
     covered := any beam covers t  (test B above)
```
No union/merge. On `setCoverageAssignment`/`clearCoverageAssignment`, the
calculator diffs old-governed vs new-governed terminal ids and forces a recolor
of the difference on the next tick, guaranteeing FR-A-12d's "revert within one
tick, nothing stuck."

**E. Recolor & transitions (FR-A-09/10/11/17).** Covered → global
`coveredColor` (FR-A-17, "covered is covered," even under multiple beams).
Uncovered → `uncoveredColor` if set, else the terminal's model-default
appearance (FR-A-10). Coverage is **not sticky** (FR-A-11): a terminal that
leaves every beam reverts next tick. Recoloring is applied by `TerminalManager`
(it owns terminal entities) via a new `setCoverageColor(id, color|undefined)`
method that overlays/clears a coverage color *without* disturbing the
developer-supplied model — overlay state is separate from base config so
clearing reverts to model default cleanly (FR-A-09b disable path).

**F. Disable path (FR-A-09b).** On `setCoverageComputationEnabled(false)`: stop
listening to the clock tick, clear all coverage colors (revert terminals to
model default within one tick), and remove all engine-drawn link lines — beams
keep rendering (BeamManager untouched).

### 3.3 — Link lines (`LinkLineManager`) & rendering ownership

**Owns:** the Cesium entities for satellite↔terminal link lines.
`engines/cesium/managers/link-line.manager.ts`. Separated from
`CoverageCalculator` (which decides *membership*) so math and entity CRUD stay
apart, consistent with §3.2.A.

- **Per covered pair, exactly one line** (FR-A-13). Line id namespaced
  `link:<satelliteId>:<terminalId>`. A terminal covered by 3 satellites → 3
  lines.
- **Endpoint tracking (FR-A-15):** the satellite endpoint is a
  `CallbackProperty` reading the satellite's live position (render-loop
  evaluation, no Angular). Terminal endpoint is static. Line is a
  `PolylineGraphics` between the two; color from `CoverageConfig.linkLineColor`
  or engine default (FR-A-14).
- Lines for pairs that leave coverage are removed within one tick (FR-A-15);
  membership comes from `CoverageCalculator` each tick (diff add/remove, not
  rebuild-all).

### 3.4 — Clock-tick wiring & the link-line toggle/precedence state machine

**Clock-tick hook without per-frame Angular CD (NFR-A-02, review H1).** Both
`BeamManager` (orientation callbacks) and `CoverageCalculator` (the per-tick
recompute via `clock.onTick`) execute **inside Cesium's render loop**, which the
v1 fix already runs **outside** the Angular zone (component `ngOnInit` wraps
`initialize` in `runOutsideAngular`). No coverage/beam code subscribes to an
Observable that triggers Angular change detection. The only Angular re-entry
remains the existing `entityClick$/hover$/terminalPlaced$` emissions — coverage
adds **no** new per-frame zone crossing. This is an explicit invariant the QA
phase must verify.

**Link-line precedence state machine (FR-A-16).** Two inputs decide whether
lines are visible: `CoverageConfig.showLinkLines` (config) and imperative
`setLinkLinesVisible(v)` (runtime override). Rule (FR-A-16): an imperative call
**wins until the next `setCoverageConfig`**, which re-establishes the config
value as active.

```
State: linkLinesVisible: boolean, overrideActive: boolean

setCoverageConfig(cfg):
    linkLinesVisible = cfg.showLinkLines      # config re-establishes the value
    overrideActive   = false                  # imperative override is cleared

setLinkLinesVisible(v):
    linkLinesVisible = v
    overrideActive   = true                   # override wins until next setCoverageConfig

Each tick (if computation enabled):
    if linkLinesVisible: ensure a line exists for every covered pair
    else:                ensure no engine-drawn line exists
```

Initial state: `linkLinesVisible = CoverageConfig.showLinkLines` (default OFF,
FR-A-16); `overrideActive = false`. This state lives in `CoverageCalculator`
(or a small shared coverage-state object it owns) so the per-tick loop reads a
single source of truth. Link lines only ever draw when computation is enabled
(FR-A-09a: nothing drawn while off).

---

## 4. Facade / engine boundary

**No Cesium types leak into the public API (NFR-A-06).** Confirmed by placement:

| New type / method | Layer | File |
|---|---|---|
| `BeamGeometry`, `Circular/EllipticalBeamGeometry`, revised `BeamDefinition` | **core/** | `core/models/beam.model.ts` |
| `CoverageAssignment`, `TerminalCoverageAssignment`, `CoverageLink` | **core/** | `core/models/coverage-assignment.model.ts` (NEW) |
| `setCoverageComputationEnabled`, `setCoverageAssignment`, `clearCoverageAssignment` | **core/** interface | `core/interfaces/rendering-engine.interface.ts` |
| `BeamManager` | engine | `engines/cesium/managers/beam.manager.ts` (NEW) |
| `LinkLineManager` | engine | `engines/cesium/managers/link-line.manager.ts` (NEW) |
| `CoverageCalculator` | engine | `engines/cesium/services/coverage-calculator.ts` (NEW) |

Every Cesium primitive (`CylinderGraphics`, `EllipseGraphics`,
`PolylineGraphics`, `Quaternion`, `EllipsoidalOccluder`, `CallbackProperty`,
`Cartesian3`) appears **only** in the three engine files above. The Angular layer
and `core/` import none of them. The three new methods are added to the
`RenderingEngine` interface (core) and mirror down to `CesiumGlobeService` and
`CesiumGlobeComponent` exactly as v1's coverage methods do.

**Updated module layout (architecture.md §3 delta):**
```
src/
├── core/models/
│   ├── beam.model.ts                  # REVISED: BeamGeometry union, geometry? field
│   └── coverage-assignment.model.ts   # NEW: external assignment payload
├── core/interfaces/
│   └── rendering-engine.interface.ts  # REVISED: +3 methods
├── engines/cesium/managers/
│   ├── beam.manager.ts                # NEW
│   └── link-line.manager.ts           # NEW
├── engines/cesium/services/
│   └── coverage-calculator.ts         # NEW
├── engines/cesium/cesium-rendering-engine.ts  # REVISED: compose new internals, replace stubs
└── angular/
    ├── cesium-globe.service.ts        # REVISED: +3 pass-through methods
    └── cesium-globe.component.ts      # REVISED: +2 @Inputs
```

---

## 5. Testability & the real-Cesium smoke-test gate (NFR-A-03)

**Unit-testable behind the existing mock boundary (NFR-A-05, ≥90%).** The
existing suite mocks `@cesium/engine`; the new managers/services follow the same
seam:
- **`CoverageCalculator` is the high-value unit target** and is almost entirely
  pure math: feed it satellite positions, beam geometries, terminal positions,
  config, and an assignment; assert the covered set, the colors emitted, the
  link-line membership, the override branch (FR-A-12c), the revert diff
  (FR-A-12d), and transitions both ways (FR-A-11). No Cesium needed for the
  math — it operates on plain vectors and the model types. **Recommendation:**
  keep the containment/occlusion math in pure functions the calculator calls, so
  they unit-test without any Cesium mock at all.
- **`BeamManager`/`LinkLineManager`** are tested against the Cesium mock for
  entity CRUD shape, namespacing, diff-not-replace (assert unchanged beams are
  not re-added), throw-on-over-limit (FR-A-07), and per-geometry validation
  (FR-A-08) — mirroring the existing `SatelliteManager`/`TerminalManager` specs.
- The lazy-construction of `CoverageCalculator` (only on first enable) and the
  disable revert path get explicit specs.

**The seam for the real-Cesium Playwright/WebGL smoke test (NFR-A-03).** The
mock cannot catch a Cesium upgrade changing entity/geometry option shapes
(review.md "Forward-looking"). The smoke test (the e2e-test-engineer implements;
this design defines what it must exercise) should, against **real** Cesium in a
headless WebGL browser:
1. Render a satellite with a **circular** beam and an **elliptical** beam and
   assert both volumes + footprint outlines appear (geometry option shapes are
   valid against the shipped Cesium version) — this is the exact failure class
   the mock hides.
2. Enable coverage computation with a terminal placed inside a beam and assert it
   **recolors** to `coveredColor`; move the clock so it leaves the beam and
   assert it **reverts** (FR-A-09/11) — real clock-tick path, real occlusion.
3. Toggle `setLinkLinesVisible` and assert a polyline appears/disappears for a
   covered pair (FR-A-13/16).

The design keeps this thin: the smoke test asserts *presence/behavior against
real Cesium*, while exhaustive correctness stays in the fast unit layer.

---

## 6. Key design decisions (architecture.md §9 style)

### Decision A: Beam geometry as a discriminated union on `kind`
**Chosen:** `BeamGeometry = CircularBeamGeometry | EllipticalBeamGeometry`, a
**required** `geometry` field on `BeamDefinition`; legacy `halfAngle`
**removed** (clean break, OQ-1 RESOLVED). **Alternatives:** flat optional fields
(every illegal combination representable; correctness pushed to runtime); a
`geometryType` string + loose params bag (loses strict typing or reinvents the
union); a class hierarchy (violates composition-over-inheritance, breaks the
plain-interface model); keeping a deprecated `halfAngle` fallback (rejected by
the user — the v1 beam surface was only stubbed, so there is nothing to keep
compatible with). **Rationale:** the union makes illegal states unrepresentable,
gives `tsc` exhaustiveness checking so FR-A-01c extensibility is type-enforced,
and stays a serializable plain interface. Making `geometry` required gives one
unambiguous source of truth for beam shape with no dead fallback path.
Trade-off: none of consequence — no real consumer used the v1 stub.

### Decision B: Coverage-computation toggle as a dedicated method
**Chosen:** `setCoverageComputationEnabled(enabled)`, separate from
`CoverageConfig`. **Alternative:** `CoverageConfig.enabled` flag.
**Rationale:** keeps the two requirement-central axes (visualization vs.
computation) cleanly orthogonal; lets the engine **lazily construct**
`CoverageCalculator` only on first enable (NFR-A-04 — a beams-only consumer pays
nothing at runtime); avoids entangling with FR-A-16's "until next
`setCoverageConfig`" precedence rule. Trade-off: one more method on the surface
— accepted, as it maps 1:1 to a distinct capability the user called out.

### Decision C: External assignment as wholesale-replace methods + per-terminal override
**Chosen:** `setCoverageAssignment(payload)` / `clearCoverageAssignment()` with
replace-the-whole-set semantics; precedence enforced at a single branch in
`CoverageCalculator`; empty `links` means force-uncovered, terminal-absent means
fall through to computation. **Alternatives:** a delta/add-remove assignment API
(re-introduces "still in effect?" ambiguity, complicates FR-A-12d revert); a
config field on `CoverageConfig` (conflates a high-churn data feed with static
policy). **Rationale:** replace semantics make "what is externally governed" a
pure function of the last call, so override (FR-A-12c) and clean revert
(FR-A-12d) are trivial set diffs; the single merge-point guarantees "no merge,
per-terminal." Trade-off: consumers must send the full set each update —
acceptable for an authoritative feed and far simpler to reason about.

### Decision D: Recompute every tick with broad-phase culling, no tick-skipping
**Chosen:** subscribe to `clock.onTick` inside the render loop; recompute the
covered set every tick; use horizon culling + a static terminal spatial index +
per-beam footprint bounding caps to avoid the full 5M-test Cartesian product;
**forbid** time-based throttling that could show stale colors across a tick.
**Alternatives:** naive full O(sats×beams×terminals) each tick (correct but
pathological at scale); throttled/every-N-ticks recompute (violates FR-A-19
"correct within one tick"). **Rationale:** FR-A-19/NFR-A-01 mandate
*correctness* at scale while the fps budget is a parked v3 gate — so the design
must be correct and non-pathological, not micro-optimized. Culling exploits that
terminals are **static** in v2 (index built rarely, queried every tick) and that
most terminals are over the horizon for any given satellite. Trade-off: the
index adds memory and add/remove bookkeeping; the *specific* index is left to
the Implementer (NFR-A-01) with the binding requirement being "cull, don't brute
force, stay correct."

### Decision E: Membership vs. rendering split for coverage & link lines
**Chosen:** `CoverageCalculator` computes the covered set + link membership
(pure-ish math); `TerminalManager` applies terminal recolor; a new
`LinkLineManager` owns link-line entities. **Rationale:** preserves
architecture.md §9 Decision 5 (spatial math separate from entity CRUD), keeps
the math unit-testable without Cesium (§5), and avoids deepening the
entity-per-terminal scale debt review.md flagged by isolating where entities are
created. Trade-off: one extra manager; justified by testability and the clean
disable/revert path.

---

## 7. Amendments to architecture.md (deltas for the PM — not edited here)

Exact sections of the approved v1 architecture.md this v2 design adds to/changes.
**architecture.md is not modified by this document**; these are for the PM to
apply on v2 sign-off.

1. **§3 Module / Package Structure** — add `core/models/coverage-assignment.model.ts`;
   add `engines/cesium/managers/beam.manager.ts` and `link-line.manager.ts`; add
   `engines/cesium/services/coverage-calculator.ts`. (The §3 tree already lists
   `beam.manager.ts` and `coverage-calculator.ts` as planned; v2 makes them real
   and adds `link-line.manager.ts` + the new model.)
2. **§4.2 Domain Model — `BeamDefinition`** — replace the flat `halfAngle`
   field with a **required** `geometry: BeamGeometry` discriminated union;
   `halfAngle` is **removed** (clean break, OQ-1). Add the `BeamGeometry` union
   types.
3. **§4 Domain Model** — add the new `CoverageAssignment` /
   `TerminalCoverageAssignment` / `CoverageLink` types (§2.2). Note
   `CoverageConfig` is **unchanged** (only its "post-v1" TSDoc → "v2", a
   comment-only nit per requirements §7).
4. **§5.1 RenderingEngine** — add three methods:
   `setCoverageComputationEnabled`, `setCoverageAssignment`,
   `clearCoverageAssignment`. Note `setCoverageConfig`/`setLinkLinesVisible`
   stubs become real (FR-A-18).
5. **§6.1 CesiumGlobeComponent** — add `@Input() coverageComputationEnabled` and
   `@Input() coverageAssignment`. **§6.2 CesiumGlobeService** — add the three
   mirrored pass-through methods.
6. **§7 CesiumJS Engine Internals (manager table)** — correct the `BeamManager`
   row: beams render **independently of coverage**; `BeamManager` does **not**
   trigger `CoverageCalculator` (the v1 sketch coupled them — §3.1). Add a
   `LinkLineManager` row. Refine `CoverageCalculator` to the FR-A-09d
   3D-cone+occlusion test, clock-tick cadence, external-override branch, and
   lazy construction.
7. **§8 Extension Points** — note beam geometry is now extensible via new
   `BeamGeometry` union members (no breaking change), and external coverage
   assignment is a new consumer input.
8. **§9 Key Design Decisions** — append Decisions A–E (§6 here) as the v2
   decision record, in the same style.
9. **§10 v1 Scope Boundary** — historical; unchanged. (v2 scope lives in
   requirements-v2.md, not here.)

---

## 8. Open questions for the user/PM

Genuine architectural decisions that would benefit from a user call before
Implementation. None block design approval; defaults are recommended so the
phase can proceed if the user simply ratifies them.

- **OQ-1 (backward-compat for `halfAngle`). RESOLVED — CLEAN BREAK.** The user
  chose to **remove** `halfAngle` and **require** `geometry` (safe — the v1 beam
  surface was a stub that threw "not implemented"). Reflected throughout §2.1,
  §2.4, §3.1.E, Decision A, and §7 #2.

- **OQ-2 (SatelliteManager update consistency). RESOLVED — APPROVED (PM,
  internal).** Beam sync is routed through `BeamManager` independently of the
  satellite-entity rebuild so beams survive a model-only update (FR-A-06). No
  API impact.

- **OQ-3 (elliptical-cone primitive). RESOLVED — DEFERRED to Implementation
  (PM).** The Cesium primitive choice for the elliptical cone stays behind the
  `beam.manager.ts` boundary; the real-Cesium smoke test (§5) validates it. No
  user constraint imposed on fidelity-vs-performance.

All three open questions are **RESOLVED**; nothing blocks the Architecture gate.
