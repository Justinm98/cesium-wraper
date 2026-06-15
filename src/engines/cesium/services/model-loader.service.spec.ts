import { ModelLoader } from './model-loader.service';

describe('ModelLoader', () => {
  const loader = new ModelLoader('assets/cesium-wrapper');

  it('falls back to the bundled default satellite model when no asset is given', () => {
    expect(loader.resolveUri(undefined, 'satellite')).toBe(
      'assets/cesium-wrapper/default-satellite.glb'
    );
  });

  it('falls back to the bundled default terminal model when no asset is given', () => {
    expect(loader.resolveUri(undefined, 'terminal')).toBe(
      'assets/cesium-wrapper/default-terminal.glb'
    );
  });

  it('respects a configured asset base URL', () => {
    const custom = new ModelLoader('https://cdn.example.com/models');
    expect(custom.resolveUri(undefined, 'satellite')).toBe(
      'https://cdn.example.com/models/default-satellite.glb'
    );
  });

  it('passes glTF asset URLs through unchanged', () => {
    expect(loader.resolveUri({ url: 'models/sat.gltf', format: 'gltf' }, 'satellite')).toBe(
      'models/sat.gltf'
    );
  });

  it('passes GLB asset URLs through unchanged', () => {
    expect(loader.resolveUri({ url: 'models/sat.glb', format: 'glb' }, 'satellite')).toBe(
      'models/sat.glb'
    );
  });

  it('rejects CZML with an explicit post-v1 error', () => {
    expect(() => loader.resolveUri({ url: 'x.czml', format: 'czml' }, 'satellite')).toThrow(
      /CZML.*not implemented in v1/
    );
  });

  it('rejects OBJ with an explicit post-v1 error', () => {
    expect(() => loader.resolveUri({ url: 'x.obj', format: 'obj' }, 'terminal')).toThrow(
      /OBJ.*not implemented in v1/
    );
  });
});
