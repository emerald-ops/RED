import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'public/assets/characters/preview/nordic-knight.glb');
const PI = Math.PI;
const bones = [];
const boneByName = new Map();
const primitives = [];

function addBone(name, parent, position, rotation = [0, 0, 0]) {
  const index = bones.length;
  bones.push({ name, parent, position, rotation, children: [] });
  boneByName.set(name, index);
  if (parent !== null) bones[parent].children.push(index);
  return index;
}

const rootBone = addBone('root', null, [0, 0, 0]);
const pelvisBone = addBone('pelvis', rootBone, [0, 0.94, 0]);
const spineBone = addBone('spine', pelvisBone, [0, 0.12, 0]);
const chestBone = addBone('chest', spineBone, [0, 0.31, 0]);
const neckBone = addBone('neck', chestBone, [0, 0.27, 0]);
const headBone = addBone('head', neckBone, [0, 0.11, 0]);

for (const side of [-1, 1]) {
  const suffix = side < 0 ? '.L' : '.R';
  const shoulder = addBone(`clavicle${suffix}`, chestBone, [side * 0.25, 0.18, 0], [0, 0, side * -0.12]);
  const upper = addBone(`upperArm${suffix}`, shoulder, [side * 0.035, -0.12, 0], [0, 0, side * -0.08]);
  const forearm = addBone(`forearm${suffix}`, upper, [side * 0.01, -0.29, 0.015]);
  const hand = addBone(`hand${suffix}`, forearm, [0, -0.27, 0.035]);
  for (let finger = 0; finger < 4; finger++) {
    const x = (finger - 1.5) * 0.029;
    const first = addBone(`finger${finger + 1}${suffix}`, hand, [x, -0.055, 0.025]);
    addBone(`finger${finger + 1}_tip${suffix}`, first, [0, -0.045, 0.005]);
  }
  addBone(`thumb${suffix}`, hand, [side * -0.055, -0.015, 0.015], [0, 0, side * 0.62]);

  const thigh = addBone(`thigh${suffix}`, pelvisBone, [side * 0.14, -0.055, 0], [0, 0, side * -0.015]);
  const shin = addBone(`shin${suffix}`, thigh, [0, -0.39, 0]);
  const foot = addBone(`foot${suffix}`, shin, [0, -0.34, 0.015]);
  addBone(`toe${suffix}`, foot, [0, -0.04, 0.11]);
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const index of [a, b, c]) {
      normals[index] += nx;
      normals[index + 1] += ny;
      normals[index + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function loft(rings, radial = 24, phase = 0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  rings.forEach(([y, rx, rz, z = 0], row) => {
    for (let column = 0; column <= radial; column++) {
      const angle = column / radial * PI * 2 + phase;
      const variation = 1 + Math.sin(angle * 5 + row * 1.7) * 0.012;
      positions.push(Math.cos(angle) * rx * variation, y, z + Math.sin(angle) * rz * variation);
      uvs.push(column / radial * 3, row / Math.max(1, rings.length - 1));
    }
  });
  for (let row = 0; row < rings.length - 1; row++) {
    for (let column = 0; column < radial; column++) {
      const a = row * (radial + 1) + column;
      const b = a + 1;
      const c = a + radial + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, uvs, indices };
}

function plateShape(width, height, shape = 'shield') {
  const outline = shape === 'breastplate'
    ? [[-0.62, 0.42], [-0.42, 0.58], [-0.12, 0.55], [0, 0.48], [0.12, 0.55], [0.42, 0.58], [0.62, 0.42], [0.58, 0.02], [0.42, -0.3], [0.25, -0.46], [0, -0.52], [-0.25, -0.46], [-0.42, -0.3], [-0.58, 0.02]]
    : shape === 'shoulder'
      ? [[-0.52, 0.31], [-0.34, 0.53], [0.05, 0.58], [0.4, 0.45], [0.58, 0.16], [0.49, -0.2], [0.22, -0.48], [-0.15, -0.52], [-0.45, -0.23]]
      : shape === 'greave'
        ? [[-0.42, 0.52], [0.32, 0.52], [0.48, 0.3], [0.38, -0.25], [0.19, -0.54], [0, -0.61], [-0.19, -0.54], [-0.38, -0.25], [-0.48, 0.3]]
        : [[-0.5, 0.36], [-0.35, 0.56], [0.35, 0.56], [0.5, 0.36], [0.45, -0.26], [0.18, -0.52], [0, -0.57], [-0.18, -0.52], [-0.45, -0.26]];
  return outline.map(([x, y]) => [x * width, y * height]);
}

function plateGeometry(width, height, baseZ, curvature, shape = 'shield', thickness = 0.034) {
  const outline = plateShape(width, height, shape);
  const positions = [];
  const uvs = [];
  const indices = [];
  const rings = [0.18, 0.62, 1];
  for (const [layer, depth] of [[0, 0], [1, -thickness]]) {
    for (const radius of rings) {
      for (const [x, y] of outline) {
        const px = x * radius;
        const py = y * radius;
        const dome = curvature * (1 - radius * radius) + 0.014 * Math.cos(py / height * PI);
        positions.push(px, py, baseZ + dome + depth);
        uvs.push(px / width + 0.5, py / height + 0.5);
      }
    }
  }
  const count = outline.length;
  const layerCount = rings.length * count;
  for (let layer = 0; layer < 2; layer++) {
    const offset = layer * layerCount;
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const first = offset + ring * count;
      const second = first + count;
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        if (layer === 0) indices.push(first + i, second + i, first + next, first + next, second + i, second + next);
        else indices.push(first + i, first + next, second + i, first + next, second + next, second + i);
      }
    }
  }
  const ringVertexCount = rings.length * count;
  const frontCenter = positions.length / 3;
  positions.push(0, 0, baseZ + curvature + 0.014);
  uvs.push(0.5, 0.5);
  const backCenter = positions.length / 3;
  positions.push(0, 0, baseZ + curvature - thickness);
  uvs.push(0.5, 0.5);
  const outerFront = (rings.length - 1) * count;
  const outerBack = layerCount + outerFront;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(frontCenter, outerFront + i, outerFront + next);
    indices.push(backCenter, outerBack + next, outerBack + i);
    indices.push(
      (rings.length - 1) * count + i,
      (rings.length - 1) * count + next,
      layerCount + (rings.length - 1) * count + i,
      (rings.length - 1) * count + next,
      layerCount + (rings.length - 1) * count + next,
      layerCount + (rings.length - 1) * count + i,
    );
  }
  return { positions, uvs, indices };
}

