# QA / Security Review: v2 — Beams & Coverage (Epic A)

**Status:** Reviewed — **shippable after fixes.** 1 HIGH, 5 MEDIUM, 6 LOW. No
security vulnerability in the new code; one pre-existing transitive npm advisory
(L6). Quality bar is green (tsc clean, lint clean, 191/191 tests, 97.71% stmt /
94.92% branch, audit = 1 moderate transitive). The two release blockers are
**H1 (elliptical containment math is wrong on the diagonal — coverage is
incorrect for elliptical beams)** and **M1 (the elliptical *volume* is not an
elliptical cone, contradicting FR-A-01b)**. Everything else is shippable as
documented debt or with a follow-up.

> **Update 2026-06-21 (post-review remediation):** **H1** (elliptical coverage
> math) fixed in `coverage-geometry`; **M4** (per-tick frame hoist) and **M5**
> (explicit coverage tick-listener teardown) fixed; **M1** (elliptical *volume*)
> fixed — the volume is now a local-space `Primitive` with a non-uniform
> `modelMatrix` (a true elliptical cone); **M2** (real-Cesium smoke test, NFR-A-03)
> built and green ([smoke/](../smoke)). The smoke test also caught and fixed a
> Node-only `global.Math` that crashed in the browser, and surfaced a pre-existing
> footprint over-sizing bug (still open). Open: **M3** (one-line decision) and the
> footprint sizing. Unit suite 217 green, ~97.9% stmt / ~95.1% branch; smoke 3 green.

**Date:** 2026-06-20
**Reviewer:** QA / Security Reviewer agent
**Scope:** the v2 Epic A diff (beams, coverage computation, link lines, external
assignment, the 3 new public methods, 2 new `@Input()`s) against
requirements-v2.md / architecture-v2.md, applying the rigor of review.md.

---

## Verified (what I actually ran/confirmed)

- `npx jest` — **191/191 pass**, 12 suites.
- `npm run lint` — **clean** (no warnings/errors).
- `npx tsc --noEmit -p tsconfig.spec.json` — **clean** (exit 0); no `any` anywhere
  in `src/` excluding mocks/specs (grep confirmed).
- `npm run test:coverage` — **97.71% stmt / 94.92% branch / 96.79% func** overall;
  every new file ≥ 86% branch (NFR-A-05 ≥90% total: met). Per-file: beam.manager
  98.07/97.56, link-line.manager 100/100, coverage-calculator 96.59/86.95,
  coverage-geometry 98.18/90, terminal.manager 100/100.
- `npm audit --omit=dev` — **1 moderate**, `dompurify@3.4.9` transitive under
  `@cesium/engine@26.0.0` (not introduced by v2; see L6).
- **FRs confirmed met by reading code + specs:** FR-A-01/01a, 02, 03, 04, 05,
  06 (diff-not-replace, engine only re-syncs beams when patch carries `beams`),
  07 (atomic over-limit throw before any entity touched), 08 (per-geometry range
  validation), 09a/09b/09c, 09 (covered recolor), 10, 11, 12/12a/12b/12c/12d,
  13, 14, 16 (precedence state machine — verified the permutations in the spec),
  17, 18 (stubs gone), 20, 21. NFR-A-04 (no `any`, TSDoc, lazy calculator),
  NFR-A-06 (no Cesium types in core/ or angular/ — all primitives live in the 3
  engine files).
- **review.md regressions checked — none regressed:** H1 NgZone (`initialize`
  still wrapped in `runOutsideAngular`; coverage tick fires inside Cesium's loop
  — see L1 for the caveat), H2 `initError`, H3 destroy-during-init guard intact
  with the new managers, M3/M4 validation intact, M5 lint, no new `any`.

I independently reproduced the H1 and M1 geometry findings numerically (Node
scripts against the actual `coverage-geometry` formulas); details inline.

---

## Findings

### HIGH

