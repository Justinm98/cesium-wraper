# Architecture: Cesium Wrapper Library

**Status:** Approved  
**Date:** 2026-06-11  
**Author:** Architect Agent

---

## 1. Guiding Principles

1. **Engine abstraction is the central constraint.** Per the product vision, CesiumJS is an implementation detail. The public API must not expose any Cesium types. Future engines (MapLibre, OpenLayers) must be drop-in swappable.
2. **Angular depends on core, not on Cesium.** The Angular component and service talk only to the `RenderingEngine` interface. They never import from `@cesium/engine` directly.
3. **No hidden magic.** All configuration is explicit and typed. No global singletons, no implicit mutation.
4. **Composition over inheritance.** Internal managers are composed, not extended.
5. **Tree-shakeable.** Each module has its own entry point. Unused engines are not bundled.

---

## 2. Layered Architecture

```
┌─────────────────────────────────────────────────┐
│                 Angular Layer                   │
│  CesiumGlobeComponent  │  CesiumGlobeService    │
│  provideGlobe()        │  Angular @Input/@Output │
└───────────────────────┬─────────────────────────┘
                        │ depends on
                        ▼
┌─────────────────────────────────────────────────┐
│                  Core Layer                     │
│  RenderingEngine (interface)                    │
│  Domain models + TypeScript interfaces          │
│  No Cesium imports. No Angular imports.         │
└───────────────────────┬─────────────────────────┘
                        │ implemented by
                        ▼
┌─────────────────────────────────────────────────┐
│              CesiumJS Engine Layer              │
│  CesiumRenderingEngine                          │
│  SatelliteManager │ TerminalManager             │
│  BeamManager      │ CoverageCalculator          │
│  ModelLoader      │ TimeController              │
└─────────────────────────────────────────────────┘
```

---

## 3. Module / Package Structure

```
src/
├── core/                        # Pure TypeScript — no Cesium, no Angular
│   ├── models/
│   │   ├── satellite.model.ts   # SatelliteConfig, TleData
│   │   ├── terminal.model.ts    # TerminalConfig
│   │   ├── custom-entity.model.ts
│   │   ├── beam.model.ts        # BeamDefinition
│   │   ├── model-asset.model.ts # ModelAsset, supported formats
│   │   ├── globe-config.model.ts
│   │   ├── time.model.ts        # TimeConfig, TimeMode
│   │   ├── coverage.model.ts    # CoverageConfig
│   │   └── events.model.ts      # EntityEvent, TerminalPlacedEvent
│   ├── interfaces/
│   │   ├── rendering-engine.interface.ts
│   │   └── auth-token-provider.interface.ts
│   └── index.ts                 # Public barrel for core
│
├── engines/
│   └── cesium/                  # CesiumJS adapter — imports @cesium/engine
│       ├── cesium-rendering-engine.ts   # Implements RenderingEngine
│       ├── managers/
│       │   ├── satellite.manager.ts     # Entity CRUD + TLE position updates
│       │   ├── terminal.manager.ts      # Entity CRUD + drag-drop handling
│       │   ├── beam.manager.ts          # Cone/ellipse geometry, coverage triggers
│       │   └── custom-entity.manager.ts
│       ├── services/
│       │   ├── model-loader.service.ts  # GLTF/GLB/CZML native; OBJ→GLTF via obj2gltf
│       │   ├── coverage-calculator.ts   # Terminal-in-beam intersection math
│       │   └── time-controller.ts       # Wraps Cesium.Clock
│       ├── assets/
│       │   ├── default-satellite.glb    # Fallback satellite model
│       │   └── default-terminal.glb     # Fallback terminal model
│       └── index.ts
│
├── angular/                     # Angular 19 standalone integration
│   ├── cesium-globe.component.ts
│   ├── cesium-globe.service.ts
│   ├── provide-globe.ts         # provideGlobe() environment provider
│   ├── tokens.ts                # RENDERING_ENGINE injection token
│   └── index.ts
│
└── index.ts                     # Root public barrel
```

