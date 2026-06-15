/**
 * How scene time advances.
 *
 * - `realtime`: satellites move as wall-clock time advances (v1).
 * - `playback`: scrub/replay a past time window (post-v1).
 * - `simulation`: run a hypothetical future scenario (post-v1).
 */
export type TimeMode = 'realtime' | 'playback' | 'simulation';

/** Scene time configuration. */
export interface TimeConfig {
  /** Time mode; see {@link TimeMode}. */
  mode: TimeMode;
  /** Initial scene time. Defaults to "now" in realtime mode. */
  currentTime?: Date;
  /** Window start. Required for playback and simulation modes. */
  start?: Date;
  /** Window end. Required for playback and simulation modes. */
  stop?: Date;
  /** Time speed multiplier (1 = real speed). Defaults to 1. */
  multiplier?: number;
}
