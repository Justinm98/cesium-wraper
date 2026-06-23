# Decision Record: M3 — external coverage assignment vs. the computation toggle

**Date:** 2026-06-23
**Status:** Approved by user (final authority per [agent-charter.md](agent-charter.md))
**Phase:** v2 Testing / QA — resolving review-v2 finding M3

---

## Context

[review-v2.md](../review-v2.md) M3 flagged an ambiguity in FR-A-12. An external
coverage assignment (`setCoverageAssignment`) is a per-terminal, authoritative
override of engine-computed coverage. But the requirement is internally
inconsistent about what happens when **coverage computation is disabled**:

- **FR-A-12a** (the input contract) is **not** qualified by the computation
  toggle — "the globe uses that assignment to drive terminal coloring and link
  lines for the named terminals."
- **FR-A-12b / FR-A-12c** **are** qualified ("WHEN coverage computation is
  enabled").
- **FR-A-12d** already anticipates the disabled case ("revert … to their model
  default appearance **if computation is disabled**").
- **FR-A-13** lists a covered pair as coming from "coverage computation **(or an
  external assignment)**."

The as-built implementation took the narrow reading: the assignment was stored
but **inert** unless computation was enabled. A consumer wanting to drive
coloring purely from an authoritative feed (and avoid all per-tick geometry) saw
nothing — a silent no-op. (A prior code comment had pre-emptively described this
as a settled "user decision"; it was not — M3 was still open in the status docs.)

## Decision

**Option A — the external assignment applies standalone, independent of the
computation toggle.**

- With computation **OFF**: the assignment still colors/links its named
  terminals; unnamed terminals stay at their model default and **no geometry
  runs** for them.
- With computation **ON**: unchanged — unnamed terminals fall back to the
  engine's own FR-A-09d computation (FR-A-12b), assigned terminals are overridden
  (FR-A-12c).

**Why:** it is the only reading consistent with the unqualified FR-A-12a and the
12d/13 wording, and it honors the purpose of an external feed — drive coloring
from authoritative data **without** paying for per-tick geometry. The narrow
"must enable computation" reading forced a feed-only consumer to also run the
O(satellites × beams × terminals) engine for every terminal, which is contrary
to intent.

**Rejected alternatives:** (B) ratify the as-built "requires computation ON" and
document it — lowest effort but silently narrows FR-A-12a and blocks the
feed-only use case; (C) keep as-built but throw/warn when an assignment is
supplied while disabled — removes the silent trap but still blocks the use case.

## Consequences

- **`CoverageCalculator`**: the geometric computation is gated by `enabled`, but
  the assignment is applied on every `recompute` regardless. A non-empty
  assignment subscribes to the clock tick on its own (so it tracks scene changes
  while computation is off); a fully-idle calculator (disabled, no assignment)
  holds no listener (NFR-A-04). A new `destroy()` unconditionally tears the
  listener down and reverts everything — distinct from `setEnabled(false)`, which
  may keep a listener alive for a live assignment (preserves review-v2 M5).
- **`CesiumRenderingEngine`**: `setCoverageAssignment` now constructs the
  calculator lazily for a **non-empty** assignment even if computation was never
  enabled; an empty assignment with no existing calculator stays lazy
  (beams-only consumers still pay nothing, NFR-A-04). `destroy()` routes through
  the calculator's `destroy()`.
- **Requirements:** [requirements-v2.md](../requirements-v2.md) FR-A-12a clarified
  to state the behavior is independent of the computation toggle.
- **Tests:** calculator + engine specs added for standalone apply, "assigned-only
  while disabled," clear-while-disabled teardown, assignment-before-config
  deferral, and `destroy()` with a live assignment.