---

## 4. Domain Model

All types are strict TypeScript — no `any`, no optional chains that hide required fields.

### 4.1 Positions & Assets

```typescript
interface GeodeticPosition {
  latitude: number;   // degrees, WGS84
  longitude: number;  // degrees, WGS84
  altitude: number;   // meters above ellipsoid
}

interface TleData {
  line1: string;
  line2: string;
}

type ModelFormat = 'gltf' | 'glb' | 'czml' | 'obj';

interface ModelAsset {
  url: string;
  format: ModelFormat;
}

interface ColorConfig {
  r: number;   // 0–255
  g: number;
  b: number;
  a: number;   // 0–1 alpha
}

interface TooltipConfig {
  enabled: boolean;
  fields?: Record<string, string>; // label → value pairs rendered in tooltip
}
```

### 4.2 Entity Configs

```typescript
interface SatelliteConfig {
  id: string;
  tle: TleData;
  model?: ModelAsset;          // defaults to default-satellite.glb
  label?: string;
  beams?: BeamDefinition[];
  tooltip?: TooltipConfig;
  data?: Record<string, unknown>; // arbitrary developer payload, emitted on click
}

interface TerminalConfig {
  id: string;
  position: GeodeticPosition;
  model?: ModelAsset;          // defaults to default-terminal.glb
  label?: string;
  tooltip?: TooltipConfig;
  data?: Record<string, unknown>;
}

interface CustomEntityConfig {
  id: string;
  position: GeodeticPosition;
  model: ModelAsset;           // required — no default for custom entities
  label?: string;
  tooltip?: TooltipConfig;
  data?: Record<string, unknown>;
}

interface BeamDefinition {
  id: string;
  azimuth: number;       // degrees, clockwise from north
  elevation: number;     // degrees above local horizontal
  halfAngle: number;     // degrees — half the total beamwidth
  color?: ColorConfig;
  opacity?: number;      // 0–1
}
```

### 4.3 Globe & Time Configuration

```typescript
type TimeMode = 'realtime' | 'playback' | 'simulation';

interface TimeConfig {
  mode: TimeMode;
  currentTime?: Date;
  start?: Date;          // required for playback/simulation
  stop?: Date;           // required for playback/simulation
  multiplier?: number;   // time speed, default 1
}

interface TileProviderConfig {
  type: 'osm' | 'custom';
  url?: string;           // required when type is 'custom'
}

interface PerformanceConfig {
  maxSatellites?: number;          // default: 100
  maxTerminals?: number;           // default: 5000
  maxBeamsPerSatellite?: number;   // default: 10
}

interface GlobeConfig {
  tileProvider?: TileProviderConfig; // defaults to OSM
  ionToken?: string;
  performance?: PerformanceConfig;
  auth?: AuthTokenProvider;
}

interface CoverageConfig {
  coveredColor: ColorConfig;
  uncoveredColor?: ColorConfig;
  showLinkLines: boolean;
  linkLineColor?: ColorConfig;
}
```

### 4.4 Events

```typescript
type EntityType = 'satellite' | 'terminal' | 'custom';

interface EntityEvent<T = Record<string, unknown>> {
  entityId: string;
  entityType: EntityType;
  data: T;
}

interface TerminalPlacedEvent {
  position: GeodeticPosition;
}
```

---

## 5. Core Interfaces

### 5.1 RenderingEngine

This is the abstraction boundary. The Angular layer is only ever aware of this interface.