**H1. Elliptical containment is not a true elliptical cone — coverage is
mathematically wrong off the principal axes, and the "equal half-angles collapse
to circular" invariant the code documents is false.**
`isInsideBeam` tests `(θ_az/az)² + (θ_el/el)² ≤ 1` where `θ_az`/`θ_el` come from
`computeBoresightOffsets` as **`atan2(in-plane-projection, along-boresight)`,
each computed independently against the boresight projection**
(coverage-geometry.ts:88-89, 112-115). That is not an orthogonal angular
decomposition: for a vector with both components, each `atan2` divides by the
*same* `along` term, so `θ_az² + θ_el² ≠ offAxisAngle²` except on the pure axes.

I verified numerically: for an **equal** ellipse `(12, 12)` (which the model and
architecture explicitly claim "collapses to the circular case",
beam.model.ts:21-22, architecture-v2 §2.1), points on the true 12° rim at 45°
between the planes evaluate to `(8.55/12)² + (8.55/12)² = 1.015 > 1` and are
**wrongly reported uncovered**. Up to ~0.7% of the rim of a 12° beam is wrongly
excluded; the error grows with beam width (and the asymmetry distorts the actual
covered region for genuinely elliptical beams, not just the equal case).
*Why it matters:* FR-A-09d/FR-A-01b require the covered set to reflect the
configured elliptical geometry; this silently mis-classifies terminals near the
beam edge, and contradicts the documented invariant — a "no hidden magic"
violation. It is **untested**: the only elliptical covered-test
(coverage-calculator.spec.ts:157-165) uses a **nadir, on-axis** terminal where
both components are ~0, and the "collapses to circular" spec
(coverage-geometry.spec.ts:88-94) picks a single interior point, so the bug sits
in a coverage blind spot.
*Fix:* use a true angular decomposition — e.g. `θ_az = asin(dot(dir, azAxis))`,
`θ_el = asin(dot(dir, elAxis))` (small-angle-consistent and exact on the axes),
or test against the actual elliptical-cone surface in the boresight frame; then
add a spec asserting an equal `(h,h)` ellipse and a `circular(h)` agree on a swept
rim (the test I used would have caught it).
*Location:* `src/engines/cesium/services/coverage-geometry.ts:74-118`.

### MEDIUM

**M1. The elliptical *volume* is rendered as a radially-symmetric cone, not an
elliptical cone — FR-A-01b is only half-met (footprint yes, volume no).**
`buildVolume` always emits a `CylinderGraphics` cone sized by
`representativeHalfAngle = max(azimuthHalfAngle, elevationHalfAngle)`
(beam.manager.ts:270-282, 312-321). FR-A-01b: "the rendered **volume** reflects
the two independent beamwidths (an elliptical cone)." Only `buildFootprint`
(the ground ellipse) is elliptical; the solid volume is a circle of the larger
half-angle, so an elliptical beam draws a too-wide symmetric cone over a correct
elliptical footprint.
*Why it matters:* a customer looking at an elliptical beam sees a circular
volume — the headline US-A2b deliverable. The implementer flagged this
(architecture-v2 OQ-3, "elliptical-cone primitive deferred to Implementation");
the code comment at beam.manager.ts:262-269 acknowledges it. It is **not** a
regression but it is an unmet acceptance criterion, and the spec only asserts the
footprint axes differ (beam.manager.spec.ts:64-68), never the volume — so the
gap is invisible in CI.
*Fix:* implement the elliptical cone (parametric triangle-mesh `Primitive` or a
non-uniformly-scaled cone `modelMatrix`, per architecture-v2 §3.1.C) **or** get
explicit PM sign-off to descope the elliptical volume to a documented
approximation for v2. Either way, record the decision; do not ship the
mismatch silently. The NFR-A-03 smoke test (still unimplemented — M2) is where
this must ultimately be pinned.

