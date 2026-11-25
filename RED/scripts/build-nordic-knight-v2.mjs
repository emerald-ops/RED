import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'public/assets/characters/preview/nordic-knight-v2.glb');
const originalPath = path.join(root, 'public/assets/characters/preview/nordic-knight.glb');

if (!fs.existsSync(originalPath)) throw new Error(`Original Knight asset not found: ${originalPath}`);

globalThis.FileReader = class {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const scene = new THREE.Scene();
const character = new THREE.Group();
character.name = 'Nordic_Knight_V2';
scene.add(character);

const materialDefs = [
  ['Obsidian steel', 'blackenedSteel', 0xffffff, 0.74, 0.8],
  ['Worn Nordic steel', 'steel', 0xffffff, 0.82, 0.82],
  ['Brushed silver edges', 'silver', 0xffffff, 0.88, 0.7],
  ['Dark oxblood leather', 'leather', 0xffffff, 0.02, 0.92],
  ['Woven charcoal wool', 'cloth', 0xffffff, 0, 0.98],
  ['Natural wolf fur', 'fur', 0xffffff, 0, 0.98],
  ['Wolf-fur strand variation', 'fur', 0xffffff, 0, 0.98],
  ['Aged bronze fittings', 'bronze', 0xffffff, 0.66, 0.82],
  ['Forged blade steel', 'silver', 0xffffff, 0.9, 0.7],
  ['Dark iron mail', 'blackenedSteel', 0xffffff, 0.64, 0.86],
  ['Skin beneath the helm', 'skin', 0xffffff, 0, 0.88],
];
const materials = new Map(materialDefs.map(([name, texture, color, metalness, roughness]) => [
  name,
  new THREE.MeshStandardMaterial({ name, color, metalness, roughness, side: THREE.DoubleSide }),
]));
materials.get('Wolf-fur strand variation').vertexColors = true;
const mat = (name) => {
  if (name instanceof THREE.Material) return name;
  const material = materials.get(name);
  if (!material) throw new Error(`Unknown material: ${name}`);
  return material;
};

const bones = [];
const boneByName = new Map();
function bone(name, parent, position) {
  const result = new THREE.Bone();
  result.name = name;
  result.position.set(...position);
  (parent ?? character).add(result);
  bones.push(result);
  boneByName.set(name, result);
  return result;
}

const hips = bone('Root_Hips', null, [0, 0.94, 0]);
const spine = bone('Spine', hips, [0, 0.13, 0]);
const chest = bone('Chest', spine, [0, 0.28, 0]);
const neck = bone('Neck', chest, [0, 0.27, 0]);
const head = bone('Head', neck, [0, 0.12, 0]);
const capeRoot = bone('Cape_Root', chest, [0, 0.13, -0.13]);
const capeMid = bone('Cape_Mid', capeRoot, [0, -0.29, -0.015]);
bone('Cape_Tip', capeMid, [0, -0.30, -0.015]);

const limbs = {};
for (const [side, sign] of [['L', -1], ['R', 1]]) {
  const clavicle = bone(`Clavicle_${side}`, chest, [sign * 0.265, 0.12, 0]);
  const upperArm = bone(`UpperArm_${side}`, clavicle, [sign * 0.075, -0.045, 0]);
  const forearm = bone(`Forearm_${side}`, upperArm, [sign * 0.015, -0.31, 0.01]);
  const hand = bone(`Hand_${side}`, forearm, [sign * 0.005, -0.29, 0.035]);
  const thigh = bone(`Thigh_${side}`, hips, [sign * 0.15, -0.025, 0]);
  const shin = bone(`Shin_${side}`, thigh, [0, -0.43, 0.005]);
  const foot = bone(`Foot_${side}`, shin, [0, -0.39, 0.035]);
  limbs[side] = { clavicle, upperArm, forearm, hand, thigh, shin, foot, sign };
}
bone('Socket_Shield_L', limbs.L.hand, [-0.015, -0.025, -0.12]);
const weaponSocket = bone('Socket_Weapon_R', limbs.R.hand, [0.015, 0, 0.04]);

function addMesh(parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const unitSphere = new THREE.SphereGeometry(1, 24, 16);
function ellipsoid(parent, name, material, position, scale, segments = 24) {
  return addMesh(parent, name, segments === 24 ? unitSphere : new THREE.SphereGeometry(1, segments, Math.max(12, Math.floor(segments * 0.65))), mat(material), position, [0, 0, 0], scale);
}

function cylinder(parent, name, material, position, radiusTop, radiusBottom, height, rotation = [0, 0, 0], radialSegments = 16) {
  return addMesh(parent, name, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1), mat(material), position, rotation);
}

function tube(parent, name, material, points, radius, segments = 18) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  return addMesh(parent, name, new THREE.TubeGeometry(curve, segments, radius, 6, false), material);
}

