/**
 * Generates the bundled default 3D models as valid glTF 2.0 GLB files.
 *
 * Each model is built from multiple box primitives — no opaque binaries from
 * external tools, keeping asset provenance auditable (requirement 4.4).
 *
 * Satellite:  bus body + two solar-panel wings + dish stub
 * Terminal:   base pad + pedestal mast + tilted dish + feed horn
 *
 * All units in meters; Y-up coordinate system (glTF 2.0 convention).
 * Cesium maps glTF Y-up to "away from Earth" when placing models on the globe.
 *
 * Run: npm run generate:assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/engines/cesium/assets');

/**
 * @typedef {{
 *   hx: number, hy: number, hz: number,
 *   color: [number,number,number,number],
 *   metallic?: number,
 *   roughness?: number,
 *   translation?: [number,number,number],
 *   rotation?: [number,number,number,number]
 * }} Part
 */

/** Builds raw geometry buffers for a box of the given half-extents. */
function buildBoxGeometry(hx, hy, hz) {
  // 4 vertices per face × 6 faces = 24 vertices; flat normals require unique vertices per face.
  const faces = [
    { n: [ 1, 0, 0], verts: [[ hx,-hy,-hz],[ hx, hy,-hz],[ hx, hy, hz],[ hx,-hy, hz]] },
    { n: [-1, 0, 0], verts: [[-hx,-hy, hz],[-hx, hy, hz],[-hx, hy,-hz],[-hx,-hy,-hz]] },
    { n: [ 0, 1, 0], verts: [[-hx, hy,-hz],[-hx, hy, hz],[ hx, hy, hz],[ hx, hy,-hz]] },
    { n: [ 0,-1, 0], verts: [[-hx,-hy, hz],[-hx,-hy,-hz],[ hx,-hy,-hz],[ hx,-hy, hz]] },
    { n: [ 0, 0, 1], verts: [[-hx,-hy, hz],[ hx,-hy, hz],[ hx, hy, hz],[-hx, hy, hz]] },
    { n: [ 0, 0,-1], verts: [[ hx,-hy,-hz],[-hx,-hy,-hz],[-hx, hy,-hz],[ hx, hy,-hz]] },
  ];

  const positions = [];
  const normals   = [];
  const indices   = [];

  faces.forEach((face, f) => {
    face.verts.forEach(v => { positions.push(...v); normals.push(...face.n); });
    const base = f * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return {
    posBuf: Buffer.from(new Float32Array(positions).buffer), // 288 bytes, 4-byte aligned
    nrmBuf: Buffer.from(new Float32Array(normals).buffer),   // 288 bytes, 4-byte aligned
    idxBuf: Buffer.from(new Uint16Array(indices).buffer),    //  72 bytes, 4-byte aligned
  };
}

/**
 * Packs an array of box parts into a single GLB file.
 * Each part becomes its own glTF mesh + node + material so parts can have
 * independent transforms and colours.
 *
 * @param {Part[]} parts
 * @returns {Buffer}
 */
function buildMultiPartGlb(parts) {
  const geometries = parts.map(p => buildBoxGeometry(p.hx, p.hy, p.hz));

  // Binary payload: [pos0, nrm0, idx0, pos1, nrm1, idx1, …]
  // Each geometry chunk is already 4-byte aligned (float32 × 3 × 24 = 288,
  // uint16 × 36 = 72), so no inter-chunk padding is needed.
  const bin = Buffer.concat(geometries.flatMap(g => [g.posBuf, g.nrmBuf, g.idxBuf]));

  const bufferViews = [];
  const accessors   = [];
  let byteOffset    = 0;

  parts.forEach((p, i) => {
    const { posBuf, nrmBuf, idxBuf } = geometries[i];

    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.length, target: 34962 });
    accessors.push({
      bufferView: i * 3,
      componentType: 5126, // FLOAT
      count: 24,
      type: 'VEC3',
      min: [-p.hx, -p.hy, -p.hz],
      max: [ p.hx,  p.hy,  p.hz],
    });
    byteOffset += posBuf.length;

    bufferViews.push({ buffer: 0, byteOffset, byteLength: nrmBuf.length, target: 34962 });
    accessors.push({ bufferView: i * 3 + 1, componentType: 5126, count: 24, type: 'VEC3' });
    byteOffset += nrmBuf.length;

    bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.length, target: 34963 });
    accessors.push({ bufferView: i * 3 + 2, componentType: 5123, count: 36, type: 'SCALAR' });
    byteOffset += idxBuf.length;
  });

  const gltf = {
    asset: { version: '2.0', generator: 'cesium-wrapper default model generator' },
    scene: 0,
    scenes: [{ nodes: parts.map((_, i) => i) }],
    nodes: parts.map((p, i) => {
      const node = { mesh: i };
      if (p.translation) node.translation = p.translation;
      if (p.rotation)    node.rotation    = p.rotation;
      return node;
    }),
    meshes: parts.map((_, i) => ({
      primitives: [{
        attributes: { POSITION: i * 3, NORMAL: i * 3 + 1 },
        indices: i * 3 + 2,
        material: i,
      }],
    })),
    materials: parts.map(p => ({
      pbrMetallicRoughness: {
        baseColorFactor: p.color,
        metallicFactor:  p.metallic  ?? 0.3,
        roughnessFactor: p.roughness ?? 0.7,
      },
    })),
    buffers:     [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  // GLB container: 12-byte file header + JSON chunk + BIN chunk.
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4 !== 0) {
    json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]); // space-pad JSON
  }
  let binPadded = bin;
  if (binPadded.length % 4 !== 0) {
    binPadded = Buffer.concat([binPadded, Buffer.alloc(4 - (binPadded.length % 4), 0x00)]);
  }

  const total = 12 + 8 + json.length + 8 + binPadded.length;
  const out   = Buffer.alloc(total);
  let o = 0;
  o = out.writeUInt32LE(0x46546c67, o); // magic  'glTF'
  o = out.writeUInt32LE(2,          o); // version 2
  o = out.writeUInt32LE(total,      o); // total file length
  o = out.writeUInt32LE(json.length,       o);
  o = out.writeUInt32LE(0x4e4f534a,        o); // chunk type 'JSON'
  o += json.copy(out, o);
  o = out.writeUInt32LE(binPadded.length,  o);
  o = out.writeUInt32LE(0x004e4942,        o); // chunk type 'BIN\0'
  binPadded.copy(out, o);
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Satellite model
// ---------------------------------------------------------------------------
// Resembles a medium LEO satellite: rectangular bus with symmetric solar wings
// and a small high-gain dish stub on top.
writeFileSync(
  join(OUT_DIR, 'default-satellite.glb'),
  buildMultiPartGlb([
    // Main bus: compact metallic silver-gray box
    {
      hx: 0.5, hy: 0.4, hz: 0.4,
      color: [0.72, 0.72, 0.78, 1.0], metallic: 0.8, roughness: 0.15,
    },
    // Left solar panel: dark navy-blue, thin and wide
    {
      hx: 1.2, hy: 0.03, hz: 0.6,
      color: [0.05, 0.08, 0.35, 1.0], metallic: 0.05, roughness: 0.9,
      translation: [-1.7, 0, 0],
    },
    // Right solar panel: mirror of left
    {
      hx: 1.2, hy: 0.03, hz: 0.6,
      color: [0.05, 0.08, 0.35, 1.0], metallic: 0.05, roughness: 0.9,
      translation: [1.7, 0, 0],
    },
    // High-gain antenna dish stub: flat off-white square on top of bus
    {
      hx: 0.20, hy: 0.025, hz: 0.20,
      color: [0.92, 0.92, 0.95, 1.0], metallic: 0.3, roughness: 0.5,
      translation: [0, 0.625, 0],
    },
  ])
);