```typescript
interface RenderingEngine {
  // Lifecycle
  initialize(container: HTMLElement, config: GlobeConfig): Promise<void>;
  destroy(): void;

  // Satellites
  addSatellite(config: SatelliteConfig): void;
  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void;
  removeSatellite(id: string): void;

  // Terminals
  addTerminal(config: TerminalConfig): void;
  updateTerminal(id: string, patch: Partial<TerminalConfig>): void;
  removeTerminal(id: string): void;

  // Custom entities
  addCustomEntity(config: CustomEntityConfig): void;
  updateCustomEntity(id: string, patch: Partial<CustomEntityConfig>): void;
  removeCustomEntity(id: string): void;

  // Time
  setTimeConfig(config: TimeConfig): void;

  // Coverage
  setCoverageConfig(config: CoverageConfig): void;
  setLinkLinesVisible(visible: boolean): void;

  // Event streams
  readonly entityClick$: Observable<EntityEvent>;
  readonly entityHover$: Observable<EntityEvent>;
  readonly terminalPlaced$: Observable<TerminalPlacedEvent>;
}
```

### 5.2 AuthTokenProvider

```typescript
interface AuthTokenProvider {
  getToken(): Promise<string>;
}
```

Developers implement this to integrate Keycloak or any other OIDC provider. The engine calls `getToken()` before any authenticated REST request.

---

## 6. Angular Layer

### 6.1 CesiumGlobeComponent

Standalone Angular 19 component. Owns the HTML container element and bridges `@Input()`/`@Output()` to the `RenderingEngine`.

```typescript
@Component({
  selector: 'cesium-globe',
  standalone: true,
  template: `<div #container style="width:100%;height:100%"></div>`
})
export class CesiumGlobeComponent implements OnInit, OnDestroy, OnChanges {
  @Input() satellites: SatelliteConfig[] = [];
  @Input() terminals: TerminalConfig[] = [];
  @Input() customEntities: CustomEntityConfig[] = [];
  @Input() timeConfig?: TimeConfig;
  @Input() coverageConfig?: CoverageConfig;
  @Input() globeConfig?: GlobeConfig;

  @Output() entityClicked = new EventEmitter<EntityEvent>();
  @Output() entityHovered = new EventEmitter<EntityEvent>();
  @Output() terminalPlaced = new EventEmitter<TerminalPlacedEvent>();
}
```

`ngOnChanges` diffs input arrays and calls the relevant `RenderingEngine` add/update/remove methods. It does **not** replace all entities on every change.

### 6.2 CesiumGlobeService

Angular service for imperative control — intended for cases where `@Input()` bindings are insufficient (e.g., programmatic updates driven by real-time data streams).

```typescript
@Injectable()
export class CesiumGlobeService {
  addSatellite(config: SatelliteConfig): void;
  updateSatellite(id: string, patch: Partial<SatelliteConfig>): void;
  removeSatellite(id: string): void;

  addTerminal(config: TerminalConfig): void;
  updateTerminal(id: string, patch: Partial<TerminalConfig>): void;
  removeTerminal(id: string): void;

  addCustomEntity(config: CustomEntityConfig): void;
  updateCustomEntity(id: string, patch: Partial<CustomEntityConfig>): void;
  removeCustomEntity(id: string): void;

  setTimeConfig(config: TimeConfig): void;
  setCoverageConfig(config: CoverageConfig): void;
  setLinkLinesVisible(visible: boolean): void;