function domeGeometry(rx, ry, rz, radial = 32, vertical = 10) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= vertical; row++) {
    const t = row / vertical;
    const angle = t * PI * 0.5;
    const ring = Math.cos(angle);
    const y = Math.sin(angle) * ry;
    for (let column = 0; column <= radial; column++) {
      const around = column / radial * PI * 2;
      const ridge = 1 + 0.035 * Math.cos(around * 6) * (1 - t);
      positions.push(Math.cos(around) * rx * ring * ridge, y, Math.sin(around) * rz * ring * ridge);
      uvs.push(column / radial, t);
    }
  }
  for (let row = 0; row < vertical; row++) {
    for (let column = 0; column < radial; column++) {
      const a = row * (radial + 1) + column;
      const b = a + 1;
      const c = a + radial + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, uvs, indices };
}

function tube(points, radius, radial = 8) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const curve = points.map((point) => new THREE.Vector3(...point));
  for (let row = 0; row < curve.length; row++) {
    const tangent = curve[Math.min(row + 1, curve.length - 1)].clone().sub(curve[Math.max(row - 1, 0)]).normalize();
    const reference = Math.abs(tangent.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const normal = tangent.clone().cross(reference).normalize();
    const binormal = tangent.clone().cross(normal).normalize();
    for (let column = 0; column <= radial; column++) {
      const angle = column / radial * PI * 2;
      const vertex = curve[row].clone()
        .addScaledVector(normal, Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(column / radial, row / Math.max(1, curve.length - 1));
    }
  }
  for (let row = 0; row < curve.length - 1; row++) {
    for (let column = 0; column < radial; column++) {
      const a = row * (radial + 1) + column;
      const b = a + 1;
      const c = a + radial + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, uvs, indices };
}

function ribbon(points, width, offset = 0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const current = new THREE.Vector3(...points[i]);
    const tangent = new THREE.Vector3(...points[Math.min(i + 1, points.length - 1)])
      .sub(new THREE.Vector3(...points[Math.max(0, i - 1)])).normalize();
    const side = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize().multiplyScalar(width * 0.5);
    for (const sign of [-1, 1]) {
      positions.push(current.x + side.x * sign, current.y + side.y * sign, current.z + offset);
      uvs.push(sign * 0.5 + 0.5, i / Math.max(1, points.length - 1));
    }
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  return { positions, uvs, indices };
}

function tuft(length, width, bend = 0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rows = 5;
  const columns = 4;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const taper = Math.sin(PI * (t * 0.82 + 0.08)) * (1 - t * 0.7);
    for (let column = 0; column <= columns; column++) {
      const across = column / columns * 2 - 1;
      const z = bend * t + Math.sin(t * PI) * Math.abs(across) * 0.025;
      positions.push(across * width * taper * 0.5, -length * t, z);
      uvs.push(column / columns, t);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, uvs, indices };
}

const steelColor = [0.74, 0.78, 0.78, 1];
const leatherColor = [0.6, 0.53, 0.42, 1];
const clothColor = [0.59, 0.62, 0.59, 1];
const furColor = [0.72, 0.69, 0.59, 1];
const skinColor = [0.72, 0.6, 0.49, 1];
const goldColor = [0.78, 0.65, 0.42, 1];
const materialDefs = [
  { name: 'Weathered_Blue_Steel', type: 'steel', color: [0.2, 0.235, 0.255, 1], metallic: 0.84, roughness: 0.64 },
  { name: 'Blackened_Iron', type: 'iron', color: [0.105, 0.12, 0.125, 1], metallic: 0.78, roughness: 0.72 },
  { name: 'Oiled_Dark_Leather', type: 'leather', color: [0.17, 0.105, 0.068, 1], metallic: 0.02, roughness: 0.86 },
  { name: 'Woven_Wool', type: 'cloth', color: [0.16, 0.17, 0.155, 1], metallic: 0, roughness: 0.93 },
  { name: 'Weathered_Fur', type: 'fur', color: [0.36, 0.32, 0.25, 1], metallic: 0, roughness: 0.97 },
  { name: 'Aged_Brass', type: 'brass', color: [0.38, 0.265, 0.13, 1], metallic: 0.7, roughness: 0.62 },
  { name: 'Darkened_Steel_Edge', type: 'steel', color: [0.39, 0.42, 0.43, 1], metallic: 0.88, roughness: 0.48 },
  { name: 'Leather_Stitch', type: 'leather', color: [0.32, 0.22, 0.14, 1], metallic: 0, roughness: 0.9 },
  { name: 'Eye_Slit', type: 'iron', color: [0.018, 0.023, 0.022, 1], metallic: 0.1, roughness: 0.98 },
  { name: 'Warm_Skin', type: 'skin', color: [0.33, 0.22, 0.16, 1], metallic: 0, roughness: 0.78 },
];
const materialIndex = new Map(materialDefs.map((material, index) => [material.name, index]));

function addMesh(name, parentBone, geometry, material) {
  const positions = geometry.positions;
  const indices = geometry.indices;
  const normals = computeNormals(positions, indices);
  primitives.push({ name, parentBone, positions, normals, uvs: geometry.uvs, indices, material: materialIndex.get(material) });
}

const steel = materialDefs[0].name;
const iron = materialDefs[1].name;
const leather = materialDefs[2].name;
const cloth = materialDefs[3].name;
const fur = materialDefs[4].name;
const brass = materialDefs[5].name;
const edgeSteel = materialDefs[6].name;
const stitch = materialDefs[7].name;
const black = materialDefs[8].name;
const skin = materialDefs[9].name;

function addPlate(name, bone, width, height, z, material = steel, shape = 'shield', curve = 0.075, thickness = 0.035) {
  const geometry = plateGeometry(width, height, z, curve, shape, thickness);
  addMesh(name, bone, geometry, material);
}

function addOffsetPlate(name, bone, width, height, z, offsetX, offsetY = 0, material = steel, shape = 'shield', curve = 0.075, thickness = 0.035) {
  const geometry = plateGeometry(width, height, z, curve, shape, thickness);
  geometry.positions = geometry.positions.map((value, index) => value + (index % 3 === 0 ? offsetX : index % 3 === 1 ? offsetY : 0));
  addMesh(name, bone, geometry, material);
}

function addRivet(name, bone, x, y, z, radius = 0.012, material = brass) {
  const geometry = domeGeometry(radius, radius * 0.62, radius, 8, 3);
  const transformed = { ...geometry, positions: geometry.positions.map((value, index) => value + (index % 3 === 0 ? x : index % 3 === 1 ? y : z)) };
  addMesh(name, bone, transformed, material);
}

function ellipsePath(rx, ry, z, steps = 48, y = 0) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index / steps * PI * 2;
    return [Math.cos(angle) * rx, y + Math.sin(angle) * ry, z];
  });
}

