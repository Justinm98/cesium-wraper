/**
 * Manual mock for `@cesium/engine`, wired in via jest moduleNameMapper.
 *
 * Unit tests must not instantiate a real CesiumWidget (it requires WebGL,
 * which jsdom does not provide), so this file re-implements the minimal
 * surface the library touches: just enough state capture for tests to
 * assert what the engine layer asked Cesium to do.
 */

export class Cartesian3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0
  ) {}

  /** Returns a marker object carrying its inputs so tests can assert them. */
  static fromDegrees(longitude: number, latitude: number, height: number): Cartesian3 {
    const c = new Cartesian3(longitude, latitude, height);
    (c as unknown as { fromDegrees: boolean }).fromDegrees = true;
    return c;
  }

  static magnitude(c: Cartesian3): number {
    return global.Math.hypot(c.x, c.y, c.z);
  }

  static distance(a: Cartesian3, b: Cartesian3): number {
    return global.Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
}

export class JulianDate {
  constructor(public readonly date: Date = new Date()) {}

  static fromDate(date: Date): JulianDate {
    return new JulianDate(date);
  }

  static toDate(julian: JulianDate): Date {
    return julian.date;
  }
}

export class CallbackPositionProperty {
  constructor(
    public readonly callback: (time: JulianDate) => Cartesian3 | undefined,
    public readonly isConstant: boolean
  ) {}

  getValue(time: JulianDate): Cartesian3 | undefined {
    return this.callback(time);
  }
}

/**
 * Generic time-varying property. Beam orientation and link-line endpoints are
 * driven by these so they re-evaluate inside Cesium's render loop with no
 * Angular involvement (FR-A-05/15).
 */
export class CallbackProperty {
  constructor(
    public readonly callback: (time: JulianDate | undefined) => unknown,
    public readonly isConstant: boolean
  ) {}

  getValue(time: JulianDate | undefined): unknown {
    return this.callback(time);
  }
}

/** Constant position stand-in (static terminal endpoint of a link line). */
export class ConstantPositionProperty {
  constructor(public readonly value: Cartesian3) {}

  getValue(): Cartesian3 {
    return this.value;
  }
}

/** RGBA color, channels 0-1, mirroring Cesium's Color just enough for tests. */
export class Color {
  constructor(
    public readonly red = 1,
    public readonly green = 1,
    public readonly blue = 1,
    public readonly alpha = 1
  ) {}

  static fromBytes(r: number, g: number, b: number, a: number): Color {
    return new Color(r / 255, g / 255, b / 255, a / 255);
  }

  withAlpha(alpha: number): Color {
    return new Color(this.red, this.green, this.blue, alpha);
  }

  /** Component-wise equality, mirroring Cesium's `Color.equals`. */
  equals(other: Color): boolean {
    return (
      this.red === other.red &&
      this.green === other.green &&
      this.blue === other.blue &&
      this.alpha === other.alpha
    );
  }
}

/** Minimal angle helpers used by the managers. */
export const Math = {
  toRadians(degrees: number): number {
    return (degrees * global.Math.PI) / 180;
  },
};

export class Matrix3 {
  constructor(public readonly values: number[] = []) {}

  static fromColumnMajorArray(values: number[]): Matrix3 {
    return new Matrix3(values);
  }
}

export class Quaternion {
  constructor(
    public readonly x = 0,
    public readonly y = 0,
    public readonly z = 0,
    public readonly w = 1
  ) {}

  static fromRotationMatrix(matrix: Matrix3): Quaternion {
    // The mock does not need a real rotation; it carries the source matrix so
    // tests can assert orientation was supplied from the boresight frame.
    const q = new Quaternion();
    (q as unknown as { matrix: Matrix3 }).matrix = matrix;
    return q;
  }
}

/** Cone/cylinder volume graphic options bag. */
export class CylinderGraphics {
  constructor(public readonly options: Record<string, unknown>) {}
}

/** Footprint ellipse graphic options bag. */
export class EllipseGraphics {
  constructor(public readonly options: Record<string, unknown>) {}
}

/** Link-line polyline graphic options bag. */
export class PolylineGraphics {
  constructor(public readonly options: Record<string, unknown>) {}
}

export const ClockStep = {
  TICK_DEPENDENT: 0,
  SYSTEM_CLOCK_MULTIPLIER: 1,
  SYSTEM_CLOCK: 2,
} as const;

/**
 * Stand-in for Cesium's Event. Generic over its listener arguments so it serves
 * both `clock.onTick` (raised with the clock, for the coverage recompute, FR-A-19)
 * and `scene.preRender` (raised with `(scene, time)`, for the per-frame beam
 * volume modelMatrix update, FR-A-05). Tests call `raise(...)` to simulate a tick.
 */
