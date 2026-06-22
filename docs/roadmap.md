# Roadmap

**Owner:** Project Manager agent
**Last updated:** 2026-06-20
**Process:** Requirements → Architecture → Implementation → Testing/QA → Review.
No phase may be skipped; no coding begins before Requirements **and** Architecture
for that release are approved by the user (final authority — see
[decisions/agent-charter.md](decisions/agent-charter.md)).

---

## Release timeline

| Release | Theme | Status |
|---|---|---|
| **v1** | Satellites + terminals on a globe, realtime orbits | ✅ Shipped & QA-verified (2026-06-12) |
| **v2** | **Beams & Coverage** (Epic A) | 🟡 In progress — **Requirements gate** |
| v3+ | Interaction, Time & Data, Models & Scale, perf | ⚪ Backlogged (not started) |

---

## v1 — Shipped

Delivered the MVP scope from [requirements.md](requirements.md) §6 and
[architecture.md](architecture.md) §10. Full detail in
[project-status.md](project-status.md). Verified in [review.md](review.md):
101 tests, ~98% coverage, lint clean, publishable build.

Phase log:

| Phase | Status |
|---|---|
| Requirements | ✅ Approved 2026-06-11 |
| Architecture | ✅ Approved 2026-06-11 |
| Implementation | ✅ Complete |
| Testing / QA | ✅ Complete (94 tests at review, 101 now) |
| Review | ✅ Complete 2026-06-12; H1–H3, M3–M6 remediated |

---

## v2 — Beams & Coverage (current release)

**Scope (user-approved 2026-06-20):** Epic A only.

In scope:
- Beam footprints — cone projected from a satellite, defined by pointing
  angle + beamwidth, up to 10 per satellite, color/opacity configurable
  ([requirements.md](requirements.md) §3.5).
- Coverage visualization — recolor a terminal when it falls inside a beam;
  optional link line between satellite and covered terminal; link-line
  visibility toggle ([requirements.md](requirements.md) §3.6).

The public API for these already exists in `core/` and is stubbed in the
engine (`setCoverageConfig`, `setLinkLinesVisible`, `BeamDefinition`,
`CoverageConfig` throw explicit "not implemented in v1" errors today). v2
replaces those stubs with real implementations.

**v2 release quality gate** (in addition to the v1 bar — ≥90% coverage,
lint clean, green build):
- A real-Cesium Playwright/WebGL **smoke test** so a Cesium upgrade cannot
  silently break entity/geometry shapes behind the unit-test mock boundary.

### v2 phase log

| Phase | Status | Gate to advance |
|---|---|---|
| **Requirements** | ✅ **Approved 2026-06-20** | Done — see [requirements-v2.md](requirements-v2.md) (APPROVED; all OQs resolved) |
| **Architecture** | ✅ **Approved 2026-06-20** | Done — see [architecture-v2.md](architecture-v2.md) (APPROVED); deltas folded into [architecture.md](architecture.md) header |
| **Implementation** | ✅ **Complete 2026-06-20** | Done — PM-verified: tsc clean, lint clean, **191/191 tests** (+90), ~97.7% stmt / 94.9% branch coverage, ng-packagr build green |
| **Testing / QA** | 🟡 **In progress** | QA review (docs/review-v2.md). The real-Cesium Playwright/WebGL smoke test (NFR-A-03) is **built & green** (2026-06-21, [smoke/](smoke/)); review-v2 blockers H1/M1 resolved, M2 met. Remaining: M3 decision + the footprint-sizing fix surfaced by the smoke test. |
| Review | ⚪ Not started | — |

**Implementation outcome (2026-06-20):** New engine internals
`beam.manager.ts`, `link-line.manager.ts`, `coverage-calculator.ts`, pure-math
`coverage-geometry.ts`; new `coverage-assignment.model.ts`; revised
`beam.model.ts` (required `geometry`, `halfAngle` removed); +3 engine/service
methods and +2 component `@Input`s; both v1 coverage stubs replaced. Verified by
the PM (not just self-reported). One known visual approximation flagged for QA:
the elliptical *volume* renders as a cone sized to the larger half-angle while
*coverage computation* uses the true elliptical test — to be pinned down by the
real-Cesium smoke test. **Resolved 2026-06-21 (M1):** the volume is now a
local-space `Primitive` placed by a non-uniform `modelMatrix` (a true elliptical
cone), validated by the NFR-A-03 smoke test; the volume is also visibility-
toggleable (FR-A-01d, default off).

**Architecture outcome (2026-06-20):** discriminated-union beam `geometry`
(clean break — `halfAngle` removed); coverage computation behind a dedicated
`setCoverageComputationEnabled` toggle with lazy `CoverageCalculator`
construction; external override via wholesale-replace `setCoverageAssignment` /
`clearCoverageAssignment`; new `BeamManager` / `LinkLineManager` /
`CoverageCalculator` internals; `BeamManager` decoupled from coverage. Full
public-surface delta in [architecture-v2.md §2.4](architecture-v2.md).

**Requirements outcome (2026-06-20):** v2 = beams + coverage, with three
user-driven refinements that become the Architect's inputs — (1) beam geometry
is **configurable** (circular cone + elliptical, extensible), a change to
`BeamDefinition`; (2) coverage **computation is opt-in/toggleable**, independent
of always-on beam visuals; (3) an **external terminal→beam coverage-assignment**
override (per-terminal, no merge). Link lines are per-pair, default-off,
toggleable. See [requirements-v2.md §7](requirements-v2.md) for the API deltas.

> **PM gate note:** Architecture work (geometry approach, clock-tick
> coverage recompute strategy, perf implications of cone geometry) must not
> begin until the Requirements phase above is signed off. The existing
> requirements text is a starting point, not an approval.

### Known v2 design considerations (raised, not yet decided)

Carried from [review.md](review.md) — to be resolved during the v2
Architecture phase, not pre-decided here:
- Beam-terminal intersection runs on the clock tick; recompute cost scales
  with satellites × beams × terminals. Needs a strategy before build.
- Link lines and coverage recoloring touch the entity-per-terminal pattern
  the review flagged as a scale risk; design should not deepen that debt.

---

## v3+ Backlog (parked, not scheduled)

Designed in v1's public API and stubbed in the engine, deferred out of v2:

- **Epic B — Interaction:** click/hover events, tooltips (must render via
  text nodes, never `innerHTML` — XSS), drag-drop terminal placement.
- **Epic C — Time & Data:** historical playback, future simulation,
  REST fetching with Keycloak/OIDC token injection (`AuthTokenProvider`).
- **Epic D — Models & Scale:** OBJ + CZML formats, custom entities,
  LOD/instancing to hold 5,000 entities on integrated GPUs.

Carried review items, unscheduled:
- **Scale benchmark gate** — measured 5k-entity / integrated-GPU budget.
- **Multi-globe (M1)** — more than one `<cesium-globe>` per app.
- Open v1 review items M1, M2 (code), L1–L7 ([review.md](review.md)).

### Dropped from scope

- **Alternate rendering engines (MapLibre / OpenLayers).** Removed as a
  product goal 2026-06-20 (see [product-vision.md](product-vision.md) and
  [decisions/v2-scope.md](decisions/v2-scope.md)). The `RenderingEngine`
  interface is retained as internal structure and a test seam, not as a
  promise of engine swappability.
