# Requirements: v2 — Beams & Coverage (Epic A)

**Status:** APPROVED — 2026-06-20 (user sign-off; Requirements gate closed)
**Date:** 2026-06-20
**Author:** Requirements Analyst agent
**Scope:** v2 — Epic A only (Beam footprints + Coverage visualization + link lines)

**Changelog:**
- 2026-06-20 (rev 3): **APPROVED.** Residual OQ-3 precedence decided by the user
  — external assignment **overrides engine computation per-terminal (no merge)**;
  FR-A-12c finalized (provisional marker removed). All open questions closed; the
  document advances to the Architecture phase.
- 2026-06-20 (rev 2): Revised to fold in the user's decisions on OQ-1…OQ-9
  (obtained via the PM). All Open Questions are now RESOLVED (§6); acceptance
  criteria finalized for: coverage computation as an opt-in toggle independent
  of beam visualization; configurable beam geometry (circular cone +
  elliptical); external terminal→beam coverage-assignment override; per-pair
  toggleable link lines; throw-on-over-limit; concrete appearance defaults; and
  the 3D-cone-plus-occlusion definition of "covered". A new **§7 "API changes
  required for v2"** captures the public-API deltas these decisions introduce.
  One residual sub-question remains flagged (external-vs-computed precedence, §6
  OQ-3) with a recommended default written as a provisional requirement.
- 2026-06-20 (rev 1): Initial v2 draft (Epic A) with OQ-1…OQ-9.

---

## 0. Purpose & boundaries of this document

This document refines [requirements.md](requirements.md) §3.5 (Beam Footprints)
and §3.6 (Coverage Visualization) into individually testable acceptance
criteria for the v2 release. It is a **requirements** artifact only: it does
**not** design `BeamManager`/`CoverageCalculator` internals, choose a geometry
algorithm, or specify a recompute strategy — those belong to the Architecture
phase, which has not started.

The v1 approved requirements (`requirements.md`) and architecture
(`architecture.md`) remain the source of truth for everything outside Epic A.
Where this document needs a decision the existing text does not unambiguously
provide, it raises an **Open Question (§6)** rather than inventing an answer.