function addBeltBuckle(bone, x, y, z) {
  const width = 0.12;
  const height = 0.09;
  const corners = [[x - width / 2, y - height / 2, z], [x + width / 2, y - height / 2, z],
    [x + width / 2, y + height / 2, z], [x - width / 2, y + height / 2, z], [x - width / 2, y - height / 2, z]];
  addMesh('Belt_Buckle_Frame', bone, tube(corners, 0.009, 6), brass);
  addMesh('Belt_Buckle_Tongue', bone, tube([[x - width * 0.32, y, z + 0.004], [x + width * 0.34, y, z + 0.004]], 0.005, 5), edgeSteel);
  addRivet('Buckle_Rivet', bone, x, y, z + 0.008, 0.012, brass);
}

function addStrap(name, bone, points, width = 0.045, color = leather) {
  addMesh(name, bone, ribbon(points, width, 0.008), color);
  const stitchPoints = points.map(([x, y, z]) => [x, y, z + 0.011]);
  addMesh(`${name}_Stitch_Left`, bone, tube(stitchPoints.map(([x, y, z]) => [x - width * 0.31, y, z]), 0.0025, 4), stitch);
  addMesh(`${name}_Stitch_Right`, bone, tube(stitchPoints.map(([x, y, z]) => [x + width * 0.31, y, z]), 0.0025, 4), stitch);
}

function addArmorTrim(name, bone, points, radius = 0.008, material = brass) {
  addMesh(name, bone, tube(points, radius, 6), material);
}

function addFurTufts(bone, count, radiusX, radiusZ, y, length, seed = 0) {
  for (let i = 0; i < count; i++) {
    const angle = i / count * PI * 2;
    const x = Math.cos(angle) * radiusX;
    const z = Math.sin(angle) * radiusZ - 0.015;
    const tuftGeometry = tuft(length * (0.74 + ((i * 13 + seed) % 7) * 0.055), 0.042 + ((i + seed) % 3) * 0.008, Math.cos(angle) * 0.035);
    const placed = { ...tuftGeometry, positions: tuftGeometry.positions.map((value, index) => value + (index % 3 === 0 ? x : index % 3 === 1 ? y : z)) };
    addMesh(`Fur_Tuft_${seed}_${i}`, bone, placed, fur);
  }
}

function addSword(handBone) {
  const bladeStations = [
    [0.05, 0.052, 0.018], [0.12, 0.064, 0.018], [0.39, 0.055, 0.016],
    [0.74, 0.047, 0.014], [0.94, 0.037, 0.012], [1.05, 0, 0.001],
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row < bladeStations.length; row++) {
    const [y, width, depth] = bladeStations[row];
    for (const [x, z] of [[-width, 0], [0, depth], [width, 0], [0, -depth]]) {
      positions.push(x, y, z + 0.1);
      uvs.push(x / 0.14 + 0.5, y / 1.05);
    }
  }
  for (let row = 0; row < bladeStations.length - 1; row++) {
    for (let edge = 0; edge < 4; edge++) {
      const a = row * 4 + edge;
      const b = row * 4 + (edge + 1) % 4;
      const c = (row + 1) * 4 + edge;
      const d = (row + 1) * 4 + (edge + 1) % 4;
      indices.push(a, b, c, b, d, c);
    }
  }
  addMesh('Longsword_Diamond_Ground_Blade', handBone, { positions, uvs, indices }, edgeSteel);
  addMesh('Longsword_Fuller', handBone, ribbon([[0, 0.18, 0.121], [0, 0.38, 0.118], [0, 0.7, 0.116], [0, 0.91, 0.113]], 0.009), iron);
  addMesh('Longsword_Grip', handBone, loft([[-0.09, 0.03, 0.03, 0.1], [-0.045, 0.034, 0.031, 0.1], [0.035, 0.032, 0.03, 0.1]], 12), leather);
  addMesh('Longsword_Grip_Wrap', handBone, tube(Array.from({ length: 18 }, (_, i) => {
    const t = i / 17;
    const angle = t * PI * 2 * 5;
    return [Math.cos(angle) * 0.032, -0.07 + t * 0.09, 0.1 + Math.sin(angle) * 0.032];
  }), 0.0035, 5), stitch);
  addMesh('Longsword_Crossguard', handBone, tube([
    [-0.19, 0.035, 0.1], [-0.13, 0.06, 0.1], [-0.06, 0.045, 0.1], [0, 0.035, 0.1],
    [0.06, 0.045, 0.1], [0.13, 0.06, 0.1], [0.19, 0.035, 0.1],
  ], 0.022, 8), brass);
  addMesh('Longsword_Pommel', handBone, domeGeometry(0.055, 0.045, 0.05, 16, 6), brass);
  addMesh('Longsword_Pommel_Cap', handBone, plateGeometry(0.078, 0.065, 0.044, 0.012, 'shield', 0.012), iron);
}