**M2. NFR-A-03 real-Cesium smoke test does not exist — the mock cannot validate
the highest-risk new shapes.**
NFR-A-03 makes a Playwright/WebGL smoke test a v2 quality gate. None is present
(no `*.e2e`/playwright spec under `src/` or the repo). The unit mock
(`__mocks__/cesium-engine.mock.ts`) stubs `CylinderGraphics`/`EllipseGraphics`/
`PolylineGraphics` as opaque option bags and `Quaternion.fromRotationMatrix` as a
dummy that just stores the matrix (mock.ts:114-144), so several assertions are
**mock-shaped, not behavior-shaped**:
- beam orientation correctness (the `Matrix3`→`Quaternion` and Cesium's
  cylinder-along-+Z convention) is never verified against real Cesium;
- whether real Cesium accepts the `CylinderGraphics({length, topRadius:0,
  bottomRadius, …})` and `EllipseGraphics({fill:false, outline:true})` option
  shapes for the shipped `@cesium/engine@26` is unverified (exactly the
  upgrade-breakage class review.md "Forward-looking" called out);
- `TerminalManager.setCoverageColor` assigns a **plain `Color`** to
  `entity.model.color` and `undefined` to clear (terminal.manager.ts:107-119) via
  an `as unknown as` cast — real Cesium types `ModelGraphics.color` as a
  `Property`; whether the bare-`Color`/`undefined` assignment recolors and clears
  identically to the mock is untested.
*Why it matters:* a green unit suite can coexist with a broken render for beams,
orientation, or recolor. This is the documented rationale for the gate.
*Fix:* implement the NFR-A-03 smoke test exercising (a) circular + elliptical
beam render, (b) enable→recolor→move→revert, (c) link-line toggle, against real
Cesium. Until then the geometry/orientation/recolor paths are **not** validated.