> **The user's decisions on OQ-1…OQ-9 have now been obtained (2026-06-20).**
> The functional requirements in §3 are written against those decisions and are
> no longer provisional. The remaining gate is the user's explicit approval of
> this revised requirements set (plus a single residual sub-question, §6 OQ-3,
> for which a recommended default is written as a provisional requirement).
>
> **Guiding decision (the user's stated priority):** the *visual representation*
> of coverage is paramount, and beam **visualization** is independent of
> coverage **computation**. A developer can render beams with **no** coverage
> computation running; coverage computation (recoloring terminals,
> covered/uncovered determination, link lines) is **opt-in / toggleable**.

---

## 1. Personas (unchanged from v1)

| Persona | Relevance to v2 |
|---|---|
| **Internal Developer** | Configures beams per satellite (`BeamDefinition[]`), selects beam geometry (circular cone or elliptical), and the global `CoverageConfig`; chooses whether coverage **computation** is enabled at all; may supply external terminal→beam coverage assignments; toggles link lines programmatically. |
| **External Customer** | Sees beam cones/footprints (always, when configured), observes which terminals are covered (color change, when coverage computation is on), and toggles link-line visibility at runtime. |

---

## 2. User stories (refined for v2)

Carried and narrowed from [requirements.md](requirements.md) §2:

- **US-A1 (developer, beams):** As an internal developer, I want to configure
  one or more beam footprints per satellite so that customers can see the
  region each satellite illuminates — without writing any Cesium geometry code.
- **US-A2 (developer, beam appearance):** As an internal developer, I want to
  set each beam's color and opacity so beams match my application's visual
  language.
- **US-A2b (developer, beam geometry):** As an internal developer, I want to
  choose each beam's geometry — a **circular cone** (single half-angle) or an
  **elliptical** beam (separate azimuth/elevation beamwidths) — so the rendered
  footprint matches the real antenna pattern.
- **US-A2c (developer, beams without coverage):** As an internal developer, I
  want to render beams purely as a visual without any coverage computation
  running, because the visual representation of coverage is my priority and I
  may not want (or be able to afford) per-tick terminal-coverage math.
- **US-A2d (developer, toggle coverage computation):** As an internal developer,
  I want to enable or disable coverage **computation** at runtime so I can turn
  terminal recoloring / covered-set determination on only when I need it.
- **US-A3 (customer, coverage):** As an external customer, I want a terminal to
  visibly change color when it falls inside a satellite's beam so I can tell at
  a glance which ground assets are covered.
- **US-A4 (customer, link lines):** As an external customer, I want an optional
  line drawn between a satellite and each terminal it covers so I can see which
  satellite is serving which terminal.
- **US-A5 (customer/developer, toggle):** As an external customer (or the
  developer on their behalf), I want to toggle link-line visibility on and off
  at runtime without reconfiguring the scene.
- **US-A6 (developer, time-coherence):** As an internal developer, I want
  coverage and beams to stay correct as satellites move along their orbits, so
  the visualization is trustworthy during real-time animation.
- **US-A7 (developer, external coverage assignment):** As an internal developer,
  I want to supply my own data declaring which beam covers which terminal so the
  globe can color terminals and draw link lines from an authoritative external
  source instead of (or overriding) its own computed coverage.

Out-of-scope stories (drag-drop, click/hover, tooltips, playback, REST/auth,
custom entities, OBJ/CZML) are **not** part of v2 — see §5.

---

## 3. Functional requirements (testable acceptance criteria)

Notation: each requirement is GIVEN/WHEN/THEN and individually verifiable. A
"clock tick" means one advance of the engine's simulation clock in real-time
mode (the only time mode shipped in v1). All OQ-n decisions are now RESOLVED
(§6); requirements are no longer provisional except where a requirement is
explicitly marked `(provisional — residual OQ-3)`.

**Two independent feature axes (the central v2 decision).** Per the user's
stated priority, these are decoupled:
1. **Beam visualization** — rendering the cone/footprint volume for a satellite's
   beams. This is *always available* and runs with **no** coverage computation.
2. **Coverage computation** — determining the covered/uncovered set, recoloring
   terminals, and driving link lines. This is **opt-in and toggleable**; when it
   is off, no terminal is recolored and no link line is drawn, yet beams still
   render. See FR-A-09a/09b/09c.

### 3.5 — Beam footprints

**FR-A-01 (beam rendering — always available, no coverage required).**
GIVEN a satellite configured with a `BeamDefinition`,
WHEN the satellite is added to the scene,
THEN a beam visual is rendered originating at the satellite and oriented by the
beam's `azimuth`/`elevation`, **regardless of whether coverage computation is
enabled** (FR-A-09a). The visual is a **translucent solid volume** of the
configured geometry **plus its ground-footprint outline** (RESOLVED OQ-7).

**FR-A-01a (configurable beam geometry — circular cone).**
GIVEN a `BeamDefinition` whose geometry selects a **circular cone** with a
single half-angle,
WHEN the beam renders,
THEN the rendered volume is a right circular cone of that half-angle about the
boresight, and its ellipsoid intersection forms the footprint outline.

**FR-A-01b (configurable beam geometry — elliptical).**
GIVEN a `BeamDefinition` whose geometry selects an **elliptical** beam with
separate **azimuth** and **elevation** beamwidths,
WHEN the beam renders,
THEN the rendered volume reflects the two independent beamwidths (an elliptical
cone), and its ellipsoid intersection forms an elliptical footprint outline.

**FR-A-01c (geometry is selectable and extensible).**
GIVEN the two built-in geometries (circular cone, elliptical),
WHEN a developer configures a beam,
THEN the geometry is selected via an explicit field on `BeamDefinition` (the
concrete field/discriminator shape is for the Architect — see §7), AND the
model is shaped so additional geometries can be added later **without a breaking
change** to existing circular/elliptical configurations.
*(Requirement only — this document does not design the type. §7 flags that
`beam.model.ts` must gain a geometry field/discriminator.)*

**FR-A-02 (multiple beams).**
GIVEN a satellite configured with N beams (1 ≤ N ≤ `maxBeamsPerSatellite`,
default 10),
WHEN the satellite is added,
THEN all N beams render independently, each with its own orientation and
appearance.

**FR-A-03 (beam color + default).**
GIVEN a `BeamDefinition` with a `color` (`ColorConfig`),
WHEN the beam renders,
THEN the beam visual uses exactly that RGBA color; WHEN `color` is omitted,
THEN the documented engine **default beam color** is used: a neutral accent
**cyan `{ r: 0, g: 200, b: 255 }`** (RESOLVED OQ-6), so beams read as volumes on
a bright globe.

**FR-A-04 (beam opacity + default).**
GIVEN a `BeamDefinition` with `opacity` ∈ [0, 1],
WHEN the beam renders,
THEN the beam visual fill is drawn at that opacity; WHEN omitted, the documented
engine **default opacity `0.3`** (translucent fill) is used (RESOLVED OQ-6).
The footprint **outline** (FR-A-01) is drawn at full opacity so the footprint
edge stays legible regardless of fill opacity.

**FR-A-05 (beam follows the satellite).**
GIVEN a satellite animating along its TLE orbit with a beam,
WHEN the simulation clock advances,
THEN the beam's origin and orientation track the satellite's current position
within one clock tick (no stale/detached beams).

**FR-A-06 (beam add/update/remove).**
GIVEN a rendered satellite with beams,
WHEN `updateSatellite(id, { beams })` changes the beam set,
THEN added beams appear, removed beams disappear, and changed beams re-render
with new parameters — without recreating unaffected entities.
*(Consistent with the v1 diff-not-replace principle, architecture.md §6.1.)*

**FR-A-07 (beam count limit handling — throw on over-limit).**
GIVEN a satellite configured with more than `maxBeamsPerSatellite` beams
(default 10),
WHEN it is added or updated,
THEN the engine **throws a clear, typed error** identifying the satellite and
the configured limit, and renders none of that satellite's beams (RESOLVED
OQ-7). Silent clamping is explicitly **disallowed** — it is hidden data loss,
contrary to CLAUDE.md "no hidden magic" and review L7. A spec must cover the
throw path.

