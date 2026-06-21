import { TestBed } from '@angular/core/testing';

import { createMockEngine, MockRenderingEngine } from './__mocks__/rendering-engine.mock';
import { CesiumGlobeService } from './cesium-globe.service';
import { RENDERING_ENGINE } from './tokens';

describe('CesiumGlobeService', () => {
  let service: CesiumGlobeService;
  let engine: MockRenderingEngine;

  beforeEach(() => {
    engine = createMockEngine();
    TestBed.configureTestingModule({
      providers: [CesiumGlobeService, { provide: RENDERING_ENGINE, useValue: engine }],
    });
    service = TestBed.inject(CesiumGlobeService);
  });

  it('delegates satellite operations to the engine', () => {
    const config = { id: 's1', tle: { line1: 'l1', line2: 'l2' } };
    service.addSatellite(config);
    service.updateSatellite('s1', { label: 'x' });
    service.removeSatellite('s1');

    expect(engine.addSatellite).toHaveBeenCalledWith(config);
    expect(engine.updateSatellite).toHaveBeenCalledWith('s1', { label: 'x' });
    expect(engine.removeSatellite).toHaveBeenCalledWith('s1');
  });

  it('delegates terminal operations to the engine', () => {
    const config = { id: 't1', position: { latitude: 0, longitude: 0, altitude: 0 } };
    service.addTerminal(config);
    service.updateTerminal('t1', { label: 'x' });
    service.removeTerminal('t1');

    expect(engine.addTerminal).toHaveBeenCalledWith(config);
    expect(engine.updateTerminal).toHaveBeenCalledWith('t1', { label: 'x' });
    expect(engine.removeTerminal).toHaveBeenCalledWith('t1');
  });

  it('delegates custom entity operations to the engine', () => {
    const config = {
      id: 'c1',
      position: { latitude: 0, longitude: 0, altitude: 0 },
      model: { url: 'b.glb', format: 'glb' as const },
    };
    service.addCustomEntity(config);
    service.updateCustomEntity('c1', { label: 'x' });
    service.removeCustomEntity('c1');

    expect(engine.addCustomEntity).toHaveBeenCalledWith(config);
    expect(engine.updateCustomEntity).toHaveBeenCalledWith('c1', { label: 'x' });
    expect(engine.removeCustomEntity).toHaveBeenCalledWith('c1');
  });

  it('delegates time, coverage, and link line configuration', () => {
    service.setTimeConfig({ mode: 'realtime' });
    service.setCoverageConfig({ coveredColor: { r: 0, g: 255, b: 0, a: 1 }, showLinkLines: true });
    service.setLinkLinesVisible(false);

    expect(engine.setTimeConfig).toHaveBeenCalledWith({ mode: 'realtime' });
    expect(engine.setCoverageConfig).toHaveBeenCalledWith({
      coveredColor: { r: 0, g: 255, b: 0, a: 1 },
      showLinkLines: true,
    });
    expect(engine.setLinkLinesVisible).toHaveBeenCalledWith(false);
  });

  it('delegates the v2 coverage computation and assignment methods', () => {
    const assignment = {
      assignments: [{ terminalId: 't1', links: [{ satelliteId: 's1' }] }],
    };
    service.setCoverageComputationEnabled(true);
    service.setCoverageAssignment(assignment);
    service.clearCoverageAssignment();

    expect(engine.setCoverageComputationEnabled).toHaveBeenCalledWith(true);
    expect(engine.setCoverageAssignment).toHaveBeenCalledWith(assignment);
    expect(engine.clearCoverageAssignment).toHaveBeenCalled();
  });

  it('exposes the engine event streams', () => {
    const click = jest.fn();
    service.entityClick$.subscribe(click);
    engine.clickSubject.next({ entityId: 's1', entityType: 'satellite', data: {} });
    expect(click).toHaveBeenCalledWith({ entityId: 's1', entityType: 'satellite', data: {} });

    const hover = jest.fn();
    service.entityHover$.subscribe(hover);
    engine.hoverSubject.next({ entityId: 't1', entityType: 'terminal', data: {} });
    expect(hover).toHaveBeenCalledWith({ entityId: 't1', entityType: 'terminal', data: {} });

    const placed = jest.fn();
    service.terminalPlaced$.subscribe(placed);
    engine.placedSubject.next({ position: { latitude: 1, longitude: 2, altitude: 3 } });
    expect(placed).toHaveBeenCalledWith({ position: { latitude: 1, longitude: 2, altitude: 3 } });
  });
});