// ---------------------------------------------------------------------------
// Ground terminal model
// ---------------------------------------------------------------------------
// Resembles a parabolic dish antenna on a pedestal mount.
//
// Dish rotation: 35° from horizontal around the X axis so the dish faces
// "up and toward +Z" — a typical mid-elevation look angle for a GEO terminal.
// Quaternion: q = [sin(17.5°), 0, 0, cos(17.5°)] ≈ [0.3007, 0, 0, 0.9537]
writeFileSync(
  join(OUT_DIR, 'default-terminal.glb'),
  buildMultiPartGlb([
    // Base pad: wide flat gray mounting slab
    {
      hx: 0.9, hy: 0.10, hz: 0.9,
      color: [0.45, 0.45, 0.45, 1.0], metallic: 0.1, roughness: 0.9,
      translation: [0, 0.10, 0],
    },
    // Pedestal mast: dark steel pillar
    {
      hx: 0.12, hy: 0.65, hz: 0.12,
      color: [0.30, 0.30, 0.35, 1.0], metallic: 0.6, roughness: 0.4,
      translation: [0, 0.85, 0],
    },
    // Dish: off-white parabolic reflector (box), tilted 35° toward +Z
    {
      hx: 0.75, hy: 0.06, hz: 0.75,
      color: [0.88, 0.88, 0.90, 1.0], metallic: 0.15, roughness: 0.5,
      translation: [0, 1.58, 0.20],
      rotation: [0.3007, 0, 0, 0.9537],
    },
    // Feed horn: small metal stub at the dish focus point
    {
      hx: 0.07, hy: 0.10, hz: 0.07,
      color: [0.65, 0.65, 0.70, 1.0], metallic: 0.5, roughness: 0.4,
      translation: [0, 1.72, 0.50],
    },
  ])
);

console.log(`Wrote default models to ${OUT_DIR}`);
