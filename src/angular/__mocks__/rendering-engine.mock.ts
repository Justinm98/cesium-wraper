import { Subject } from 'rxjs';

import { RenderingEngine } from '../../core/interfaces/rendering-engine.interface';
import { EntityEvent, TerminalPlacedEvent } from '../../core/models/events.model';

/** A fully jest-mocked RenderingEngine with controllable event streams. */
export interface MockRenderingEngine extends RenderingEngine {
  clickSubject: Subject<EntityEvent>;
  hoverSubject: Subject<EntityEvent>;
  placedSubject: Subject<TerminalPlacedEvent>;
}

export function createMockEngine(): MockRenderingEngine {
  const clickSubject = new Subject<EntityEvent>();
  const hoverSubject = new Subject<EntityEvent>();
  const placedSubject = new Subject<TerminalPlacedEvent>();
  return {
    clickSubject,
    hoverSubject,
    placedSubject,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
    addSatellite: jest.fn(),
    updateSatellite: jest.fn(),
    removeSatellite: jest.fn(),
    addTerminal: jest.fn(),
    updateTerminal: jest.fn(),
    removeTerminal: jest.fn(),
    addCustomEntity: jest.fn(),
    updateCustomEntity: jest.fn(),
    removeCustomEntity: jest.fn(),
    setTimeConfig: jest.fn(),
    setCoverageConfig: jest.fn(),
    setLinkLinesVisible: jest.fn(),
    setCoverageComputationEnabled: jest.fn(),
    setCoverageAssignment: jest.fn(),
    clearCoverageAssignment: jest.fn(),
    entityClick$: clickSubject.asObservable(),
    entityHover$: hoverSubject.asObservable(),
    terminalPlaced$: placedSubject.asObservable(),
  };
}