function plateGeometry(width, height, depth, outline = null) {
  const contour = outline ?? [
    [-0.30, 0.50], [0.30, 0.50], [0.48, 0.30], [0.43, -0.24],
    [0.22, -0.47], [0, -0.50], [-0.22, -0.47], [-0.43, -0.24], [-0.48, 0.30],
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = contour.length;
  const addVertex = (x, y, z) => {
    positions.push(x * width, y * height, z);
    uvs.push(x + 0.5, y + 0.5);
    return positions.length / 3 - 1;
  };
  const frontCenter = addVertex(0, 0, depth * 0.72);
  const frontRings = [0.38, 0.72, 1].map((scale) => contour.map(([x, y]) =>
    addVertex(x * scale, y * scale, depth * (1 - scale * scale) * 0.72),
  ));
  for (let i = 0; i < n; i++) indices.push(frontCenter, frontRings[0][i], frontRings[0][(i + 1) % n]);
  for (let ring = 0; ring < frontRings.length - 1; ring++) {
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const a = frontRings[ring][i], b = frontRings[ring][next];
      const c = frontRings[ring + 1][next], d = frontRings[ring + 1][i];
      indices.push(a, b, d, b, c, d);
    }
  }
  const backCenter = addVertex(0, 0, -depth * 0.48);
  const backRing = contour.map(([x, y]) => addVertex(x, y, -depth * 0.48));
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(backCenter, backRing[next], backRing[i]);
    indices.push(frontRings.at(-1)[i], frontRings.at(-1)[next], backRing[next], frontRings.at(-1)[i], backRing[next], backRing[i]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function plate(parent, name, material, position, width, height, depth = 0.065, rotation = [0, 0, 0], outline = null) {
  return addMesh(parent, name, plateGeometry(width, height, depth, outline), mat(material), position, rotation);
}

function rivets(parent, name, material, points, radius = 0.014) {
  points.forEach(([x, y, z], index) => ellipsoid(parent, `${name}_${index + 1}`, mat(material), [x, y, z], [radius, radius, radius], 12));
}

function addTorsoSkin() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const joints = [];
  const weights = [];
  const indices = [];
  const rings = [
    [0.80, 0.155, 0.105], [0.88, 0.205, 0.125], [0.97, 0.225, 0.14],
    [1.06, 0.205, 0.135], [1.17, 0.205, 0.13], [1.27, 0.255, 0.145],
    [1.37, 0.285, 0.15], [1.47, 0.265, 0.13], [1.55, 0.205, 0.115],
  ];
  const segments = 24;
  const jointIndices = ['Root_Hips', 'Spine', 'Chest'].map((name) => bones.indexOf(boneByName.get(name)));
  rings.forEach(([y, radiusX, radiusZ], row) => {
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
      uvs.push(segment / segments, row / (rings.length - 1));
      const blend = (from, to, amount) => {
        const t = THREE.MathUtils.clamp(amount, 0, 1);
        const smooth = t * t * (3 - 2 * t);
        return [1 - smooth, smooth];
      };
      let influence;
      if (y < 0.98) influence = [[jointIndices[0], 1]];
      else if (y < 1.08) influence = blend(0.98, 1.08, (y - 0.98) / 0.10).map((weight, i) => [jointIndices[i], weight]);
      else if (y < 1.20) influence = [[jointIndices[1], 1]];
      else if (y < 1.32) influence = blend(1.20, 1.32, (y - 1.20) / 0.12).map((weight, i) => [jointIndices[i + 1], weight]);
      else influence = [[jointIndices[2], 1]];
      const combined = influence.filter(([, weight]) => weight > 0.001);
      const sum = combined.reduce((total, [, weight]) => total + weight, 0);
      joints.push(...combined.map(([index]) => index), ...Array(4 - combined.length).fill(0));
      weights.push(...combined.map(([, weight]) => weight / sum), ...Array(4 - combined.length).fill(0));
    }
  });
  for (let row = 0; row < rings.length - 1; row++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = row * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geometry, mat('Woven charcoal wool'));
  mesh.name = 'Sculpted under-armor torso · blended skinning';
  character.add(mesh);
  const skeleton = new THREE.Skeleton(bones);
  character.updateMatrixWorld(true);
  skeleton.calculateInverses();
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

function addCape() {
  const positions = [];
  const uvs = [];
  const joints = [];
  const weights = [];
  const indices = [];
  const rows = 12;
  const columns = 5;
  const capeBones = ['Cape_Root', 'Cape_Mid', 'Cape_Tip'].map((name) => bones.indexOf(boneByName.get(name)));
  for (const side of [-1, 1]) {
    const vertexOffset = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const y = 1.48 - t * 0.46;
      const width = 0.21 + Math.sin(t * Math.PI * 0.75) * 0.055;
      for (let column = 0; column <= columns; column++) {
        const across = column / columns;
        const x = side * (0.095 + across * (width - 0.095));
        positions.push(x, y, -0.235 - Math.sin(t * Math.PI) * 0.035 - across * 0.018);
        uvs.push(across, t);
        let indexA = capeBones[0], indexB = capeBones[1], weightA = 1, weightB = 0;
        if (t > 0.24 && t <= 0.62) {
          weightB = THREE.MathUtils.smoothstep(t, 0.24, 0.62);
          weightA = 1 - weightB;
          indexB = capeBones[1];
        } else if (t > 0.62) {
          weightA = 1 - THREE.MathUtils.smoothstep(t, 0.62, 1);
          weightB = 1 - weightA;
          indexA = capeBones[1];
          indexB = capeBones[2];
        }
        joints.push(indexA, indexB, 0, 0);
        weights.push(weightA, weightB, 0, 0);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = vertexOffset + row * (columns + 1) + column;
        const b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const capeMaterial = mat('Woven charcoal wool').clone();
  capeMaterial.side = THREE.DoubleSide;
  const cape = new THREE.SkinnedMesh(geometry, capeMaterial);
  cape.name = 'Split wolf-cloak panels · articulated cape skin';
  character.add(cape);
  const skeleton = new THREE.Skeleton(bones);
  character.updateMatrixWorld(true);
  skeleton.calculateInverses();
  cape.bind(skeleton);
  cape.castShadow = true;
  cape.receiveShadow = true;
  plate(capeRoot, 'Cape clasp · left', 'Aged bronze fittings', [-0.15, 0.005, -0.10], 0.075, 0.09, 0.025, [0, Math.PI, 0]);
  plate(capeRoot, 'Cape clasp · right', 'Aged bronze fittings', [0.15, 0.005, -0.10], 0.075, 0.09, 0.025, [0, Math.PI, 0]);
}

function addFurMantle() {
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const crossSegments = 5;
  const layers = [
    { count: 40, radiusX: 0.285, radiusZ: 0.19, y: 0.12, length: 0.17, width: 0.052 },
    { count: 28, radiusX: 0.235, radiusZ: 0.155, y: 0.17, length: 0.135, width: 0.06 },
  ];
  let tuftIndex = 0;
  for (const [layerIndex, layer] of layers.entries()) {
    for (let tuft = 0; tuft < layer.count; tuft++) {
      const angle = (tuft / layer.count) * Math.PI * 2 + layerIndex * 0.13;
      const normalX = Math.cos(angle);
      const normalZ = Math.sin(angle);
      const tangentX = -normalZ;
      const tangentZ = normalX;
      const baseX = normalX * layer.radiusX;
      const baseZ = normalZ * layer.radiusZ;
      const random = noise(tuftIndex, layerIndex, 53);
      const length = layer.length * (0.78 + random * 0.48);
      const width = layer.width * (0.75 + noise(tuftIndex, layerIndex, 89) * 0.55);
      const shade = 0.66 + noise(tuftIndex, layerIndex, 127) * 0.34;
      const vertexColor = [
        Math.min(1, shade * 1.08),
        shade * (0.84 + random * 0.12),
        shade * (0.66 + random * 0.15),
      ];
      const vertexStart = positions.length / 3;
      const sections = [[0, 1], [0.35, 0.82], [0.72, 0.47], [1, 0.025]];
      for (const [fall, taper] of sections) {
        const rowY = layer.y - fall * length + Math.sin(angle * 3 + layerIndex) * 0.008;
        const outward = 0.008 + fall * (0.025 + random * 0.025);
        const halfWidth = width * taper;
        const halfDepth = 0.032 * taper;
        for (let segment = 0; segment < crossSegments; segment++) {
          const crossAngle = (segment / crossSegments) * Math.PI * 2;
          const tangent = Math.cos(crossAngle) * halfWidth;
          const radial = outward + Math.sin(crossAngle) * halfDepth;
          positions.push(
            baseX + tangentX * tangent + normalX * radial,
            rowY,
            baseZ + tangentZ * tangent + normalZ * radial,
          );
          uvs.push(segment / crossSegments, fall);
          colors.push(...vertexColor);
        }
      }
      for (let section = 0; section < sections.length - 1; section++) {
        for (let segment = 0; segment < crossSegments; segment++) {
          const next = (segment + 1) % crossSegments;
          const a = vertexStart + section * crossSegments + segment;
          const b = vertexStart + section * crossSegments + next;
          const c = vertexStart + (section + 1) * crossSegments + next;
          const d = vertexStart + (section + 1) * crossSegments + segment;
          indices.push(a, b, d, b, c, d);
        }
      }
      tuftIndex++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  addMesh(chest, 'Layered tapered wolf-fur locks', geometry, mat('Wolf-fur strand variation'));
}

addTorsoSkin();
addCape();

// Under-armor and shaped body volumes.
ellipsoid(hips, 'Layered leather waist', 'Dark oxblood leather', [0, 0.025, 0], [0.235, 0.16, 0.145]);
ellipsoid(chest, 'Padded gambeson', 'Woven charcoal wool', [0, -0.055, 0], [0.235, 0.20, 0.12]);
ellipsoid(neck, 'Mail gorget underlayer', 'Dark iron mail', [0, 0, 0], [0.11, 0.13, 0.11]);
ellipsoid(head, 'Visible face beneath visor', 'Skin beneath the helm', [0, 0.015, 0.012], [0.105, 0.132, 0.095]);

// Main cuirass: overlapping, curved plates with hand-laid knotwork and forged rivets.
const breastOutline = [
  [-0.32, 0.50], [-0.18, 0.47], [0, 0.44], [0.18, 0.47], [0.32, 0.50],
  [0.46, 0.27], [0.39, -0.17], [0.24, -0.38], [0, -0.50],
  [-0.24, -0.38], [-0.39, -0.17], [-0.46, 0.27],
];
plate(chest, 'Forged central cuirass · sculpted shell', 'Worn Nordic steel', [0, -0.045, 0.145], 0.57, 0.50, 0.09, [0, 0, 0], breastOutline);
plate(chest, 'Left raised pectoral guard', 'Obsidian steel', [-0.145, 0.005, 0.205], 0.28, 0.32, 0.075, [0, 0, -0.10]);
plate(chest, 'Right raised pectoral guard', 'Obsidian steel', [0.145, 0.005, 0.205], 0.28, 0.32, 0.075, [0, 0, 0.10]);
plate(chest, 'Cuirass lower articulated lame', 'Worn Nordic steel', [0, -0.31, 0.155], 0.43, 0.16, 0.055, [0, 0, 0]);
plate(chest, 'Cuirass collar crest', 'Brushed silver edges', [0, 0.205, 0.14], 0.22, 0.09, 0.035);
for (const sign of [-1, 1]) {
  tube(chest, `Breastplate engraved sweep ${sign}`, mat('Brushed silver edges'), [
    [sign * 0.045, 0.145, 0.265], [sign * 0.12, 0.085, 0.273],
    [sign * 0.20, 0.035, 0.262], [sign * 0.26, -0.045, 0.235],
  ], 0.006, 22);
  tube(chest, `Nordic chest rune branch ${sign}`, mat('Aged bronze fittings'), [
    [sign * 0.06, 0.13, 0.278], [sign * 0.11, 0.08, 0.28],
    [sign * 0.08, 0.025, 0.282], [sign * 0.13, -0.025, 0.276],
    [sign * 0.18, -0.01, 0.268],
  ], 0.008, 26);
}
tube(chest, 'Cuirass central engraved rune', mat('Aged bronze fittings'), [
  [0, 0.17, 0.282], [0, 0.11, 0.286], [-0.025, 0.065, 0.285],
  [0.025, 0.02, 0.285], [0, -0.025, 0.286], [0, -0.13, 0.281],
], 0.009, 30);
for (const y of [0.16, 0.055, -0.055, -0.17]) {
  rivets(chest, `Cuirass rivet row ${y}`, 'Brushed silver edges', [
    [-0.23, y, 0.245], [0.23, y, 0.245],
  ], 0.012);
}

// Layered rear cuirass, crossed harness, and a plated spine remain visible around the split cloak.
plate(chest, 'Rear cuirass · central backplate', 'Worn Nordic steel',
  [0, -0.045, -0.155], 0.54, 0.47, 0.075, [0, Math.PI, 0], breastOutline);
for (const sign of [-1, 1]) {
  plate(chest, `Rear scapula guard ${sign}`, 'Obsidian steel',
    [sign * 0.145, 0.055, -0.225], 0.25, 0.22, 0.055, [0, Math.PI, sign * 0.08]);
  plate(chest, `Rear scapula raised ridge ${sign}`, 'Brushed silver edges',
    [sign * 0.145, 0.06, -0.268], 0.075, 0.18, 0.024, [0, Math.PI, sign * 0.08]);
  const harness = sign < 0
    ? [[-0.23, 0.16, -0.245], [-0.16, 0.08, -0.29], [-0.06, -0.005, -0.30], [0.13, -0.16, -0.265]]
    : [[0.23, 0.16, -0.245], [0.16, 0.08, -0.29], [0.06, -0.005, -0.30], [-0.13, -0.16, -0.265]];
  tube(chest, `Cross-back leather harness ${sign}`, mat('Dark oxblood leather'), harness, 0.022, 26);
  tube(chest, `Harness stitched seam ${sign}`, mat('Aged bronze fittings'),
    harness.map(([x, y, z]) => [x * 0.94, y, z - 0.022]), 0.003, 24);
  rivets(chest, `Backplate shoulder rivets ${sign}`, 'Aged bronze fittings',
    [[sign * 0.21, 0.15, -0.25], [sign * 0.20, -0.09, -0.25], [sign * 0.08, 0.18, -0.24]], 0.011);
}
plate(chest, 'Back harness bronze buckle', 'Aged bronze fittings', [0, -0.005, -0.315], 0.105, 0.085, 0.025, [0, Math.PI, 0]);
plate(chest, 'Back buckle dark inset', 'Obsidian steel', [0, -0.005, -0.333], 0.055, 0.04, 0.012, [0, Math.PI, 0]);
plate(chest, 'Back cuirass upper lame', 'Worn Nordic steel', [0, -0.285, -0.155], 0.43, 0.12, 0.05, [0, Math.PI, 0]);
plate(chest, 'Back cuirass lower lame', 'Worn Nordic steel', [0, -0.385, -0.15], 0.38, 0.12, 0.045, [0, Math.PI, 0]);
tube(chest, 'Back cuirass engraved spine', mat('Brushed silver edges'), [
  [0, 0.17, -0.286], [0, 0.08, -0.292], [0, -0.03, -0.297],
  [0, -0.13, -0.292], [0, -0.23, -0.279],
], 0.006, 24);

// The narrow backing collar supports overlapping, tapered fur clumps.
addMesh(chest, 'Wolf-fur undercoat collar', new THREE.TorusGeometry(0.245, 0.042, 10, 56),
  mat('Natural wolf fur'), [0, 0.16, -0.015], [Math.PI / 2, 0, 0], [1.05, 1, 0.78]);
addFurMantle();
plate(chest, 'Wolf mantle bronze clasp', 'Aged bronze fittings', [0, 0.17, 0.235], 0.11, 0.13, 0.025);

// Articulated faulds, leather belt, belt hardware, and split hanging straps.
cylinder(hips, 'Hammered waist belt', 'Dark oxblood leather', [0, 0.10, 0], 0.239, 0.239, 0.075, [0, 0, 0], 32);
plate(hips, 'Belt buckle frame', 'Aged bronze fittings', [0, 0.105, 0.16], 0.105, 0.095, 0.025);
plate(hips, 'Belt buckle inset', 'Obsidian steel', [0, 0.105, 0.178], 0.06, 0.055, 0.016);
for (const sign of [-1, 1]) {
  for (let segment = 0; segment < 3; segment++) {
    plate(hips, `Fauld ${sign} · lame ${segment + 1}`, 'Worn Nordic steel',
      [sign * (0.11 + segment * 0.025), -0.005 - segment * 0.085, 0.125 - segment * 0.008],
      0.18, 0.13, 0.043, [0, 0, sign * 0.18]);
  }
}
for (let index = 0; index < 4; index++) {
  const x = (index - 1.5) * 0.105;
  plate(hips, `Hanging leather strap ${index + 1}`, 'Dark oxblood leather',
    [x, -0.28 - (index % 2) * 0.035, 0.125], 0.078, 0.37, 0.025, [0, 0, x * 0.8]);
  plate(hips, `Strap tip steel cap ${index + 1}`, 'Brushed silver edges',
    [x, -0.47 - (index % 2) * 0.035, 0.149], 0.08, 0.055, 0.024);
  for (let stitch = 0; stitch < 6; stitch++) {
    ellipsoid(hips, `Strap ${index + 1} stitch ${stitch + 1}`, 'Aged bronze fittings',
      [x + 0.029, -0.12 - stitch * 0.045, 0.149], [0.004, 0.009, 0.004], 8);
  }
}
plate(hips, 'Rear belt reinforcement', 'Dark oxblood leather', [0, 0.105, -0.135], 0.43, 0.09, 0.035, [0, Math.PI, 0]);
plate(hips, 'Rear belt buckle', 'Aged bronze fittings', [0, 0.105, -0.17], 0.095, 0.085, 0.025, [0, Math.PI, 0]);
for (let segment = 0; segment < 3; segment++) {
  plate(hips, `Rear fauld · lame ${segment + 1}`, 'Worn Nordic steel',
    [0, -0.015 - segment * 0.082, -0.14 - segment * 0.006],
    0.41 - segment * 0.035, 0.12, 0.045, [0, Math.PI, 0]);
}
for (const sign of [-1, 1]) {
  plate(hips, `Rear hanging leather strap ${sign}`, 'Dark oxblood leather',
    [sign * 0.12, -0.20, -0.135], 0.075, 0.31, 0.03, [0, Math.PI, sign * 0.08]);
  plate(hips, `Rear strap steel end ${sign}`, 'Brushed silver edges',
    [sign * 0.12, -0.365, -0.16], 0.08, 0.055, 0.02, [0, Math.PI, sign * 0.08]);
  for (let rivet = 0; rivet < 3; rivet++) {
    ellipsoid(hips, `Rear fauld rivet ${sign} ${rivet + 1}`, 'Aged bronze fittings',
      [sign * (0.13 + rivet * 0.045), -0.055 - rivet * 0.07, -0.185],
      [0.01, 0.01, 0.008], 8);
  }
}

// Nordic helmet: deep brow, cheek plates, nasal guard, riveted bowl, and a short crest.
const helmet = new THREE.Group();
helmet.name = 'Wolf-crest Nordic helmet';
head.add(helmet);
addMesh(helmet, 'Raised helmet crown', new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
  mat('Obsidian steel'), [0, 0.085, 0], [0, 0, 0], [0.152, 0.19, 0.143]);
plate(helmet, 'Helmet brow band', 'Worn Nordic steel', [0, 0.004, 0.132], 0.30, 0.075, 0.042);
plate(helmet, 'Long nasal guard', 'Brushed silver edges', [0, -0.075, 0.148], 0.06, 0.22, 0.035);
plate(helmet, 'Nasal tip reinforcement', 'Obsidian steel', [0, -0.16, 0.15], 0.09, 0.06, 0.025);
for (const sign of [-1, 1]) {
  plate(helmet, `Helmet cheek guard ${sign}`, 'Obsidian steel', [sign * 0.105, -0.105, 0.07], 0.11, 0.22, 0.045, [0, 0, sign * 0.1]);
  plate(helmet, `Helmet ear rondel ${sign}`, 'Aged bronze fittings', [sign * 0.15, -0.01, 0], 0.075, 0.085, 0.025);
  tube(helmet, `Helmet engraved cheek line ${sign}`, mat('Brushed silver edges'), [
    [sign * 0.13, -0.16, 0.11], [sign * 0.11, -0.08, 0.145], [sign * 0.09, 0, 0.15],
  ], 0.005, 18);
}
plate(helmet, 'Wolf-crest helmet ridge', 'Brushed silver edges', [0, 0.16, 0.005], 0.085, 0.24, 0.035);
for (let index = 0; index < 9; index++) {
  const y = -0.01 + index * 0.018;
  ellipsoid(helmet, `Helmet brow rivet ${index + 1}`, 'Aged bronze fittings',
    [-0.125 + index * 0.031, y, 0.163], [0.008, 0.008, 0.006], 8);
}
plate(helmet, 'Visor shadow', 'Obsidian steel', [0, -0.024, 0.152], 0.19, 0.028, 0.018);

// Shoulders, vambraces, articulated gauntlets, and finger plates.
for (const side of ['L', 'R']) {
  const limb = limbs[side];
  const sign = limb.sign;
  ellipsoid(limb.upperArm, `Padded upper arm ${side}`, 'Dark oxblood leather', [0, -0.13, 0], [0.105, 0.22, 0.105]);
  ellipsoid(limb.forearm, `Padded forearm ${side}`, 'Woven charcoal wool', [0, -0.14, 0], [0.09, 0.20, 0.09]);
  ellipsoid(limb.thigh, `Leg underlayer ${side}`, 'Dark oxblood leather', [0, -0.20, 0], [0.14, 0.27, 0.13]);
  ellipsoid(limb.shin, `Boot underlayer ${side}`, 'Woven charcoal wool', [0, -0.17, 0], [0.105, 0.23, 0.115]);
  ellipsoid(limb.foot, `Armored boot ${side}`, 'Dark oxblood leather', [0, -0.015, 0.095], [0.115, 0.09, 0.19]);

  ellipsoid(limb.clavicle, `Shoulder pauldron core ${side}`, 'Obsidian steel', [sign * 0.015, 0.015, 0], [0.19, 0.13, 0.17]);
  plate(limb.clavicle, `Layered wolf-shoulder plate ${side}`, 'Worn Nordic steel',
    [sign * 0.012, 0.045, 0.10], 0.34, 0.27, 0.075, [0, 0, sign * 0.12]);
  plate(limb.clavicle, `Shoulder plate raised ridge ${side}`, 'Brushed silver edges',
    [sign * 0.012, 0.045, 0.158], 0.15, 0.22, 0.032, [0, 0, sign * 0.08]);
  plate(limb.clavicle, `Rear shoulder plate ${side}`, 'Obsidian steel',
    [sign * 0.012, 0.035, -0.10], 0.31, 0.24, 0.06, [0, Math.PI, sign * 0.1]);
  plate(limb.clavicle, `Pauldron underside lame ${side}`, 'Obsidian steel',
    [sign * 0.02, -0.115, 0.075], 0.28, 0.12, 0.045, [0, 0, sign * 0.15]);
  rivets(limb.clavicle, `Pauldron rim rivets ${side}`, 'Aged bronze fittings',
    [[-0.13, 0.10, 0.17], [-0.06, 0.15, 0.18], [0.02, 0.16, 0.18], [0.10, 0.13, 0.16], [0.15, 0.07, 0.13]]
      .map(([x, y, z]) => [sign * x, y, z]), 0.012);
  plate(limb.upperArm, `Upper arm couter ${side}`, 'Worn Nordic steel', [0, -0.12, 0.09], 0.17, 0.24, 0.055);
  plate(limb.forearm, `Layered vambrace ${side}`, 'Obsidian steel', [0, -0.14, 0.075], 0.17, 0.28, 0.06);
  plate(limb.forearm, `Vambrace silver spine ${side}`, 'Brushed silver edges', [0, -0.14, 0.125], 0.045, 0.25, 0.022);
  for (const y of [-0.04, -0.23]) {
    cylinder(limb.forearm, `Vambrace leather binding ${side} ${y}`, 'Dark oxblood leather', [0, y, 0], 0.098, 0.098, 0.035, [0, 0, Math.PI / 2], 20);
    rivets(limb.forearm, `Vambrace rivets ${side} ${y}`, 'Aged bronze fittings',
      [[-0.045, y, 0.087], [0.045, y, 0.087]], 0.009);
  }
  ellipsoid(limb.hand, `Articulated gauntlet palm ${side}`, 'Obsidian steel', [0, -0.025, 0.015], [0.095, 0.105, 0.09]);
  plate(limb.hand, `Gauntlet hand plate ${side}`, 'Worn Nordic steel', [0, -0.01, 0.085], 0.15, 0.11, 0.04);
  for (let finger = 0; finger < 4; finger++) {
    const x = (finger - 1.5) * 0.039;
    cylinder(limb.hand, `Gauntlet finger ${side} ${finger + 1}`, 'Worn Nordic steel',
      [x, -0.115, 0.025], 0.014, 0.018, 0.105, [0, 0, x * 1.5], 10);
    ellipsoid(limb.hand, `Finger knuckle ${side} ${finger + 1}`, 'Brushed silver edges',
      [x, -0.07, 0.065], [0.019, 0.018, 0.013], 10);
  }
  cylinder(limb.hand, `Gauntlet thumb ${side}`, 'Worn Nordic steel', [sign * 0.11, -0.045, 0.04], 0.018, 0.023, 0.075, [0, 0, sign * 0.7], 10);

  plate(limb.thigh, `Knee cop ${side}`, 'Worn Nordic steel', [0, -0.35, 0.12], 0.20, 0.17, 0.055);
  plate(limb.thigh, `Knee engraved boss ${side}`, 'Aged bronze fittings', [0, -0.35, 0.167], 0.075, 0.08, 0.02);
  plate(limb.shin, `Greave front ${side}`, 'Obsidian steel', [0, -0.16, 0.095], 0.18, 0.32, 0.06);
  plate(limb.shin, `Greave raised ridge ${side}`, 'Brushed silver edges', [0, -0.16, 0.15], 0.045, 0.27, 0.022);
  for (const y of [-0.04, -0.27]) {
    cylinder(limb.shin, `Greave leather strap ${side} ${y}`, 'Dark oxblood leather', [0, y, 0], 0.115, 0.115, 0.035, [0, 0, Math.PI / 2], 20);
    plate(limb.shin, `Greave buckle ${side} ${y}`, 'Aged bronze fittings', [sign * 0.11, y, 0.015], 0.07, 0.055, 0.018);
  }
  plate(limb.foot, `Boot toe cap ${side}`, 'Worn Nordic steel', [0, 0.005, 0.145], 0.19, 0.11, 0.045);
  plate(limb.foot, `Boot instep plate ${side}`, 'Obsidian steel', [0, 0.055, 0.075], 0.15, 0.10, 0.04);
  for (let lace = 0; lace < 4; lace++) {
    tube(limb.foot, `Boot lacing ${side} ${lace + 1}`, mat('Aged bronze fittings'), [
      [-0.045, 0.065 - lace * 0.018, 0.105], [0.045, 0.045 - lace * 0.018, 0.105],
    ], 0.004, 8);
  }
}

// Forged longsword attached to a named weapon socket; fuller, bevel, guard and wrapped grip.
const sword = new THREE.Group();
sword.name = 'Nordic longsword · right-hand attachment';
weaponSocket.add(sword);
const bladeVertices = [];
const bladeFaces = [];
const bladeSections = [
  [-0.13, 0.043, 0.012],
  [-0.61, 0.037, 0.011],
  [-0.75, 0.024, 0.008],
];
for (const [y, halfWidth, halfThickness] of bladeSections) {
  bladeVertices.push(
    [0, y, halfThickness], [halfWidth * 0.55, y, halfThickness * 0.55],
    [halfWidth, y, 0], [halfWidth * 0.55, y, -halfThickness * 0.55],
    [0, y, -halfThickness], [-halfWidth * 0.55, y, -halfThickness * 0.55],
    [-halfWidth, y, 0], [-halfWidth * 0.55, y, halfThickness * 0.55],
  );
}
for (let ring = 0; ring < bladeSections.length - 1; ring++) {
  for (let side = 0; side < 8; side++) {
    const next = (side + 1) % 8;
    const a = ring * 8 + side;
    const b = ring * 8 + next;
    const c = (ring + 1) * 8 + next;
    const d = (ring + 1) * 8 + side;
    bladeFaces.push(a, b, d, b, c, d);
  }
}
bladeVertices.push([0, -0.13, 0]);
const bladeBaseCenter = bladeVertices.length - 1;
for (let side = 0; side < 8; side++) bladeFaces.push(bladeBaseCenter, (side + 1) % 8, side);
bladeVertices.push([0, -0.84, 0]);
const bladeTip = bladeVertices.length - 1;
for (let side = 0; side < 8; side++) {
  const lastRing = (bladeSections.length - 1) * 8;
  bladeFaces.push(lastRing + side, lastRing + (side + 1) % 8, bladeTip);
}
const bladeGeometry = new THREE.BufferGeometry();
bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladeVertices.flat(), 3));
bladeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bladeVertices.flatMap(([x, y]) => [x / 0.086 + 0.5, (y + 0.84) / 0.71]), 2));
bladeGeometry.setIndex(bladeFaces);
bladeGeometry.computeVertexNormals();
addMesh(sword, 'Longsword double-edged steel blade', bladeGeometry, mat('Forged blade steel'));
plate(sword, 'Sword crossguard', 'Worn Nordic steel', [0, -0.095, 0], 0.39, 0.075, 0.05, [0, 0, 0]);
for (const sign of [-1, 1]) {
  ellipsoid(sword, `Crossguard quillon ${sign}`, 'Brushed silver edges', [sign * 0.19, -0.095, 0], [0.035, 0.05, 0.035], 12);
}
cylinder(sword, 'Leather-bound sword grip', 'Dark oxblood leather', [0, 0.09, 0], 0.034, 0.042, 0.29, [0, 0, 0], 12);
for (let wrap = 0; wrap < 10; wrap++) {
  const y = -0.035 + wrap * 0.027;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.0045, 6, 14), mat('Aged bronze fittings'));
  ring.name = `Sword grip binding ${wrap + 1}`;
  ring.position.set(0, y, 0);
  ring.rotation.x = Math.PI / 2;
  sword.add(ring);
}
ellipsoid(sword, 'Sword pommel', 'Aged bronze fittings', [0, 0.255, 0], [0.065, 0.055, 0.048], 16);
plate(sword, 'Pommel wolf sigil', 'Brushed silver edges', [0, 0.256, 0.045], 0.045, 0.045, 0.012);
tube(sword, 'Sword blade fuller', mat('Obsidian steel'), [
  [0, -0.20, 0.012], [0, -0.45, 0.011], [0, -0.68, 0.009], [0, -0.78, 0.006],
], 0.006, 20);

