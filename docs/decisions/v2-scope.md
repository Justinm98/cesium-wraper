# Decision Record: v2 Scope

**Date:** 2026-06-20
**Status:** Approved by user (final authority per [agent-charter.md](agent-charter.md))
**Phase:** v2 Requirements — scoping

---

## Context

v1 shipped the MVP (satellites + terminals + realtime orbits). Every other
feature in [../requirements.md](../requirements.md) was designed into the
public API and stubbed in the engine with explicit "not implemented" errors.
Starting v2 required choosing which of that designed-but-stubbed backlog to
build now.

## Decisions

### 1. v2 scope = Epic A (Beams & Coverage) only

Beam footprints (§3.5) and coverage visualization (§3.6). The remaining
epics — Interaction (B), Time & Data (C), Models & Scale (D) — are parked in
the v3+ backlog.

**Why:** Beams & coverage are the core satellite-digital-twin differentiator,
depend on no other stubbed feature, and build directly on the v1 satellite/
terminal entities. A narrow release keeps the phase-gated process tractable.

### 2. Alternate rendering engines dropped as a product goal

[../product-vision.md](../product-vision.md) previously named MapLibre and
OpenLayers as future engines. v2 commits to **Cesium-only**.

**Why:** Engine swappability is not a near-term need and was driving cost
without a consumer. The `RenderingEngine` interface is **retained** as
internal structure and a unit-test seam (the mock boundary), but it is no
longer a marketed promise. Removing it from the vision avoids implying a
capability we will not maintain.

**Implication:** No architecture is being torn out. If a real second-engine
need appears later, the interface is still there to build against.

### 3. v2 adds one quality gate: a real-Cesium smoke test

A Playwright/WebGL integration test that drives the actual Cesium engine, on
top of the existing v1 bar (≥90% coverage, lint clean, green build).

**Why:** v1's review flagged that the unit-test mock boundary lets a Cesium
upgrade silently break entity/geometry shapes. Beams add new geometry, which
raises that risk. A scale benchmark and the multi-globe fix (M1) were
*considered and deferred* to the backlog — not part of v2's release bar.

## Consequences

- [roadmap.md](../roadmap.md) and [project-status.md](../project-status.md)
  updated to reflect this scope.
- [product-vision.md](../product-vision.md) updated to drop engine swapping.
- v2 remains at the Requirements gate; Architecture for `BeamManager` /
  `CoverageCalculator` may not begin until v2 Requirements are signed off.
