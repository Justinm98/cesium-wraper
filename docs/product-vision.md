# Product Vision

This library exists to shield enterprise applications from direct CesiumJS dependency.

Applications should depend on abstractions.

The implementation engine should be replaceable.

Potential future implementations:

- CesiumJS
- MapLibre
- OpenLayers

Consumers should interact with a stable API regardless of rendering engine.
