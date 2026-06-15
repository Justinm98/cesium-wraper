# Requirements: Cesium Wrapper Library

**Status:** Approved  
**Date:** 2026-06-11  
**Author:** Requirements Analyst (via interview)

---

## 1. Personas

| Persona | Description |
|---|---|
| **Internal Developer** | Angular 19 developer at the company. Consumes the library to build satellite visualization applications. Configures models, data sources, and UI behavior. |
| **External Customer** | End user of applications built by internal developers. Interacts with the 3D globe at runtime — places terminals, inspects satellites, observes coverage. |

---

## 2. User Stories

- As an **internal developer**, I want to display 3D satellite models at TLE-defined orbital positions so I can build a digital twin visualization without knowing CesiumJS internals.
- As an **internal developer**, I want to display 3D terminal models at lat/lon/alt positions provided via REST API so customers can see ground assets.
- As an **internal developer**, I want to configure beam footprints per satellite so customers can see which terminals are covered.
- As an **internal developer**, I want to provide custom 3D models (e.g., buildings) and place them on the globe at specific coordinates.
- As an **internal developer**, I want the library to emit click/hover events with model data so I can build custom UI panels driven by user interaction.
- As an **external customer**, I want to drag and drop terminals onto the globe so I can quickly configure a digital twin scenario.
- As an **external customer**, I want to see satellites animate along their orbits in real time, historical playback, or future simulation mode.
- As an **external customer**, I want to see which terminals are covered by a satellite beam, indicated by color change and optional link lines.
- As an **external customer**, I want to click or hover on a satellite or terminal to see configurable information about it.

---

## 3. Functional Requirements

### 3.1 Globe & Base Map
- Render a 3D interactive globe using CesiumJS.
- Default to a free tile provider (e.g., OpenStreetMap). No Cesium Ion dependency by default.
- Developers may optionally supply their own Cesium Ion token to override the tile provider.

### 3.2 3D Model Visualization
- Render satellite models in orbital space using TLE data.
- Render terminal models on the ground using lat/lon/alt coordinates.
- Support generic custom 3D model placement (e.g., buildings, infrastructure) via lat/lon/alt.
- Ship default fallback models for satellites and terminals (used when the developer does not supply a custom model).
- Developers may override the default model with their own asset.

### 3.3 Supported 3D Model Formats
- GLTF / GLB (native CesiumJS support).
- CZML (native CesiumJS support).
- OBJ — converted to GLTF at load time via `obj2gltf` (Apache 2.0). No licensing concerns.
- No formats that introduce non-free or GPL-incompatible dependencies.

### 3.4 Orbital Animation
- Animate satellite positions over time using TLE data.
- Support three time modes:
  - **Real-time:** satellites move as wall-clock time advances.
  - **Historical playback:** scrub through a past time window.
  - **Future simulation:** simulate a future orbital scenario.
- Time mode and playback speed must be developer-configurable.

### 3.5 Beam Footprints
- Render a beam as a cone projected from a satellite to a ground ellipse.
- Each beam is defined by pointing angle and beamwidth (provided by developer).
- Up to 10 beams per satellite (nominal case).
- Beam appearance (color, opacity) must be developer-configurable.

### 3.6 Coverage Visualization
- When a terminal falls within a satellite's beam footprint, change the terminal's color.
- Coverage color is developer-configurable per beam or globally.
- Optionally render a link line between the satellite and covered terminal.
- Link lines are toggleable by the end user and/or developer.

### 3.7 Angular Integration
- Expose an Angular standalone component (e.g., `<cesium-globe>`) for embedding the globe.
- Expose an Angular service (e.g., `CesiumService`) for imperative control.
- API is a mix: simple configuration via `@Input()` bindings where appropriate; complex or dynamic control via the service.
- Compatible with Angular 19 and standalone component architecture.
- Designed for forward compatibility as Angular versions increment.

### 3.8 Developer Data Inputs
- Satellite data: TLE strings, with additional developer-supplied configuration (model asset, label, beam definitions, tooltip content).
- Terminal data: lat/lon/alt, with developer-supplied configuration (model asset, label, tooltip content). May also be provided via REST API response.
- Custom model data: lat/lon/alt + model asset path.
- All inputs typed with strict TypeScript interfaces — no `any`.

### 3.9 End-User Interaction
- Drag and drop terminals onto the globe to place them manually.
- Click a 3D model to emit an event containing the model's associated data (developer handles UI).
- Hover over a 3D model to display a configurable tooltip.
- Tooltip content is defined per model in the developer-supplied input data.
- Toggle link line visibility.

### 3.10 Events & Outputs
- Click event: emits model type + associated developer-supplied data object.
- Hover event: emits model type + associated data (used for tooltip or custom UI).
- Terminal placed event: emits lat/lon/alt when an end user drops a terminal.
- All event types exposed as strongly typed Angular `@Output()` EventEmitters.

### 3.11 External API Integration
- Library supports authenticated REST API calls for fetching satellite/terminal data.
- Authentication via Keycloak (OIDC/OAuth2 token injection) must be supported.
- Token provisioning is the developer's responsibility; the library must accept and forward it.

---

## 4. Non-Functional Requirements

### 4.1 Performance
- Nominal target: 100 satellites, 1,000 beams (10 per satellite), 5,000 terminals rendered simultaneously.
- Must run acceptably on machines **without a dedicated GPU** (integrated graphics).
- Optimize draw calls, LOD, and entity management accordingly.
- Target browsers: **Chrome** and **Firefox** (latest stable).

### 4.2 Scale & Configuration
- All scale limits (max satellites, beams, terminals) must be configurable, not hardcoded.

### 4.3 TypeScript
- Strict TypeScript mode throughout. No `any`.
- Full public API documented with TSDoc.
- Tree-shakeable — unused features do not increase bundle size.

### 4.4 Licensing
- All dependencies must be free to use and free to distribute (MIT, Apache 2.0, BSD, or equivalent).
- No GPL or proprietary dependencies.
- CesiumJS: Apache 2.0 ✓
- obj2gltf: Apache 2.0 ✓

### 4.5 Distribution
- Packaged for npm publication (public or private registry).
- Not published yet — built with npm publish workflow in mind (proper `package.json`, `peerDependencies`, build output, etc.).

### 4.6 Testing
- ≥90% code coverage.
- Test-driven development.

### 4.7 Security
- No sensitive orbital or customer data handled by the library itself.
- Developers are responsible for encrypting data in transit.
- Library must support Keycloak token injection for authenticated API calls (see 3.11).

---

## 5. Out of Scope

| Item | Notes |
|---|---|
| Collision detection | Explicitly excluded. |
| Mobile support | Excluded. May be revisited in future. |
| 3D terrain rendering | Excluded for now. |
| Building rendering (built-in) | Custom buildings *can* be loaded via the generic model API (in scope). Prebuilt building datasets are out of scope. |
| Electron support | Excluded for now. May be revisited. |
| 2D map mode | Out of scope. |
| Routing / path planning | Out of scope. |
| Server-side rendering (Angular Universal/SSR) | Out of scope — WebGL requires a browser. |
| Cesium Ion (cloud assets) | Default to free tile provider; Ion is opt-in via developer token only. |

---

## 6. v1 Minimum Viable Scope

The following constitute the minimum shippable feature set for v1:

1. Display satellite default 3D models positioned in space via TLE-derived orbital coordinates.
2. Display terminal default 3D models positioned on the ground via developer-provided lat/lon/alt.
3. Both model types configurable via Angular `@Input()` bindings and service.
4. Globe renders with a free base tile provider.

All features beyond v1 are planned but not required for first customer delivery.