for (const [name, position, materialName, size] of [
  ['Chest chain mail left', [-0.21, 0.06, 0.11], 'Dark iron mail', [0.045, 0.15, 0.04]],
  ['Chest chain mail right', [0.21, 0.06, 0.11], 'Dark iron mail', [0.045, 0.15, 0.04]],
]) ellipsoid(chest, name, materialName, position, size, 20);

character.updateMatrixWorld(true);

function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
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

function makePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const color = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = Math.max(0, Math.min(255, color[0]));
      raw[offset + 1] = Math.max(0, Math.min(255, color[1]));
      raw[offset + 2] = Math.max(0, Math.min(255, color[2]));
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 8 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function noise(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

const texturePalette = {
  blackenedSteel: { base: [63, 70, 72], metal: 0.7, rough: 0.66, grain: 'brushed' },
  steel: { base: [151, 163, 165], metal: 0.8, rough: 0.64, grain: 'brushed' },
  silver: { base: [181, 190, 188], metal: 0.84, rough: 0.46, grain: 'brushed' },
  leather: { base: [105, 61, 36], metal: 0.02, rough: 0.86, grain: 'leather' },
  cloth: { base: [68, 61, 51], metal: 0, rough: 0.94, grain: 'woven' },
  fur: { base: [145, 122, 85], metal: 0, rough: 0.98, grain: 'fur' },
  bronze: { base: [146, 104, 50], metal: 0.64, rough: 0.58, grain: 'patina' },
  skin: { base: [159, 111, 82], metal: 0, rough: 0.88, grain: 'skin' },
};

function textureSet(type, size = 256) {
  const palette = texturePalette[type];
  const seed = type.length * 31;
  const detail = (x, y) => noise(x, y, seed);
  const baseColor = makePng(size, (x, y) => {
    const grain = detail(x, y);
    const cloud = noise(Math.floor(x / 8), Math.floor(y / 8), seed + 5);
    const scratches = palette.grain === 'brushed' && detail(x, Math.floor(y / 3)) > 0.986 ? -62 : 0;
    const fibers = palette.grain === 'woven'
      ? (Math.sin(x * 0.82) + Math.sin(y * 0.77)) * 4
      : palette.grain === 'fur'
        ? Math.sin(x * 0.31 + Math.sin(y * 0.11)) * 14 + (detail(x, Math.floor(y / 4)) - 0.5) * 12
        : palette.grain === 'leather'
            ? (detail(Math.floor(x / 3), Math.floor(y / 3)) - 0.5) * 34
          : 0;
    const organic = palette.grain === 'fur' || palette.grain === 'skin'
        ? (noise(Math.floor(x / 12), Math.floor(y / 9), seed + 13) - 0.5) * 34
        : 0;
    const variation = (grain - 0.5) * 22 + (cloud - 0.5) * 28 + scratches + fibers + organic;
    const patina = palette.grain === 'patina' && cloud > 0.76 ? -18 : 0;
    return palette.base.map((channel, index) => channel + variation * (index === 0 ? 1 : index === 1 ? 0.94 : 0.86) + patina);
  });
  const normal = makePng(size, (x, y) => {
    const dx = (detail(x + 1, y) - detail(x - 1, y)) * (palette.grain === 'fur' ? 0.25 : 0.14);
    const dy = (detail(x, y + 1) - detail(x, y - 1)) * (palette.grain === 'fur' ? 0.28 : 0.14);
    const weave = palette.grain === 'woven' ? Math.sin(x * 0.8) * 4 : 0;
    return [128 + dx * 255, 128 + dy * 255 + weave, 252];
  });
  const metalRoughness = makePng(size, (x, y) => {
    const variation = detail(Math.floor(x / 2), Math.floor(y / 2));
    const brushed = palette.grain === 'brushed' ? Math.sin(x * 0.18) * 10 : 0;
    const worn = palette.grain === 'leather' && variation > 0.93 ? -12 : 0;
    return [255, palette.rough * 255 + (variation - 0.5) * 34 + brushed + worn, palette.metal * 255 + (variation - 0.5) * 26];
  });
  return { baseColor, normal, metalRoughness };
}

function rewriteGlbWithTextures(exported, textureTypes) {
  const input = Buffer.from(exported);
  if (input.toString('ascii', 0, 4) !== 'glTF' || input.readUInt32LE(4) !== 2) {
    throw new Error('Three.js exporter did not produce a valid GLB 2.0 file.');
  }
  const jsonLength = input.readUInt32LE(12);
  const json = JSON.parse(input.toString('utf8', 20, 20 + jsonLength).trim());
  const binPrefix = 20 + jsonLength;
  const binLength = input.readUInt32LE(binPrefix);
  const binaryStart = binPrefix + 8;
  let binary = input.subarray(binaryStart, binaryStart + binLength);
  if (!json.bufferViews) json.bufferViews = [];
  if (!json.images) json.images = [];
  if (!json.textures) json.textures = [];
  if (!json.samplers) json.samplers = [];
  if (!json.samplers.length) json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
  const images = [];
  for (const [type, maps] of Object.entries(textureTypes)) {
    for (const [mapName, png] of Object.entries(maps)) {
      while (binary.length % 4) binary = Buffer.concat([binary, Buffer.from([0])]);
      const byteOffset = binary.length;
      binary = Buffer.concat([binary, png]);
      const bufferView = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length });
      const image = json.images.length;
      json.images.push({ name: `${type}_${mapName}`, bufferView, mimeType: 'image/png' });
      const texture = json.textures.length;
      json.textures.push({ sampler: 0, source: image });
      images.push({ type, mapName, texture });
    }
  }
  json.buffers[0].byteLength = binary.length;
  const mapsByType = new Map();
  for (const image of images) {
    const maps = mapsByType.get(image.type) ?? {};
    maps[image.mapName] = image.texture;
    mapsByType.set(image.type, maps);
  }
  // Material names map explicitly to texture families; keep shader color factors intact.
  const materialTextureMap = {
    'Obsidian steel': 'blackenedSteel',
    'Worn Nordic steel': 'steel',
    'Brushed silver edges': 'silver',
    'Dark oxblood leather': 'leather',
    'Woven charcoal wool': 'cloth',
    'Natural wolf fur': 'fur',
    'Wolf-fur strand variation': 'fur',
    'Aged bronze fittings': 'bronze',
    'Forged blade steel': 'silver',
    'Dark iron mail': 'blackenedSteel',
    'Skin beneath the helm': 'skin',
  };
  for (const material of json.materials ?? []) {
    const maps = mapsByType.get(materialTextureMap[material.name]);
    if (!maps) continue;
    material.pbrMetallicRoughness ??= {};
    material.pbrMetallicRoughness.baseColorTexture = { index: maps.baseColor };
    material.pbrMetallicRoughness.metallicRoughnessTexture = { index: maps.metalRoughness };
    material.normalTexture = { index: maps.normal, scale: 0.58 };
  }
  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const paddedJsonLength = Math.ceil(jsonChunk.length / 4) * 4;
  const jsonPadded = Buffer.concat([jsonChunk, Buffer.alloc(paddedJsonLength - jsonChunk.length, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + paddedBinary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBinary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, paddedBinary]);
}