function buildCharacter() {
  const pelvis = loft([
    [-0.12, 0.145, 0.105, 0], [-0.06, 0.205, 0.132, 0], [0.04, 0.22, 0.145, 0],
    [0.15, 0.195, 0.12, 0], [0.21, 0.15, 0.1, 0],
  ], 32);
  addMesh('Quilted_Arming_Jacket_Pelvis', pelvisBone, pelvis, cloth);
  addMesh('Waist_Leather_Underlayer', pelvisBone, loft([[0.08, 0.205, 0.138, 0], [0.16, 0.19, 0.13, 0]], 32), leather);

  const torso = loft([
    [-0.02, 0.17, 0.105, 0], [0.06, 0.205, 0.12, 0], [0.16, 0.225, 0.13, 0],
    [0.28, 0.245, 0.137, 0], [0.4, 0.225, 0.125, 0], [0.5, 0.17, 0.105, 0],
  ], 36);
  addMesh('Quilted_Arming_Jacket_Torso', spineBone, torso, cloth);
  addMesh('Chainmail_Coif_Torso', chestBone, loft([[-0.12, 0.205, 0.125, 0], [-0.03, 0.24, 0.14, 0], [0.1, 0.23, 0.13, 0], [0.22, 0.18, 0.11, 0]], 36), iron);

  addPlate('Cuirass_Front_Main', chestBone, 0.48, 0.53, 0.126, steel, 'breastplate', 0.085, 0.042);
  addPlate('Cuirass_Back_Main', chestBone, 0.46, 0.52, -0.105, steel, 'breastplate', 0.045, 0.04);
  addPlate('Cuirass_Central_Raised_Ridge', chestBone, 0.17, 0.42, 0.203, edgeSteel, 'shield', 0.03, 0.02);
  addOffsetPlate('Cuirass_Left_Pectoral_Layer', chestBone, 0.22, 0.25, 0.185, -0.112, 0, steel, 'shield', 0.06, 0.025);
  addOffsetPlate('Cuirass_Right_Pectoral_Layer', chestBone, 0.22, 0.25, 0.185, 0.112, 0, steel, 'shield', 0.06, 0.025);
  addPlate('Abdominal_Plate_Upper', chestBone, 0.37, 0.13, 0.177, steel, 'shield', 0.052, 0.026);
  addPlate('Abdominal_Plate_Middle', chestBone, 0.35, 0.13, 0.174, steel, 'shield', 0.048, 0.026);
  addPlate('Abdominal_Plate_Lower', chestBone, 0.32, 0.12, 0.168, steel, 'shield', 0.042, 0.026);
  addArmorTrim('Cuirass_Edge_Rim', chestBone, [
    [-0.23, 0.17, 0.18], [-0.22, 0.32, 0.19], [-0.16, 0.48, 0.17], [-0.06, 0.52, 0.17],
    [0, 0.49, 0.2], [0.06, 0.52, 0.17], [0.16, 0.48, 0.17], [0.22, 0.32, 0.19], [0.23, 0.17, 0.18],
  ], 0.012, brass);
  for (const side of [-1, 1]) {
    addOffsetPlate(`Rib_Guard${side < 0 ? '.L' : '.R'}`, chestBone, 0.105, 0.28, 0.145, side * 0.185, 0, iron, 'greave', 0.025, 0.028);
    addRivet(`Cuirass_Rivet_Top${side}`, chestBone, side * 0.19, 0.4, 0.19, 0.014, brass);
    addRivet(`Cuirass_Rivet_Lower${side}`, chestBone, side * 0.15, -0.18, 0.18, 0.012, brass);
    addStrap(`Shoulder_Cross_Str ap${side}`, chestBone, [
      [side * 0.22, 0.46, 0.13], [side * 0.15, 0.34, 0.17], [side * 0.08, 0.2, 0.18],
    ], 0.035);
  }
  addMesh('Cuirass_Nordic_Rune_Stroke', chestBone, tube([
    [-0.045, 0.2, 0.229], [-0.045, 0.28, 0.229], [0.035, 0.28, 0.229],
    [0.035, 0.36, 0.229], [-0.035, 0.36, 0.229], [-0.035, 0.43, 0.229], [0.045, 0.43, 0.229],
  ], 0.007, 5), brass);

  const beltBone = pelvisBone;
  addMesh('Belt_Tooled_Leather', beltBone, loft([[0.15, 0.215, 0.146, 0], [0.22, 0.21, 0.142, 0], [0.27, 0.19, 0.13, 0]], 40), leather);
  addBeltBuckle(beltBone, 0, 0.205, 0.145);
  for (let i = 0; i < 13; i++) {
    const angle = PI * 0.12 + (i / 12) * PI * 0.76;
    addRivet(`Belt_Stud_${i}`, beltBone, Math.cos(angle) * 0.2, 0.2, Math.sin(angle) * 0.13 + 0.018, 0.008, brass);
  }
  for (const side of [-1, 1]) {
    addOffsetPlate(`Fauld_Panel${side < 0 ? '.L' : '.R'}`, pelvisBone, 0.19, 0.34, 0.14, side * 0.115, 0, steel, 'greave', 0.035, 0.03);
    addOffsetPlate(`Fauld_Overlapping_Lame${side < 0 ? '.L' : '.R'}`, pelvisBone, 0.16, 0.19, 0.171, side * 0.115, -0.14, iron, 'shield', 0.022, 0.022);
    addStrap(`Fauld_Leather_Tie${side}`, pelvisBone, [[side * 0.16, 0.28, 0.15], [side * 0.18, 0.18, 0.17], [side * 0.19, 0.08, 0.17]], 0.026);
  }

  addMesh('Neck_Chainmail', neckBone, loft([[-0.06, 0.095, 0.09, 0], [0.03, 0.11, 0.095, 0], [0.12, 0.1, 0.085, 0]], 28), iron);
  addMesh('Neck_Leather_Gorget', neckBone, loft([[-0.025, 0.13, 0.115, 0], [0.045, 0.14, 0.125, 0], [0.09, 0.11, 0.1, 0]], 32), leather);
  addPlate('Gorget_Front_Lamella', neckBone, 0.22, 0.16, 0.102, steel, 'shield', 0.03, 0.03);

  addMesh('Lower_Face', headBone, loft([[-0.045, 0.08, 0.075, 0], [0.015, 0.092, 0.084, 0], [0.09, 0.09, 0.08, 0], [0.16, 0.075, 0.07, 0]], 28), skin);
  addMesh('Nose_Bridge', headBone, loft([[0.04, 0.018, 0.023, 0.075], [0.12, 0.015, 0.021, 0.075], [0.17, 0.009, 0.016, 0.067]], 12), skin);
  addMesh('Helmet_Crown_Dome', headBone, domeGeometry(0.145, 0.24, 0.18, 40, 14), steel);
  addPlate('Helmet_Front_Brow', headBone, 0.29, 0.085, 0.145, iron, 'shield', 0.03, 0.035);
  addPlate('Helmet_Visor', headBone, 0.285, 0.12, 0.161, steel, 'shield', 0.035, 0.035);
  addPlate('Helmet_Eye_Slit_Shadow', headBone, 0.208, 0.026, 0.193, black, 'shield', 0.008, 0.008);
  addPlate('Helmet_Nasal_Guard', headBone, 0.055, 0.25, 0.19, edgeSteel, 'greave', 0.02, 0.035);
  for (const side of [-1, 1]) {
    addOffsetPlate(`Helmet_Cheek_Guard${side < 0 ? '.L' : '.R'}`, headBone, 0.108, 0.23, 0.122, side * 0.078, -0.015, steel, 'greave', 0.03, 0.035);
    addOffsetPlate(`Helmet_Temple_Inset${side < 0 ? '.L' : '.R'}`, headBone, 0.07, 0.12, 0.132, side * 0.115, 0.055, iron, 'shield', 0.016, 0.012);
    addRivet(`Helmet_Visor_Pin${side}`, headBone, side * 0.12, 0.12, 0.18, 0.011, brass);
  }
  addMesh('Helmet_Central_Crest_Ridge', headBone, tube([
    [0, 0.17, -0.115], [0, 0.24, -0.12], [0, 0.31, -0.09],
    [0, 0.35, -0.035], [0, 0.34, 0.035], [0, 0.3, 0.095],
  ], 0.018, 8), iron);
  addMesh('Helmet_Brow_Rune', headBone, tube([[-0.06, 0.17, 0.188], [0, 0.14, 0.197], [0.06, 0.17, 0.188]], 0.006, 5), brass);

  const cape = [];
  const rows = 12;
  const columns = 12;
  const capePositions = [];
  const capeUvs = [];
  const capeIndices = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const y = 0.16 - t * 0.62;
    const width = 0.2 + t * 0.12 + Math.sin(t * PI) * 0.025;
    for (let column = 0; column <= columns; column++) {
      const across = column / columns * 2 - 1;
      const wind = Math.sin(across * PI * 2 + t * 7) * t * 0.018;
      capePositions.push(across * width, y, -0.13 - t * 0.055 + wind);
      capeUvs.push(column / columns * 2, t);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column;
        const b = a + 1;
        const c = a + columns + 1;
        const d = c + 1;
        capeIndices.push(a, b, c, b, d, c);
      }
    }
  }
  cape.push({ positions: capePositions, uvs: capeUvs, indices: capeIndices });
  addMesh('Heavy_Wool_Back_Cloak', chestBone, cape[0], cloth);
  addMesh('Fur_Mantle_Base', chestBone, loft([[0.12, 0.29, 0.2, -0.01], [0.21, 0.31, 0.21, -0.01], [0.3, 0.26, 0.17, 0]], 40), fur);
  addFurTufts(chestBone, 56, 0.29, 0.185, 0.18, 0.095, 4);
  addFurTufts(chestBone, 24, 0.22, 0.13, 0.07, 0.075, 11);

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? '.L' : '.R';
    const shoulder = boneByName.get(`clavicle${suffix}`);
    const upper = boneByName.get(`upperArm${suffix}`);
    const forearm = boneByName.get(`forearm${suffix}`);
    const hand = boneByName.get(`hand${suffix}`);
    const thigh = boneByName.get(`thigh${suffix}`);
    const shin = boneByName.get(`shin${suffix}`);
    const foot = boneByName.get(`foot${suffix}`);

    addMesh(`Upper_Arm_Quilt${suffix}`, upper, loft([[-0.03, 0.09, 0.09, 0], [-0.13, 0.09, 0.085, 0], [-0.23, 0.075, 0.072, 0], [-0.31, 0.06, 0.06, 0]], 24), cloth);
    addMesh(`Pauldron_Domed_Shell${suffix}`, shoulder, domeGeometry(0.155, 0.155, 0.15, 32, 10), steel);
    addPlate(`Pauldron_Outer_Lame${suffix}`, shoulder, 0.24, 0.17, 0.08, iron, 'shoulder', 0.035, 0.03);
    addPlate(`Pauldron_Front_Flare${suffix}`, shoulder, 0.16, 0.22, 0.12, steel, 'greave', 0.028, 0.028);
    addArmorTrim(`Pauldron_Edge_Rim${suffix}`, shoulder, [
      [-0.16, 0.02, 0.13], [-0.13, 0.13, 0.16], [-0.06, 0.18, 0.15], [0.03, 0.19, 0.14],
      [0.13, 0.13, 0.12], [0.17, 0.02, 0.08],
    ], 0.01, brass);
    addRivet(`Pauldron_Center_Rivet${suffix}`, shoulder, 0, 0.11, 0.192, 0.018, brass);
    addRivet(`Pauldron_Lower_Rivet${suffix}`, shoulder, side * 0.105, -0.06, 0.14, 0.012, brass);
    addStrap(`Pauldron_Understrap${suffix}`, shoulder, [[-0.1, -0.11, 0.08], [0, -0.17, 0.1], [0.1, -0.11, 0.08]], 0.035, leather);

    addMesh(`Forearm_Chainmail${suffix}`, forearm, loft([[-0.28, 0.073, 0.065, 0], [-0.2, 0.082, 0.07, 0], [-0.09, 0.075, 0.067, 0], [0, 0.063, 0.058, 0]], 24), iron);
    addMesh(`Vambrace_Curved_Shell${suffix}`, forearm, plateGeometry(0.17, 0.33, 0.064, 0.042, 'greave', 0.035), steel);
    addPlate(`Vambrace_Outer_Ridge${suffix}`, forearm, 0.07, 0.27, 0.105, edgeSteel, 'shield', 0.018, 0.018);
    for (const y of [-0.03, -0.25]) {
      addMesh(`Vambrace_Rim${suffix}_${y}`, forearm, tube(ellipsePath(0.077, 0.066, 0, 20, y), 0.009, 6), brass);
    }
    addRivet(`Vambrace_Buckle${suffix}`, forearm, 0, -0.14, 0.107, 0.012, brass);

    addMesh(`Gauntlet_Hand_Plate${suffix}`, hand, plateGeometry(0.13, 0.16, 0.074, 0.022, 'shield', 0.026), steel);
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * 0.03;
      const fingerBone = boneByName.get(`finger${finger + 1}${suffix}`);
      const tipBone = boneByName.get(`finger${finger + 1}_tip${suffix}`);
      addMesh(`Gauntlet_Finger_Guard${suffix}_${finger}`, fingerBone, loft([[-0.06, 0.013, 0.017, 0], [-0.025, 0.016, 0.019, 0], [0.02, 0.014, 0.017, 0]], 10), steel);
      addPlate(`Gauntlet_Finger_Knuckle${suffix}_${finger}`, tipBone, 0.029, 0.035, 0.015, iron, 'shield', 0.009, 0.012);
      addRivet(`Gauntlet_Knuckle_Rivet${suffix}_${finger}`, fingerBone, 0, -0.018, 0.019, 0.006, brass);
      if (fingerBone === undefined) throw new Error(`Missing finger bone ${finger} ${suffix}`);
      void x;
    }
    addPlate(`Gauntlet_Thumb_Guard${suffix}`, boneByName.get(`thumb${suffix}`), 0.055, 0.11, 0.018, steel, 'greave', 0.018, 0.022);
    addMesh(`Upper_Leg_Arming_Cloth${suffix}`, thigh, loft([[-0.04, 0.105, 0.12, 0], [-0.16, 0.105, 0.11, 0], [-0.29, 0.09, 0.095, 0], [-0.39, 0.08, 0.085, 0]], 28), cloth);
    addPlate(`Thigh_Cuisses${suffix}`, thigh, 0.18, 0.37, 0.092, steel, 'greave', 0.04, 0.034);
    addPlate(`Thigh_Outer_Lame${suffix}`, thigh, 0.13, 0.2, 0.116, iron, 'shield', 0.025, 0.024);
    addMesh(`Knee_Rondel${suffix}`, shin, domeGeometry(0.09, 0.085, 0.045, 20, 7), steel);
    addRivet(`Knee_Rondel_Center${suffix}`, shin, 0, 0, 0.047, 0.016, brass);
    addMesh(`Lower_Leg_Quilt${suffix}`, shin, loft([[-0.29, 0.078, 0.082, 0], [-0.18, 0.095, 0.092, 0], [-0.05, 0.09, 0.085, 0], [0.02, 0.085, 0.08, 0]], 28), cloth);
    addPlate(`Greave_Front${suffix}`, shin, 0.155, 0.36, 0.081, steel, 'greave', 0.047, 0.035);
    addPlate(`Greave_Central_Ridge${suffix}`, shin, 0.04, 0.31, 0.13, edgeSteel, 'shield', 0.024, 0.018);
    addArmorTrim(`Greave_Edge_Rim${suffix}`, shin, [[-0.065, -0.24, 0.11], [-0.08, -0.08, 0.12], [-0.07, 0.08, 0.12], [-0.04, 0.13, 0.12],
      [0.04, 0.13, 0.12], [0.07, 0.08, 0.12], [0.08, -0.08, 0.12], [0.065, -0.24, 0.11]], 0.008, brass);
    addStrap(`Greave_Leather_Tie${suffix}`, shin, [[-0.1, -0.1, -0.02], [0, -0.08, -0.095], [0.1, -0.1, -0.02]], 0.026, leather);
    addMesh(`Sabaton_Armored_Boot${suffix}`, foot, loft([[-0.14, 0.105, 0.18, 0.055], [-0.08, 0.11, 0.2, 0.045], [0, 0.095, 0.16, 0.015], [0.055, 0.075, 0.095, 0]], 28), iron);
    addPlate(`Sabaton_Top_Plate${suffix}`, foot, 0.16, 0.16, 0.14, steel, 'greave', 0.035, 0.028);
    addPlate(`Sabaton_Toe_Cap${suffix}`, boneByName.get(`toe${suffix}`), 0.18, 0.12, 0.095, steel, 'shield', 0.03, 0.03);
    addRivet(`Sabaton_Toe_Rivet${suffix}`, foot, 0, -0.04, 0.188, 0.01, brass);
  }

  addSword(boneByName.get('hand.R'));
  addStrap('Sword_Scabbard_Baldric', chestBone, [[-0.22, 0.45, 0.13], [-0.12, 0.32, 0.16], [0, 0.17, 0.18], [0.12, 0.0, 0.14]], 0.048);
  addPlate('Back_Scabbard_Mount', spineBone, 0.12, 0.32, -0.12, iron, 'greave', 0.02, 0.03);
  addMesh('Back_Scabbard_Strap_Buckle', spineBone, tube([[-0.075, 0.12, -0.132], [0.075, 0.12, -0.132], [0.075, 0.2, -0.132], [-0.075, 0.2, -0.132], [-0.075, 0.12, -0.132]], 0.008, 6), brass);
}