**M3. External assignment is inert while computation is disabled — FR-A-12a does
not clearly require computation to be ON, but the implementation does.**
`setCoverageAssignment` stores the payload but only recomputes
`if (this.enabled)` (coverage-calculator.ts:122-127); the same gating applies on
lazy construction. So a consumer who supplies an authoritative external
assignment with `coverageComputationEnabled=false` sees **nothing colored or
linked**. FR-A-12b/12c are phrased "GIVEN coverage computation is enabled," but
FR-A-12a ("the globe uses that assignment to drive terminal coloring and link
lines") is not so qualified, and the whole point of an external feed is to avoid
per-tick math. This is an ambiguity the implementation resolved silently toward
"computation must be on."
*Why it matters:* a plausible consumer use case (drive coloring purely from an
authoritative feed, no geometry math) is silently a no-op; there is no error and
no doc saying "enable computation to use assignments."
*Fix:* either (a) confirm with the PM that external assignment requires
computation enabled and **document it** on `setCoverageAssignment` TSDoc and the
`@Input()`, or (b) make assignment apply standalone (color/link the named
terminals even when geometric computation is off). Add a spec for the chosen
behavior — there is currently none for assignment-while-disabled.

**M4. Coverage recompute is O(satellites × beams × terminals) with only a
per-satellite horizon cull — no terminal spatial index, and it allocates a fresh
boresight frame per (beam × terminal) every tick.**
`coveredFromComputation` loops every terminal × every satellite, applies one
`hasLineOfSight` cull, then `satelliteCovers` loops every beam and calls
`computeBoresightFrame` **inside the per-terminal loop**
(coverage-calculator.ts:198-251). The frame depends only on (satellite, beam),
not the terminal, yet it is recomputed for every terminal — at 100×10×5000 that
is up to 5,000,000 `computeBoresightFrame` calls/tick, each allocating several
`Vec3` objects, plus a `Map` rebuild (`indexAssignment`) and two `Set`s per tick.
The architecture (Decision D, §3.2.C) *mandated* "broad-phase culling … a static
terminal spatial index + per-beam footprint bounding caps … cull, don't brute
force." Only the horizon dot-product cull landed; the static index and footprint
caps are absent.
*Why it matters:* NFR-A-01 makes **correctness** at 5k the v2 bar (fps is a
parked v3 gate), so this is not a v2 *failure* — but it is a documented
architectural requirement not implemented, and the per-tick allocation pattern
(millions of short-lived `Vec3`s + frames) will thrash GC and is the kind of
pathological pattern NFR-A-02 asks to avoid. It also leaves the v3 fps gate with
more work than the design intended.
*Fix (cheap, in-scope now):* hoist `computeBoresightFrame` out of the terminal
loop — compute each (satellite, beam) frame **once per tick**, then test all
terminals against it. That alone removes the dominant allocation/compute without
adding an index. Record the missing spatial index / footprint caps as accepted
v2 debt toward the v3 gate (consistent with NFR-A-01).

**M5. `destroy()` drops the `CoverageCalculator` without removing its
`clock.onTick` listener — it relies entirely on Cesium destroying the clock.**
`destroy()` sets `this.coverage = undefined` (cesium-rendering-engine.ts:156-158)
but never calls `coverage.setEnabled(false)`, so the calculator's `unsubscribe`
handle (coverage-calculator.ts:67, 86-90) is discarded un-invoked. In practice
`widget.destroy()` destroys the `Clock` and its `onTick` `Event`, so no listener
survives — but this is implicit coupling, not a guarded teardown, and it is
**untested** (the destroy specs never enable coverage first, then assert
`listenerCount === 0` after destroy). If the destroy order ever changes, or a
future path reuses the clock, this becomes a per-tick leak calling `recompute()`
on torn-down managers.
*Why it matters:* review.md L4 (subjects not completed) is the same family of
lifecycle laxity; the v2 surface adds a live per-tick listener and should tear it
down explicitly and prove it.
*Fix:* in `destroy()`, call `this.coverage?.setEnabled(false)` **before** dropping
the reference (and before `widget.destroy()`); add a spec: enable coverage →
destroy → assert `clock.onTick.listenerCount === 0`.

### LOW

**L1. NgZone safety of the per-tick recompute rests on an untested,
non-obvious invariant.** `clock.onTick.addEventListener` is called from
`setEnabled`, which runs **inside** the Angular zone when reached via
`ngOnChanges → setCoverageComputationEnabled` (the component does not wrap these
in `runOutsideAngular`; cesium-globe.component.ts:159-161). This is *correct* —
zone.js keys re-entry off where the listener *fires* (Cesium's rAF loop, started
under `runOutsideAngular` in `initialize`), not where it was registered — so
NFR-A-02/H1 hold. But it is subtle and the mock cannot prove it (no real
zone/rAF). *Fix:* add a brief comment at the registration site stating the
listener fires in Cesium's loop (outside the zone), and cover it in the M2 smoke
test (assert no change-detection per tick).

**L2. Beam fill silently ignores the `ColorConfig.a` channel.** `resolveFill`
builds `Color.fromBytes(r,g,b,255).withAlpha(opacity)` (beam.manager.ts:300-304),
so a consumer who sets `color.a` *and* omits `opacity` gets alpha 0.3, and a
consumer who sets `color.a` expecting it to apply is ignored. Defensible (the
model has a separate `opacity` field that is the documented alpha source for
beams), but the dropped channel is hidden. *Fix:* document on
`BeamDefinition.color` that the fill alpha comes from `opacity`, not `color.a`
(or fall back to `color.a` when `opacity` is omitted).

**L3. `link-line.manager.setColor` clears all drawn lines on every color set.**
`setColor` calls `this.clear()` (link-line.manager.ts:59-62), and the engine
calls `setColor` on **every** `setCoverageConfig` (cesium-rendering-engine.ts:219).
So any coverage-config change (e.g. changing only `coveredColor`) tears down and
rebuilds every link line next tick. Correct (within one tick), but unnecessary
churn at scale. *Fix:* only `clear()` when the color actually changed.

**L4. Duplicate `CoverageLink`s in an assignment produce duplicate link pairs.**
`coveredFromAssignment` pushes one pair per link with no de-dup
(coverage-calculator.ts:191-194); two identical `{satelliteId}` links for one
terminal yield two `LinkPair`s with the same id. `LinkLineManager.sync`
de-dupes by entity id (Set), so no double entity is created — but the pair list
carries redundant entries. Harmless today; *fix:* de-dup links per terminal, or
note it as accepted.

**L5. Assignment referencing an unknown terminal/satellite/beam is silently
ignored / unvalidated.** An assignment for a `terminalId` not in the scene is a
no-op (the recompute loop iterates *scene* terminals, so a phantom id is never
visited); a `satelliteId` in `links` that does not exist still draws a link line
to a satellite endpoint that resolves to `[]` (link-line.manager.ts:114-117 →
empty positions, no visible line). No error, no warning. Consistent with the
"override is authoritative data" stance, but a typo in the feed fails silently
("no hidden magic" tension, cf. review L7). *Fix:* document that unknown ids in
an assignment are silently dropped, or warn. Add a spec for the unknown-id case
(currently none).

**L6. `dompurify@3.4.9` moderate advisory (GHSA-cmwh-pvxp-8882), transitive via
`@cesium/engine@26`.** Not introduced by v2 and not in any path the wrapper
uses (Cesium's InfoBox/credit sanitization; the wrapper renders no Cesium
HTML chrome — `CesiumWidget`, sky/InfoBox off). `npm audit fix` would touch the
Cesium pin. *Fix:* track for the next Cesium bump; document as accepted, not a v2
defect.

**L7. review.md L4 still open — engine `Subject`s are never `complete()`d on
`destroy()`.** `entityClick/Hover/terminalPlaced` subjects
(cesium-rendering-engine.ts:93-95) are not completed in `destroy()`. Accepted in
v1; v2 did not fix it and adds no new subject, so not a regression — re-flagged
because v2 is the lifecycle-touching epic where it would naturally be closed
(pairs with M5).

---

## Forward-looking (not v2 defects)

- **Spatial index / footprint caps (M4) feed the v3 fps gate.** The static
  terminal index and per-beam bounding caps the architecture recommended are the
  right v3 work; landing the cheap frame-hoist now (M4 fix) keeps v3 honest.
- **Elliptical-cone volume primitive (M1)** is the exact thing the NFR-A-03
  smoke test was meant to de-risk; build them together.
- **`setCoverageColor` typing escape hatch.** The `as unknown as {model?:{color?}}`
  cast (terminal.manager.ts:111) trades strict typing for mock/real parity. A
  narrow internal `CoverageColorable` interface over the real `Entity` would keep
  it honest; low priority while M2 is open.
- **Multi-globe (review M1)** still unaddressed; v2 adds engine-singleton state
  (`coverage`, `coverageAssignment`) that would also collide across two globes.
  Unscheduled per requirements §5; note for whenever multi-globe lands.

---

## Recommendation

**Shippable after fixes.** The engineering quality is high — strict types, no
`any`, clean lint, 97.7%/94.9% coverage, the FR matrix is almost entirely met,
and every v1 review finding that was fixed stays fixed (H1/H2/H3, M3/M4). But two
items are **release blockers** because they make a headline v2 capability
*incorrect*, not merely incomplete:

1. **H1 — elliptical coverage math is wrong off-axis** (and its documented
   invariant is false). Fix the angular decomposition + add the swept-rim spec.
2. **M1 — the elliptical *volume* is a circular cone**, so FR-A-01b is unmet for
   the volume. Either implement the elliptical cone or get explicit PM descope
   sign-off and document it.

**Strongly recommended before the Review gate (not strict blockers):** **M2**
(stand up the NFR-A-03 smoke test — it is a *named v2 quality gate* and is the
only thing that can actually validate H1/M1/recolor against real Cesium; if the
PM holds the gate firm, M2 is also a blocker), **M5** (explicit tick-listener
teardown + spec), and the cheap half of **M4** (hoist `computeBoresightFrame` out
of the per-terminal loop). **M3** needs a one-line PM decision + doc.

The LOWs are documentation/robustness polish and can ride a follow-up. No
architecture change is required; no security defect was found in the new code.