export class CesiumEvent<A extends unknown[] = [Clock]> {
  private readonly listeners = new Set<(...args: A) => void>();

  addEventListener(listener: (...args: A) => void): () => void {
    this.listeners.add(listener);
    return () => this.removeEventListener(listener);
  }

  removeEventListener(listener: (...args: A) => void): void {
    this.listeners.delete(listener);
  }

  raise(...args: A): void {
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/** 4x4 matrix stand-in carrying its column-major values for assertions. */
export class Matrix4 {
  constructor(public readonly values: number[] = []) {}

  static fromColumnMajorArray(values: number[]): Matrix4 {
    return new Matrix4([...values]);
  }
}

/** Procedural cone geometry options bag (length/topRadius/bottomRadius). */
export class CylinderGeometry {
  constructor(public readonly options: Record<string, unknown>) {}
}

/** Per-instance color attribute; carries the Color so tests can assert fill. */
export class ColorGeometryInstanceAttribute {
  constructor(public readonly color: Color) {}

  static fromColor(color: Color): ColorGeometryInstanceAttribute {
    return new ColorGeometryInstanceAttribute(color);
  }
}

/** Geometry + per-instance attributes bag. */
export class GeometryInstance {
  constructor(public readonly options: Record<string, unknown>) {}
}

/** Translucent per-instance-color appearance options bag. */
export class PerInstanceColorAppearance {
  constructor(public readonly options: Record<string, unknown>) {}
}

/**
 * Scene primitive stand-in. `modelMatrix` and `show` are mutable because the
 * beam volume is re-pointed every frame (FR-A-05 / FR-A-01d) by BeamManager.
 */
export class Primitive {
  modelMatrix: Matrix4 | undefined;
  show: boolean;

  constructor(public readonly options: Record<string, unknown>) {
    this.modelMatrix = options['modelMatrix'] as Matrix4 | undefined;
    this.show = (options['show'] as boolean | undefined) ?? true;
  }
}

/** In-memory stand-in for Cesium's PrimitiveCollection. */
export class PrimitiveCollection {
  private readonly items = new Set<Primitive>();

  add(primitive: Primitive): Primitive {
    this.items.add(primitive);
    return primitive;
  }

  remove(primitive: Primitive): boolean {
    return this.items.delete(primitive);
  }

  removeAll(): void {
    this.items.clear();
  }

  contains(primitive: Primitive): boolean {
    return this.items.has(primitive);
  }

  get length(): number {
    return this.items.size;
  }

  get values(): readonly Primitive[] {
    return [...this.items];
  }
}

/** Minimal Scene: the primitive collection and the per-frame preRender event. */
export class Scene {
  readonly primitives = new PrimitiveCollection();
  readonly preRender = new CesiumEvent<[Scene, JulianDate | undefined]>();
}

export class Clock {
  currentTime: JulianDate = new JulianDate();
  multiplier = 1;
  clockStep: number = ClockStep.TICK_DEPENDENT;
  shouldAnimate = false;
  readonly onTick = new CesiumEvent();
}

/** In-memory stand-in for Cesium's EntityCollection. */
export class EntityCollection {
  private readonly byId = new Map<string, { id: string }>();

  add(options: { id: string }): { id: string } {
    if (this.byId.has(options.id)) {
      throw new Error(`An entity with id ${options.id} already exists.`);
    }
    this.byId.set(options.id, options);
    return options;
  }

  removeById(id: string): boolean {
    return this.byId.delete(id);
  }

  getById(id: string): { id: string } | undefined {
    return this.byId.get(id);
  }

  get values(): readonly { id: string }[] {
    return [...this.byId.values()];
  }
}

export class OpenStreetMapImageryProvider {
  constructor(public readonly options: object) {}
}

export class UrlTemplateImageryProvider {
  constructor(public readonly options: { url: string }) {}
}

export class ImageryLayer {
  constructor(
    public readonly provider: object,
    public readonly options: object
  ) {}
}

export const Ion = { defaultAccessToken: '' };

export class CesiumWidget {
  /** Latest constructed instance, for test assertions. */
  static lastInstance: CesiumWidget | undefined;

  readonly entities = new EntityCollection();
  readonly clock = new Clock();
  readonly scene = new Scene();
  private destroyed = false;

  constructor(
    public readonly container: HTMLElement,
    public readonly options: { baseLayer?: ImageryLayer; skyBox?: false; skyAtmosphere?: false }
  ) {
    CesiumWidget.lastInstance = this;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
  }
}