buildCharacter();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([name, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = value[0];
      raw[offset + 1] = value[1];
      raw[offset + 2] = value[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 8 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hash(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

const textureSize = 256;
const textureSets = {};
for (const type of ['steel', 'iron', 'leather', 'cloth', 'fur', 'brass', 'skin']) {
  const seed = type.length * 17;
  const base = makePng(textureSize, textureSize, (x, y) => {
    const grain = hash(x, y, seed);
    const broad = hash(Math.floor(x / 8), Math.floor(y / 8), seed + 9);
    const scratch = type === 'steel' && hash(x, Math.floor(y / 3), seed + 3) > 0.996 ? -34 : 0;
    const fiber = type === 'cloth' || type === 'fur' ? Math.sin(x * 0.38 + Math.sin(y * 0.12)) * 9 : 0;
    const value = 206 + (grain - 0.5) * 24 + (broad - 0.5) * 14 + scratch + fiber;
    return [value, value * (0.99 + grain * 0.025), value * (0.97 + broad * 0.05)];
  });
  const normal = makePng(textureSize, textureSize, (x, y) => {
    const dx = (hash(x + 1, y, seed + 15) - hash(x - 1, y, seed + 15)) * 0.18;
    const dy = (hash(x, y + 1, seed + 23) - hash(x, y - 1, seed + 23)) * 0.18;
    return [128 + dx * 255, 128 + dy * 255, 254];
  });
  const metalRoughness = makePng(textureSize, textureSize, (x, y) => {
    const variation = hash(Math.floor(x / 2), Math.floor(y / 2), seed + 31);
    const roughness = type === 'steel' || type === 'iron' || type === 'brass'
      ? 80 + variation * 82
      : 165 + variation * 72;
    const metalness = type === 'steel' || type === 'iron' ? 205 + variation * 36
      : type === 'brass' ? 170 + variation * 44 : 0;
    return [255, roughness, metalness];
  });
  textureSets[type] = { base, normal, metalRoughness };
}

const binaryParts = [];
let binaryLength = 0;
const bufferViews = [];
const accessors = [];
function appendBinary(data, target) {
  while (binaryLength % 4 !== 0) {
    binaryParts.push(Buffer.from([0]));
    binaryLength++;
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: buffer.length, ...(target ? { target } : {}) });
  binaryParts.push(buffer);
  binaryLength += buffer.length;
  return index;
}

function addAccessor(data, componentType, type, target, minMax = false) {
  const view = appendBinary(data, target);
  const accessor = { bufferView: view, componentType, count: data.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]), type };
  if (minMax) {
    const stride = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    accessor.min = Array.from({ length: stride }, (_, axis) => Math.min(...Array.from({ length: accessor.count }, (_, i) => data[i * stride + axis])));
    accessor.max = Array.from({ length: stride }, (_, axis) => Math.max(...Array.from({ length: accessor.count }, (_, i) => data[i * stride + axis])));
  }
  const index = accessors.length;
  accessors.push(accessor);
  return index;
}

const images = [];
const textures = [];
const textureByType = new Map();
const samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
for (const [type, maps] of Object.entries(textureSets)) {
  const addImage = (name, data) => {
    const bufferView = appendBinary(data);
    const index = images.length;
    images.push({ name, bufferView, mimeType: 'image/png' });
    textures.push({ sampler: 0, source: index });
    return textures.length - 1;
  };
  textureByType.set(type, {
    baseColor: addImage(`${type}_basecolor_256`, maps.base),
    normal: addImage(`${type}_normal_256`, maps.normal),
    metalRoughness: addImage(`${type}_metal_rough_256`, maps.metalRoughness),
  });
}

const materials = materialDefs.map((material) => {
  const maps = textureByType.get(material.type);
  return {
    name: material.name,
    pbrMetallicRoughness: {
      baseColorFactor: material.color,
      baseColorTexture: { index: maps.baseColor },
      metallicFactor: material.metallic,
      roughnessFactor: material.roughness,
      metallicRoughnessTexture: { index: maps.metalRoughness },
    },
    normalTexture: { index: maps.normal, scale: material.type === 'steel' ? 0.36 : 0.58 },
    doubleSided: true,
  };
});

const boneNodes = bones.map((bone) => ({
  name: bone.name,
  translation: bone.position,
  rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(...bone.rotation)).toArray(),
  ...(bone.children.length ? { children: bone.children.map((child) => child + 1) } : {}),
}));
const armature = new THREE.Group();
const boneObjects = [];
bones.forEach((bone, index) => {
  const object = new THREE.Bone();
  object.name = bone.name;
  object.position.set(...bone.position);
  object.rotation.set(...bone.rotation);
  if (bone.parent === null) armature.add(object);
  else boneObjects[bone.parent].add(object);
  boneObjects.push(object);
});
armature.updateMatrixWorld(true);
const inverseBind = new Float32Array(boneObjects.length * 16);
boneObjects.forEach((bone, index) => {
  const inverse = bone.matrixWorld.clone().invert();
  inverse.toArray(inverseBind, index * 16);
});
const inverseBindAccessor = addAccessor(inverseBind, 5126, 'MAT4', 34962);

