# Product Vision

This library exists to give enterprise Angular applications a stable,
strongly-typed API for satellite digital-twin visualization without exposing
CesiumJS details to consumers.

Applications depend on the library's abstractions, not on Cesium types
directly. Cesium remains an internal implementation detail behind the
`RenderingEngine` interface — which keeps the codebase layered and testable.

## Rendering engine

**The product is Cesium-only.** (Decision 2026-06-20 —
[decisions/v2-scope.md](decisions/v2-scope.md).)

Earlier drafts named MapLibre and OpenLayers as future alternative engines.
That is no longer a product goal: engine swappability is not a committed
capability and will not be marketed or maintained as one. The
`RenderingEngine` interface is kept purely as internal structure and a
unit-test seam, not as a promise that the engine can be replaced.