const exporter = new GLTFExporter();
const exported = await exporter.parseAsync(scene, {
  binary: true,
  trs: true,
  onlyVisible: true,
  maxTextureSize: 1024,
});
const textureTypes = Object.fromEntries(Object.keys(texturePalette).map((type) => [type, textureSet(type)]));
const finalGlb = rewriteGlbWithTextures(exported, textureTypes);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, finalGlb);

const output = fs.readFileSync(outputPath);
const outputJsonLength = output.readUInt32LE(12);
const outputJson = JSON.parse(output.toString('utf8', 20, 20 + outputJsonLength).trim());
const skinCount = outputJson.skins?.length ?? 0;
const animationCount = outputJson.animations?.length ?? 0;
const meshCount = outputJson.meshes?.length ?? 0;
const originalSize = fs.statSync(originalPath).size;
console.log(`Created ${path.relative(root, outputPath)} (${(output.length / 1024 / 1024).toFixed(2)} MiB)`);
console.log(`Distinct geometry nodes: ${outputJson.nodes.length}; meshes: ${meshCount}; skins: ${skinCount}; bones: ${bones.length}; materials: ${outputJson.materials.length}; embedded images: ${outputJson.images.length}; animations: ${animationCount}`);
console.log(`Original preserved: ${originalSize.toLocaleString()} bytes`);