**FR-A-08 (invalid beam parameters).**
GIVEN a `BeamDefinition` with out-of-range values — for a **circular cone**:
`halfAngle` ≤ 0 or ≥ 90; for an **elliptical** beam: either azimuth/elevation
beamwidth ≤ 0 or ≥ 90; for any geometry: `opacity` outside [0, 1], or
non-finite `azimuth`/`elevation` —
WHEN the satellite is added or updated,
THEN the engine rejects it with a clear, typed error rather than rendering
garbage — matching the v1 validation style established for terminal positions
and TLEs (review.md M3). Validation applies to whichever geometry the beam
selects (FR-A-01a/01b).

### 3.6 — Coverage computation (opt-in) & visualization

**FR-A-09a (beams render with coverage computation OFF — default).**
GIVEN a satellite with beams and coverage computation **disabled** (the
default — no coverage computation runs unless explicitly enabled),
WHEN the scene renders and the clock advances,
THEN all configured beams render and track their satellites (FR-A-01, FR-A-05),
AND **no** terminal is recolored, **no** covered/uncovered set is computed, and
**no** link line is drawn. (RESOLVED OQ-1: visualization is independent of
computation; the user's priority is the visual representation.)

**FR-A-09b (enable / disable coverage computation at runtime).**
GIVEN a running scene,
WHEN coverage computation is **enabled** (via the coverage-computation toggle —
see §7 for the API surface),
THEN coverage begins evaluating and terminals are recolored per FR-A-09/10/11
within one clock tick; AND WHEN it is subsequently **disabled**,
THEN within one clock tick all coverage recoloring is removed (terminals revert
to their model default appearance) and all engine-drawn link lines are removed,
while beams continue to render unchanged.

**FR-A-09c (covered test governs recolor when computation is ON).**
GIVEN coverage computation is enabled,
WHEN the covered/uncovered set is evaluated,
THEN the governing test is the **3D-cone-containment plus line-of-sight /
Earth-occlusion** test of FR-A-09d (RESOLVED OQ-1), applied per beam against the
beam's configured geometry (FR-A-01a/01b).

**FR-A-09d (definition of "covered" — 3D + occlusion).**
A terminal is **covered** by a beam IF AND ONLY IF (RESOLVED OQ-1):
1. the terminal's **3D position** (lat/lon **and altitude**) lies inside the
   beam's 3D volume for the beam's configured geometry, **AND**
2. the terminal has **line-of-sight** to the satellite — i.e. it is **not**
   occluded by the Earth (a terminal beyond the Earth's limb / below the local
   horizon is **not** covered even if geometrically inside the cone).
Altitude counts; far-side / over-the-horizon terminals are excluded.
*(The geometry/algorithm to implement this test is the Architect's; this is the
required behavior.)*

**FR-A-09 (coverage recolor — covered).**
GIVEN coverage computation is enabled, a `CoverageConfig` with `coveredColor`,
and a terminal that satisfies the FR-A-09d "covered" test for at least one beam,
WHEN coverage is evaluated on a clock tick,
THEN that terminal's color changes to `coveredColor` within one clock tick.

**FR-A-10 (coverage recolor — uncovered).**
GIVEN coverage computation is enabled and a terminal that is **not** covered by
any beam (per FR-A-09d) and not externally assigned as covered,
WHEN coverage is evaluated,
THEN the terminal is shown in `uncoveredColor` if provided, otherwise in its
model's default appearance (no recolor).

**FR-A-11 (coverage transitions both ways).**
GIVEN coverage computation is enabled and a terminal previously covered,
WHEN satellite motion causes it to leave every beam volume (FR-A-09d),
THEN it reverts to the uncovered appearance within one clock tick (coverage is
not "sticky").

**FR-A-12 (coverage config applied at runtime).**
GIVEN a running scene with coverage computation enabled,
WHEN `setCoverageConfig(config)` is called,
THEN coverage coloring reflects the new config on the next evaluation, without
requiring scene teardown.

**FR-A-12a (external coverage-assignment override — input).**
GIVEN the developer supplies **external coverage-assignment data** declaring,
for one or more terminals, which beam(s)/satellite(s) cover them,
WHEN that assignment is applied (via the engine/service surface — see §7),
THEN the globe uses that assignment to drive terminal coloring and link lines
for the named terminals, **instead of** engine-computed coverage for those
terminals (RESOLVED OQ-3). The external assignment is authoritative for the
terminals it names.

**FR-A-12b (engine-computed coverage is the default).**
GIVEN no external coverage assignment has been supplied for a terminal,
WHEN coverage computation is enabled,
THEN that terminal's coverage is determined by the engine's own FR-A-09d
computation (RESOLVED OQ-3). External assignment and engine computation may
therefore coexist across different terminals in the same scene.

**FR-A-12c (external-vs-computed precedence — per-terminal override). RESOLVED.**
GIVEN coverage computation is enabled AND an external assignment names a given
terminal,
WHEN coverage is evaluated for that terminal,
THEN the **external assignment fully replaces** engine computation **for that
terminal** (per-terminal override, not a merge): the terminal is colored/linked
exactly as the external data declares, and the engine does not additionally mark
it covered/uncovered from its own geometry.
*(RESOLVED 2026-06-20 — user chose per-terminal override over merge/union.)*

**FR-A-12d (clearing the external assignment).**
GIVEN an external coverage assignment is in effect,
WHEN it is cleared / replaced with an empty assignment,
THEN affected terminals revert to engine-computed coverage (if computation is
enabled) or to their model default appearance (if computation is disabled),
within one clock tick. No terminal is left "stuck" in an externally-assigned
state after the assignment is removed.

**FR-A-13 (link lines — render, per covered pair).**
GIVEN coverage computation (or an external assignment) yields a covered
(satellite, terminal) pair, AND link lines are currently visible,
WHEN that pair is covered,
THEN **exactly one** link line is drawn **per covered (satellite, terminal)
pair** — so a terminal covered by 3 satellites shows 3 lines (RESOLVED OQ-5,
OQ-4 granularity).

**FR-A-14 (link lines — color).**
GIVEN `CoverageConfig.linkLineColor`,
WHEN a link line renders,
THEN it uses that color; WHEN omitted, a documented engine default is used.

**FR-A-15 (link lines — follow motion).**
GIVEN a visible link line for a covered (satellite, terminal) pair,
WHEN the satellite moves,
THEN the line's satellite endpoint tracks the satellite within one clock tick,
and the line disappears within one clock tick once the pair is no longer
covered.

**FR-A-16 (link lines — default OFF + runtime toggle + precedence).**
GIVEN link lines default to **hidden** (`CoverageConfig.showLinkLines` is the
initial state; the developer must opt in — RESOLVED OQ-4/OQ-5),
WHEN `setLinkLinesVisible(false)` is called, all link lines are hidden within
one clock tick; WHEN `setLinkLinesVisible(true)` is called, lines for currently
covered pairs are shown again within one clock tick.
**Precedence (RESOLVED OQ-4/OQ-5):** an imperative `setLinkLinesVisible(...)`
call is a **runtime override** that **wins over** `CoverageConfig.showLinkLines`
**until the next `setCoverageConfig(...)`**, which re-establishes the config
value as the active state. This toggle is intended to drive a consumer UI button.

**FR-A-17 (multi-beam coverage color — global covered color).**
GIVEN a terminal covered by two or more beams (or satellites) simultaneously,
WHEN coverage is evaluated,
THEN the terminal is colored with the **single global**
`CoverageConfig.coveredColor` — "covered is covered" (RESOLVED OQ-3: default is
a global covered color; no per-beam computed coverage color in v2). Link lines
are still drawn per covered pair (FR-A-13), so multiplicity is conveyed by the
lines, not by color.

**FR-A-18 (stubs replaced).**
GIVEN the v1 engine throws "not implemented in v1" from `setCoverageConfig`,
`setLinkLinesVisible`, and beam rendering,
WHEN v2 ships,
THEN those stubs are replaced by working implementations and the previous
"not implemented" error paths no longer exist for the Epic A surface (including
the new coverage-computation toggle and external-assignment input of §7).

**FR-A-19 (recompute correctness on every tick when enabled).**
GIVEN coverage computation is enabled and satellites are animating,
WHEN the simulation clock advances,
THEN terminal colors (and link-line membership) are **correct on every clock
tick** — i.e. they reflect the FR-A-09d covered set for the satellites' current
positions within one tick (RESOLVED: PM-adopted correctness requirement). Any
internal throttling/dirty-tracking optimization is the Architect's choice and is
acceptable only so long as this "correct within one tick" user-visible behavior
holds. See NFR-A-01 for the scale at which this correctness must hold.

**FR-A-20 (zero-beam satellites are a no-op).**
GIVEN a satellite configured with no `beams` (empty or absent),
WHEN it is added,
THEN it renders normally and contributes **no** beam visual and **no** coverage
— this is a **no-op, not an error** (RESOLVED OQ-8/OQ-9).

**FR-A-21 (empty / no-beam scene coverage is a no-op).**
GIVEN no satellite in the scene has any beam,
WHEN `setCoverageConfig(...)` is called or coverage computation is enabled,
THEN nothing is colored and no link line is drawn — this is a **no-op, not an
error** (RESOLVED OQ-8/OQ-9).

---

## 4. Non-functional requirements (v2)

**NFR-A-01 (recompute correctness under load).**
When coverage computation is enabled, coverage must remain **correct** across
the full nominal scale envelope: 100 satellites × up to 10 beams × **5,000
terminals** (requirements.md §4.1). Recompute **correctness at 5,000 terminals
is a v2 functional requirement** (RESOLVED — PM-adopted), reinforcing FR-A-19.
The *per-tick recompute cost* scales with satellites × beams × terminals
(review.md "Forward-looking"; roadmap.md §"Known v2 design considerations"); the
throttling/perf **strategy** is left to the Architect. The *measured*
5,000-terminal / integrated-GPU **performance budget** (fps) remains parked by
the PM as a **v3 benchmark gate** and is **not** a pass/fail criterion for v2.
(The recompute *cadence* question is RESOLVED as a correctness requirement, no
longer an open question — see §6 OQ-4.)

**NFR-A-02 (integrated-GPU target preserved).**
v2 must not regress the v1 integrated-GPU posture (requirements.md §4.1): no
new per-frame Angular change detection, and beam/link-line geometry must not
introduce unbounded per-frame work that makes a modest scene unusable on
integrated graphics. (Hard frame-rate numbers remain a v3 benchmark.)

**NFR-A-03 (real-Cesium smoke-test quality gate).**
In addition to the v1 bar (≥90% coverage, lint clean, green build), v2 adds a
real-Cesium **Playwright/WebGL smoke test** that exercises beam geometry and
coverage recolor against actual Cesium (not the unit-test mock), so a Cesium
upgrade cannot silently break entity/geometry shapes behind the mock boundary
(roadmap.md §"v2 release quality gate"; review.md "Forward-looking").

**NFR-A-04 (strict typing, TSDoc, tree-shakeable).**
All new public surface remains strict TypeScript with no `any`, carries TSDoc,
and stays tree-shakeable (requirements.md §4.3). Beam/coverage features must
not become mandatory bundle weight for consumers who do not use them.

**NFR-A-05 (test-driven, ≥90% coverage).**
Epic A is built test-first; new code keeps total coverage at or above the 90%
threshold (requirements.md §4.6).

**NFR-A-06 (no engine-type leakage).**
The public API for beams/coverage must continue to expose only `core/` types
(no Cesium types), per product-vision.md and architecture.md §1.

---

## 5. Out of scope for v2 (explicit)

v2 is **Epic A only**. The following are **excluded** and must not be
implemented, designed, or partially wired in during v2:

| Excluded | Epic | Notes |
|---|---|---|
| Click / hover events, tooltips | **B** | Parked. Tooltip XSS concern (text-node rendering) is a B-time requirement, not v2. |
| Drag-drop terminal placement | **B** | Parked. |
| Historical playback / future simulation time modes | **C** | v2 coverage runs in **real-time mode only**, as v1 ships. |
| REST data fetching, Keycloak/OIDC (`AuthTokenProvider`) | **C** | Parked. |
| Custom entities (`addCustomEntity` …) | **D** | Not covered by beams in v2. |
| OBJ / CZML model formats | **D** | Parked. |
| LOD / instancing / point-primitive scale rework | **D** | The 5k-entity scale rework stays a v3 concern (NFR-A-01). |
| Measured 5k-terminal / integrated-GPU **benchmark gate** | — | Parked by PM as a v3 gate (correctness still lands in v2). |
| Multi-globe (>1 `<cesium-globe>` per app, review M1) | — | Unscheduled. |
| Alternate rendering engines (MapLibre/OpenLayers) | — | Dropped as a product goal 2026-06-20. |

Also explicitly carried-forward exclusions from requirements.md §5 (collision
detection, mobile, 3D terrain, 2D mode, routing, SSR, Electron) remain out of
scope.

---

## 6. Open Questions — RESOLVED (2026-06-20 user decisions)

All OQ-1…OQ-9 have been decided by the user (via the PM) and folded into §3/§4.
Each is recorded below with the decision and the FRs that now encode it. One
residual sub-question remains (OQ-3 precedence) with a recommended default
already written into the requirements as provisional (FR-A-12c).

**OQ-1 — Definition of "covered" + coverage is OPTIONAL. RESOLVED.**
Decision: **(c) 3D cone-containment + line-of-sight / Earth-occlusion**;
terminal **altitude counts**; far-side / over-the-horizon terminals are not
covered. **Additionally:** beam **visualization is independent of** coverage
**computation** — coverage computation is **opt-in / toggleable**, and beams
render with computation off. The user's stated priority is the visual
representation of coverage. *Encoded in:* FR-A-09a/09b/09c/09d (toggle +
covered test), FR-A-01 (beams render regardless of computation).

**OQ-2 — Beam geometry is CONFIGURABLE (circular cone + elliptical). RESOLVED.**
Decision: `BeamDefinition` must support **selecting geometry**, with two
built-in geometries for v2 — a **circular cone** (single half-angle) and an
**elliptical** beam (separate azimuth/elevation beamwidths) — shaped for
**extensibility** (more geometries later without breaking the API). *Encoded
in:* FR-A-01a/01b/01c, FR-A-08 (per-geometry validation). *API change:* §7 —
`beam.model.ts` needs a geometry field/discriminator (type design = Architect).

**OQ-3 — Coverage color: global default + external override. RESOLVED (one
residual sub-question).** Decision: default is a **single global**
`CoverageConfig.coveredColor` (no per-beam computed color). **Plus** a NEW
requirement: the developer may supply **external terminal→beam coverage
assignments**; engine-computed coverage is the default when none is given.
*Encoded in:* FR-A-17 (global color), FR-A-12a/12b/12c/12d (external override).
**Precedence — RESOLVED 2026-06-20:** external assignment **overrides** engine
computation **per-terminal (no merge)** (FR-A-12c, now final). *API change:* §7 —
new external-assignment input on the engine/service surface (signature =
Architect).

**OQ-4 — Recompute cadence + 5k correctness. RESOLVED.**
Decision (PM-adopted default; user may revisit): coverage must keep terminal
colors **correct on every clock tick** when computation is enabled
(correctness requirement); throttling/perf **strategy** is the Architect's.
Recompute **correctness at 5,000 terminals is a v2 functional requirement**;
the **measured** 5k / integrated-GPU **fps budget** remains a **v3** benchmark
gate. *Encoded in:* FR-A-19, NFR-A-01.

**OQ-5 — Link lines: per (satellite, terminal) pair, default OFF, toggleable.
RESOLVED.** Decision: **one link line per covered (satellite, terminal) pair**;
**hidden by default**; `setLinkLinesVisible(visible)` toggles at runtime (drives
a consumer UI button) and **overrides** the config value **until the next
`setCoverageConfig`**. *Encoded in:* FR-A-13 (per-pair), FR-A-16 (default-off +
toggle + precedence).

**OQ-6 — Beam appearance defaults. RESOLVED (PM-adopted).**
Decision: when `color`/`opacity` are omitted, default to a **translucent fill** —
concrete defaults set as **color cyan `{ r: 0, g: 200, b: 255 }`, opacity
`0.3`**, with a full-opacity footprint **outline** for legibility. *Encoded in:*
FR-A-03, FR-A-04, FR-A-01.

**OQ-7 — Over-limit policy + visual form. RESOLVED.**
Decision: exceeding `maxBeamsPerSatellite` must **THROW** a clear error (no
silent clamp — CLAUDE.md "no hidden magic / no silent data loss"). Beam visual =
**translucent solid volume + footprint outline**, consistent with the configured
geometry. *Encoded in:* FR-A-07 (throw), FR-A-01 (visual form).

**OQ-8 — Coverage cap. RESOLVED.** Coverage applies to all terminals up to
`maxTerminals` (default 5000); no per-terminal coverage opt-out in v2. *Encoded
in:* NFR-A-01 (scale), FR-A-21.

**OQ-9 — Zero-beam satellites / empty scenes. RESOLVED.** No-ops, not errors.
*Encoded in:* FR-A-20, FR-A-21.

---

## 7. API changes required for v2

Unlike rev 1 (which only *flagged* possible changes), the user's decisions now
**require** the following public-API changes. These are **inputs to the
Architecture phase**; this document states the requirement and does **not**
design the concrete types/signatures (that is the Architect's task). No code is
modified by this document.

**Required changes**

1. **`BeamDefinition` — add a geometry selector (OQ-2).**
   `beam.model.ts` must gain a **geometry field/discriminator** so a beam can
   select **circular cone** (single half-angle) or **elliptical** (separate
   azimuth/elevation beamwidths), and so further geometries can be added later
   without breaking existing configs (FR-A-01a/01b/01c). The current single
   `halfAngle` field is insufficient for the elliptical case; whether to keep
   `halfAngle` for the circular variant and add beamwidth fields for the
   elliptical variant, model it as a discriminated union, or otherwise — is the
   **Architect's** decision. *Requirement: the type must change; the shape is
   not specified here.*

2. **External coverage-assignment input — NEW engine/service surface (OQ-3).**
   There must be a way for the consumer to supply **terminal→beam (and/or
   →satellite) coverage assignments** that the globe uses for coloring/link-lines
   in place of computed coverage (FR-A-12a–12d). This implies a **new method /
   input** on the `RenderingEngine` interface and the mirrored
   `CesiumGlobeService` (and likely a new `@Input()` on `CesiumGlobeComponent`),
   plus a new core model type describing the assignment payload. **Method
   name/signature and payload shape are the Architect's** — flagged here only as
   a required addition.

3. **Coverage-computation toggle — NEW engine/service surface (OQ-1).**
   Because coverage computation is opt-in and independent of beam visualization
   (FR-A-09a/09b), there must be a way to **enable/disable coverage computation**
   at runtime, distinct from `setLinkLinesVisible` and from
   `setCoverageConfig`. This is a **new method/flag** on the engine/service
   surface (and possibly a component `@Input()`). Signature/shape =
   **Architect**. (One option the Architect may consider is folding an
   "enabled" flag into `CoverageConfig`; this document does not mandate the
   mechanism, only the capability.)

**Confirmed sufficient (no change required)**

- **`CoverageConfig` (coverage.model.ts)** — **still suffices** for v2's
  coverage *coloring/link-line* config: a single global `coveredColor`,
  `uncoveredColor`, `showLinkLines`, `linkLineColor` cover OQ-3's default and
  OQ-5's link-line config. (It does **not** itself carry the external-assignment
  payload (#2) or the geometry selector (#1); those are separate surfaces. The
  Architect *may* optionally host the computation-toggle (#3) here.)
- **`setCoverageConfig` / `setLinkLinesVisible`** — existing signatures remain;
  their **v1 "not implemented" stubs** are replaced by working implementations
  (FR-A-18).

**Non-blocking doc nit (not changed here — would touch code):**
`coverage.model.ts` TSDoc says "post-v1 rendering"; on v2 sign-off it should
read "v2". Cosmetic; flagged so it is not forgotten.

---

## 8. Sign-off

**APPROVED 2026-06-20.** The user has explicitly approved this requirements set
for v2 Epic A, and the one residual sub-question (OQ-3 external-vs-computed
precedence, FR-A-12c) is decided — **external overrides per-terminal, no merge**.
All Open Questions are **RESOLVED** (§6); the Requirements gate is **closed**.

The three **API changes required for v2** (§7 — `BeamDefinition` geometry
selector, external coverage-assignment input, coverage-computation toggle) are
the primary inputs to the now-open **Architecture phase**.
