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
}

export const ClockStep = {
  TICK_DEPENDENT: 0,
  SYSTEM_CLOCK_MULTIPLIER: 1,
  SYSTEM_CLOCK: 2,
} as const;

export class Clock {
  currentTime: JulianDate = new JulianDate();
  multiplier = 1;
  clockStep: number = ClockStep.TICK_DEPENDENT;
  shouldAnimate = false;
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
