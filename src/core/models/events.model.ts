import { GeodeticPosition } from './position.model';

/** Discriminator for which kind of entity an event refers to. */
export type EntityType = 'satellite' | 'terminal' | 'custom';

/**
 * Emitted when an end user clicks or hovers a 3D model. `data` is the
 * verbatim payload the developer attached to the entity's config, so
 * applications can render custom UI without re-querying their backend.
 */
export interface EntityEvent<T = Record<string, unknown>> {
  /** Id of the entity that was interacted with. */
  entityId: string;
  /** What kind of entity it is. */
  entityType: EntityType;
  /** The developer-supplied payload from the entity's config. */
  data: T;
}

/** Emitted when an end user drops a terminal onto the globe (post-v1). */
export interface TerminalPlacedEvent {
  /** Where the terminal landed. */
  position: GeodeticPosition;
}