const primitiveGroups = new Map();
for (const primitive of primitives) {
  const key = `${primitive.material}`;
  let group = primitiveGroups.get(key);
  if (!group) {
    group = {
      name: materialDefs[primitive.material].name,
      material: primitive.material,
      positions: [],
      normals: [],
      uvs: [],
      joints: [],
      weights: [],
      indices: [],
    };
    primitiveGroups.set(key, group);
  }
  const parentWorld = boneObjects[primitive.parentBone].matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(parentWorld);
  const baseVertex = group.positions.length / 3;
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i < primitive.positions.length; i += 3) {
    vertex.fromArray(primitive.positions, i).applyMatrix4(parentWorld);
    normal.fromArray(primitive.normals, i).applyMatrix3(normalMatrix).normalize();
    group.positions.push(vertex.x, vertex.y, vertex.z);
    group.normals.push(normal.x, normal.y, normal.z);
    group.joints.push(primitive.parentBone, 0, 0, 0);
    group.weights.push(1, 0, 0, 0);
  }
  group.uvs.push(...primitive.uvs);
  for (const index of primitive.indices) group.indices.push(baseVertex + index);
}

const primitiveJson = [...primitiveGroups.values()].map((primitive) => {
  const positions = new Float32Array(primitive.positions);
  const indices = primitive.indices.length > 65535
    ? new Uint32Array(primitive.indices)
    : new Uint16Array(primitive.indices);
  return {
    name: primitive.name,
    attributes: {
      POSITION: addAccessor(positions, 5126, 'VEC3', 34962, true),
      NORMAL: addAccessor(new Float32Array(primitive.normals), 5126, 'VEC3', 34962),
      TEXCOORD_0: addAccessor(new Float32Array(primitive.uvs), 5126, 'VEC2', 34962),
      JOINTS_0: addAccessor(new Uint16Array(primitive.joints), 5123, 'VEC4', 34962),
      WEIGHTS_0: addAccessor(new Float32Array(primitive.weights), 5126, 'VEC4', 34962),
    },
    indices: addAccessor(indices, indices instanceof Uint32Array ? 5125 : 5123, 'SCALAR', 34963, true),
    material: primitive.material,
    mode: 4,
  };
});

