import { Clock, ClockStep, JulianDate } from '@cesium/engine';

import { TimeConfig } from '../../../core/models/time.model';

/**
 * Translates the engine-agnostic {@link TimeConfig} into Cesium Clock
 * settings. v1 implements realtime mode only; playback and simulation are
 * rejected explicitly so callers get a clear error instead of a frozen scene.
 */
export class TimeController {
  constructor(private readonly clock: Clock) {}

  apply(config: TimeConfig): void {
    if (config.mode !== 'realtime') {
      throw new Error(
        `Time mode '${config.mode}' is not implemented in v1; only 'realtime' is supported ` +
          '(see docs/architecture.md section 10).'
      );
    }
    const start = config.currentTime ?? new Date();
    this.clock.currentTime = JulianDate.fromDate(start);
    this.clock.multiplier = config.multiplier ?? 1;
    // SYSTEM_CLOCK_MULTIPLIER advances scene time by wall-clock elapsed time
    // times the multiplier — exactly the realtime contract.
    this.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    this.clock.shouldAnimate = true;
  }
}