  readonly entityClick$: Observable<EntityEvent>;
  readonly entityHover$: Observable<EntityEvent>;
  readonly terminalPlaced$: Observable<TerminalPlacedEvent>;
}
```

Both the component and service delegate to the same injected `RenderingEngine`. They share state via the engine, not via shared Angular state.

### 6.3 provideGlobe()

```typescript
export function provideGlobe(config?: GlobeConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: RENDERING_ENGINE_TOKEN, useClass: CesiumRenderingEngine },
    { provide: GLOBE_CONFIG_TOKEN, useValue: config ?? {} },
    CesiumGlobeService,
  ]);
}
```

Used in `app.config.ts` for standalone Angular apps. Injection token keeps Angular decoupled from the Cesium import.

---

## 7. CesiumJS Engine Internals

These are internal implementation details — not part of the public API.

| Class | Responsibility |
|---|---|
| `CesiumRenderingEngine` | Implements `RenderingEngine`. Owns the Cesium `Viewer`. Delegates to managers. |
| `SatelliteManager` | Creates/updates/removes Cesium entities for satellites. Computes positions from TLE using `satellite.js` (MIT license). |
| `TerminalManager` | Creates/updates/removes terminal entities. Handles drag-drop via Cesium screen space events. |
| `BeamManager` | Renders beam cones using Cesium `CylinderGraphics` + ground ellipse. Triggers `CoverageCalculator` on each clock tick. |
| `CoverageCalculator` | Determines which terminals fall within each beam's footprint using spherical geometry math. Notifies `TerminalManager` to update colors. |
| `ModelLoader` | Loads GLTF/GLB/CZML natively via Cesium. Converts OBJ to GLTF in-browser using `obj2gltf` before handing to Cesium. |
| `TimeController` | Wraps `Cesium.Clock`. Translates `TimeConfig` into Cesium clock settings. |

---

## 8. Extension Points

| Extension Point | How to Swap |
|---|---|
| **Rendering engine** | Implement `RenderingEngine`, provide via `RENDERING_ENGINE_TOKEN` in `provideGlobe()`. |
| **Auth / Keycloak** | Implement `AuthTokenProvider`, pass as `GlobeConfig.auth`. |
| **Tile provider** | Set `GlobeConfig.tileProvider` to `'custom'` with a WMTS URL. |
| **3D models** | Pass `ModelAsset` on any entity config. Omit to use built-in defaults. |
| **Colors / appearance** | `ColorConfig` on beams, `CoverageConfig` for coverage coloring, per-entity config. |

---

## 9. Key Design Decisions

### Decision 1: Single npm package, not a monorepo
The core, cesium engine, and angular modules are co-located in one package rather than split into `@company/core`, `@company/cesium`, `@company/angular`. **Reason:** The team is small, v1 scope is focused, and monorepo tooling (Nx) adds overhead. Internal module boundaries enforce the same separation. This can be split later without breaking the public API.

### Decision 2: `satellite.js` for TLE propagation
CesiumJS does not natively propagate TLE orbits. `satellite.js` (MIT) is the de-facto standard JS TLE propagator. It produces ECEF coordinates that feed directly into Cesium entity positions. Alternative: `ootk` library (also MIT) — can be swapped later.

### Decision 3: Observable event streams, not callbacks
All engine events are `Observable<T>` (RxJS). **Reason:** Angular applications are RxJS-native. Observables compose cleanly with `async` pipe, `takeUntilDestroyed`, and other Angular patterns. The `RenderingEngine` interface uses Observables; the Angular `@Output()` EventEmitters subscribe to them internally.

### Decision 4: OBJ converted at load time, not at build time
OBJ files are converted to GLTF in the browser using `obj2gltf` rather than requiring a build-time pre-conversion step. **Reason:** Keeps the developer experience simple — provide any supported format and the library handles it. Performance impact is negligible for typical model sizes.

### Decision 5: Coverage computed in engine, not Angular
Beam-terminal intersection math lives in `CoverageCalculator` inside the Cesium engine layer, not in Angular services. **Reason:** Coverage depends on 3D geometry that is tied to the rendering context. Angular services should not own spatial math.

---

## 10. v1 Scope Boundary

For v1 (MVP), only the following need to be implemented:

- `core/` domain models and interfaces (all of them — they form the public API contract)
- `CesiumRenderingEngine.initialize()` and `destroy()`
- `SatelliteManager` — add/update/remove, TLE position computation, default model
- `TerminalManager` — add/update/remove, lat/lon/alt placement, default model
- `ModelLoader` — GLTF/GLB only (OBJ and CZML deferred to post-v1)
- `TimeController` — real-time mode only (playback/simulation deferred)
- `CesiumGlobeComponent` — renders globe, accepts `satellites` and `terminals` inputs
- `CesiumGlobeService` — addSatellite, addTerminal
- `provideGlobe()` — wires everything together
- Free OSM tile provider default

Everything else (beams, coverage, drag-drop, click events, Keycloak, custom entities, OBJ, playback) is post-v1.