const meshNodeIndex = boneNodes.length + 1;
const nodes = [
  { name: 'Nordic_Knight_Armature', children: [1, meshNodeIndex] },
  ...boneNodes,
  { name: 'Nordic_Knight_Skinned_Armor', mesh: 0, skin: 0 },
];
const joints = bones.map((_, index) => index + 1);
const mesh = { name: 'Nordic_Knight_Separate_Armor_Components', primitives: primitiveJson };
const skinData = { name: 'Rigid_Armor_Joint_Rig', inverseBindMatrices: inverseBindAccessor, skeleton: 1, joints };

const gltf = {
  asset: { version: '2.0', generator: 'R.E.D. Nordic Knight Model Builder' },
  scene: 0,
  scenes: [{ name: 'Nordic Knight Studio Model', nodes: [0] }],
  nodes,
  meshes: [mesh],
  skins: [skinData],
  materials,
  textures,
  images,
  samplers,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binaryLength }],
  extras: {
    model: 'Original stylized-realistic Nordic plate knight built from custom low-poly surfaces.',
    heightMeters: 2.02,
    rig: 'Rigid armor parts weighted to named humanoid joints; no animation clips.',
    axes: 'Y up, +Z forward',
    componentCount: primitives.length,
  },
};

const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadding = (4 - jsonBytes.length % 4) % 4;
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
const bin = Buffer.concat(binaryParts);
const binPadding = (4 - bin.length % 4) % 4;
const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding)]);
const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
console.log(`Wrote ${outputPath}`);
console.log(`Rigid components: ${primitives.length}; bones: ${bones.length}; materials: ${materials.length}; embedded texture sets: ${Object.keys(textureSets).length}; size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MiB`);