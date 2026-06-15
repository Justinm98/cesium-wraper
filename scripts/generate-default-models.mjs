/**
 * Generates the bundled default 3D models as minimal valid glTF 2.0 GLB
 * files (one colored box per model). Hand-generating these instead of
 * committing opaque binaries from an unknown source keeps the asset
 * provenance auditable and the licensing unambiguous (requirement 4.4).
 *
 * Run: npm run generate:assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/engines/cesium/assets');

/** Builds a GLB containing one box of the given half-extents and color. */
function buildBoxGlb({ hx, hy, hz, color }) {
  // 24 vertices (4 per face) so each face gets a flat normal.
  const faces = [
    { n: [1, 0, 0], verts: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [-1, 0, 0], verts: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 1, 0], verts: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, -1, 0], verts: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
    { n: [0, 0, 1], verts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], verts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];

  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, f) => {
    face.verts.forEach((v) => {
      positions.push(...v);
      normals.push(...face.n);
    });
    const base = f * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  const posBuf = Buffer.from(new Float32Array(positions).buffer);
  const nrmBuf = Buffer.from(new Float32Array(normals).buffer);
  const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
  // Each section is 4-byte aligned already (float32/uint16 counts are even).
  const bin = Buffer.concat([posBuf, nrmBuf, idxBuf]);

  const gltf = {
    asset: { version: '2.0', generator: 'cesium-wrapper default model generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.2, roughnessFactor: 0.8 } },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + nrmBuf.length, byteLength: idxBuf.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
        min: [-hx, -hy, -hz],
        max: [hx, hy, hz],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };

  // GLB container: 12-byte header + JSON chunk (space-padded) + BIN chunk.
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4 !== 0) {
    json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  }
  let binPadded = bin;
  if (binPadded.length % 4 !== 0) {
    binPadded = Buffer.concat([binPadded, Buffer.alloc(4 - (binPadded.length % 4), 0)]);
  }

  const total = 12 + 8 + json.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  let o = 0;
  o = out.writeUInt32LE(0x46546c67, o); // 'glTF'
  o = out.writeUInt32LE(2, o);
  o = out.writeUInt32LE(total, o);
  o = out.writeUInt32LE(json.length, o);
  o = out.writeUInt32LE(0x4e4f534a, o); // 'JSON'
  o += json.copy(out, o);
  o = out.writeUInt32LE(binPadded.length, o);
  o = out.writeUInt32LE(0x004e4942, o); // 'BIN\0'
  binPadded.copy(out, o);
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

// Satellite: elongated gold box suggesting a bus + panels, 2m along x.
writeFileSync(
  join(OUT_DIR, 'default-satellite.glb'),
  buildBoxGlb({ hx: 2, hy: 0.5, hz: 0.5, color: [0.83, 0.69, 0.22, 1] })
);
// Terminal: squat blue box, dish-station footprint, 1m square.
writeFileSync(
  join(OUT_DIR, 'default-terminal.glb'),
  buildBoxGlb({ hx: 1, hy: 1, hz: 0.4, color: [0.2, 0.45, 0.85, 1] })
);

console.log(`Wrote default models to ${OUT_DIR}`);
