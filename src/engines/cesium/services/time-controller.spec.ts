import { Clock, ClockStep, JulianDate } from '@cesium/engine';

import { TimeController } from './time-controller';

describe('TimeController', () => {
  let clock: Clock;
  let controller: TimeController;

  beforeEach(() => {
    clock = new Clock();
    controller = new TimeController(clock);
  });

  it('configures realtime mode with system-clock-multiplier stepping', () => {
    controller.apply({ mode: 'realtime' });

    expect(clock.clockStep).toBe(ClockStep.SYSTEM_CLOCK_MULTIPLIER);
    expect(clock.shouldAnimate).toBe(true);
    expect(clock.multiplier).toBe(1);
  });

  it('uses the supplied current time and multiplier', () => {
    const start = new Date('2026-01-01T00:00:00Z');

    controller.apply({ mode: 'realtime', currentTime: start, multiplier: 60 });

    expect(JulianDate.toDate(clock.currentTime)).toEqual(start);
    expect(clock.multiplier).toBe(60);
  });

  it('rejects playback mode with an explicit post-v1 error', () => {
    expect(() => controller.apply({ mode: 'playback' })).toThrow(
      /'playback' is not implemented in v1/
    );
  });

  it('rejects simulation mode with an explicit post-v1 error', () => {
    expect(() => controller.apply({ mode: 'simulation' })).toThrow(
      /'simulation' is not implemented in v1/
    );
  });
});
