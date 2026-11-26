import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { AssetManager } from '../core/AssetManager';
import type { GraphicsConfig } from '../core/GraphicsConfig';
import type { GameLocation } from '../core/types';
import { AmbientAudio } from './AmbientAudio';

interface InstanceSpec {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  color?: THREE.Color;
}

interface PathDefinition {
  curve: THREE.CatmullRomCurve3;
  width: number;
}

const WORLD_SIZE = 120;
const HALF_WORLD = WORLD_SIZE / 2;
const TERRAIN_SEGMENTS = 144;
const CHUNK_SIZE = 40;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function randomGenerator(initialSeed: number): () => number {
  let seed = initialSeed;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function chunkKey(x: number, z: number): string {
  const column = Math.floor((x + HALF_WORLD) / CHUNK_SIZE);
  const row = Math.floor((z + HALF_WORLD) / CHUNK_SIZE);
  return `${column},${row}`;
}

function createCanopyGeometry(type: 'pine' | 'broadleaf', detail: number): THREE.BufferGeometry {
  const geometry = type === 'pine'
    ? new THREE.ConeGeometry(1, 1, detail === 0 ? 12 : 24, detail === 0 ? 7 : 16)
    : new THREE.IcosahedronGeometry(1, detail);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const radialVariation = Math.sin(angle * 7 + y * 17) * 0.045
      + Math.sin(angle * 13 - y * 23) * 0.025
      + Math.sin(x * 19 + z * 17 + y * 11) * 0.018;
    if (type === 'pine') {
      const tierVariation = Math.sin((y + 0.5) * Math.PI * 9 + Math.sin(angle * 5) * 0.45) * 0.055;
      const sourceRadius = Math.hypot(x, z);
      const radius = sourceRadius * (1 + radialVariation + tierVariation);
      if (sourceRadius > 0) {
        positions.setX(index, (x / sourceRadius) * radius);
        positions.setZ(index, (z / sourceRadius) * radius);
      }
    } else {
      const radius = 1 + radialVariation;
      positions.setXYZ(index, x * radius, y * radius, z * radius);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTrunkGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.055, 0.2, 1, 12, 8);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const y = positions.getY(index) + 0.5;
    positions.setX(index, positions.getX(index) + Math.sin(y * Math.PI * 1.4) * y * 0.025);
    positions.setZ(index, positions.getZ(index) + Math.sin(y * Math.PI * 2.1) * y * 0.018);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export class WorldEnvironment {
  private readonly colliders: RAPIER.RigidBody[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly windUniforms: Array<{ value: number }> = [];
  private readonly waterTimeUniforms: Array<{ value: number }> = [];
  private readonly natureModels: THREE.Object3D[] = [];
  private readonly curvePoints = new Map<THREE.CatmullRomCurve3, THREE.Vector3[]>();
  private readonly riverCurve: THREE.CatmullRomCurve3;
  private readonly paths: PathDefinition[];
  private readonly audio = new AmbientAudio();
  private disposed = false;
  private terrainTexture!: THREE.DataTexture;
  private cloudTexture!: THREE.DataTexture;
  private particles!: THREE.Points;
  private smokeParticles: THREE.Points | null = null;
  private lavaMaterial: THREE.MeshStandardMaterial | null = null;
  private lavaTerrainMaterial: THREE.MeshStandardMaterial | null = null;
  private sun!: THREE.DirectionalLight;
  private hemisphere!: THREE.HemisphereLight;
  private warmLight: THREE.PointLight | null = null;
  private readonly brazierLights: THREE.PointLight[] = [];
  private readonly overcastSky = new THREE.Color(0xb9c8d1);
  private readonly clearSky = new THREE.Color(0xffdfb2);
  private readonly overcastHaze = new THREE.Color(0x4c5d68);
  private readonly clearHaze = new THREE.Color(0x75848c);
  private elapsed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly physics: RAPIER.World,
    private graphics: GraphicsConfig,
    private readonly anchors: THREE.Vector3[],
    private readonly location: GameLocation,
  ) {
    if (location === 'floor2' || location === 'floor4') {
      this.overcastSky.setHex(0x96796e);
      this.clearSky.setHex(0xc98d68);
      this.overcastHaze.setHex(0x493634);
      this.clearHaze.setHex(0x69483c);
    } else if (location === 'floor3') {
      this.overcastSky.setHex(0x91a8b7);
      this.clearSky.setHex(0xc3d0d5);
      this.overcastHaze.setHex(0x36434d);
      this.clearHaze.setHex(0x526778);
    }

    this.riverCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-31, 0, -4),
      new THREE.Vector3(-21, 0, -9),
      new THREE.Vector3(-10, 0, -5),
      new THREE.Vector3(1, 0, -8),
      new THREE.Vector3(12, 0, -3),
      new THREE.Vector3(31, 0, -7),
    ]);
    this.paths = [
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 14),
          new THREE.Vector3(-3, 0, 8),
          new THREE.Vector3(-7, 0, 1),
          new THREE.Vector3(-10, 0, -7),
          new THREE.Vector3(-15, 0, -13),
        ]),
        width: 2.6,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(-15, 0, -13),
          new THREE.Vector3(-7, 0, -14),
          new THREE.Vector3(3, 0, -11),
          new THREE.Vector3(11, 0, -7),
          new THREE.Vector3(19, 0, -4),
        ]),
        width: 2.3,
      },
      {
        curve: new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 14),
          new THREE.Vector3(-9, 0, 17),
          new THREE.Vector3(-19, 0, 19),
          new THREE.Vector3(-29, 0, 17),
        ]),
        width: 2.1,
      },
    ];
    this.curvePoints.set(this.riverCurve, this.riverCurve.getPoints(64));
    for (const { curve } of this.paths) this.curvePoints.set(curve, curve.getPoints(64));

    this.buildTerrain();
    this.buildMountains();
    if (location === 'floor1') {
      this.buildPaths();
      this.buildRiver();
      this.buildForest();
      this.buildRuin();
      this.buildCave();
      this.buildAbandonedCamp();
      this.addReturnPortal();
    } else if (location === 'hub') {
      this.buildSanctuary();
    } else if (location === 'floor2' || location === 'floor4') {
      this.buildAshenSanctuary();
    } else {
      this.buildDragonThrone();
    }
    if (location !== 'hub') void this.buildNatureKit();
    this.buildLighting();
    this.buildParticles();
    for (const anchor of this.anchors) anchor.y = this.getSurfaceHeight(anchor.x, anchor.z);
  }

  getSurfaceHeight(x: number, z: number): number {
    const radius = Math.hypot(x, z);
    const foothills = Math.pow(Math.max(0, radius - 30), 1.2) * 0.09;
    const undulation = (
      Math.sin(x * 0.19 + z * 0.08) * 0.3
      + Math.cos(z * 0.17 - x * 0.11) * 0.23
      + Math.sin((x + z) * 0.31) * 0.1
    ) * smoothstep(7, 32, radius);
    const ridge = (
      7.5 * Math.exp(-(((x + 42) / 12) ** 2 + ((z + 14) / 20) ** 2))
      + 8.5 * Math.exp(-(((x - 37) / 14) ** 2 + ((z + 34) / 16) ** 2))
      + 6.5 * Math.exp(-(((x + 39) / 15) ** 2 + ((z - 34) / 17) ** 2))
      + 7 * Math.exp(-(((x - 14) / 18) ** 2 + ((z - 45) / 12) ** 2))
    );
    const clearing = Math.max(
      Math.exp(-(x ** 2 + (z - 13) ** 2) / 225),
      Math.exp(-((x + 15) ** 2 + (z + 13) ** 2) / 121),
      Math.exp(-((x - 19) ** 2 + (z + 4) ** 2) / 81),
      Math.exp(-((x + 29) ** 2 + (z - 17) ** 2) / 64),
    );
    const riverCut = this.location === 'floor1'
      ? Math.exp(-((this.distanceToCurve(x, z, this.riverCurve, 36) / 2.9) ** 2)) * 0.34
      : 0;
    return (foothills + undulation + ridge) * (1 - clearing) - riverCut;
  }

  update(delta: number): void {
    this.elapsed += delta;
    for (const uniform of this.windUniforms) uniform.value = this.elapsed;
    for (const uniform of this.waterTimeUniforms) uniform.value = this.elapsed;
    this.cloudTexture.offset.x = (this.elapsed * 0.00055) % 1;

    const positions = this.particles.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      let x = positions.getX(i) + Math.sin(this.elapsed * 0.27 + i) * delta * 0.2;
      let y = positions.getY(i);
      let z = positions.getZ(i) + Math.cos(this.elapsed * 0.21 + i * 0.7) * delta * 0.17;
      if (this.location === 'floor2' || this.location === 'floor4') {
        y += delta * (0.12 + (i % 5) * 0.045);
        if (y > this.getSurfaceHeight(x, z) + 10) {
          y = this.getSurfaceHeight(x, z) + 0.3 + (i % 6) * 0.45;
        }
      } else {
        y -= delta * (0.3 + (i % 5) * 0.08);
        if (y < this.getSurfaceHeight(x, z) + 0.35) {
          y = this.getSurfaceHeight(x, z) + 4 + (i % 6) * 0.5;
        }
      }
      if (x > 55) x = -55;
      else if (x < -55) x = 55;
      if (z > 55) z = -55;
      else if (z < -55) z = 55;
      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;

    if (this.smokeParticles) {
      const smokePositions = this.smokeParticles.geometry.getAttribute('position');
      for (let i = 0; i < smokePositions.count; i++) {
        let x = smokePositions.getX(i) + Math.sin(this.elapsed * 0.11 + i * 0.8) * delta * 0.13;
        let y = smokePositions.getY(i) + delta * (0.18 + (i % 4) * 0.035);
        let z = smokePositions.getZ(i) + Math.cos(this.elapsed * 0.13 + i) * delta * 0.1;
        if (y > this.getSurfaceHeight(x, z) + 10) {
          y = this.getSurfaceHeight(x, z) + 0.8 + (i % 8) * 0.45;
        }
        if (x > 28) x = -28;
        else if (x < -28) x = 28;
        smokePositions.setXYZ(i, x, y, z);
      }
      smokePositions.needsUpdate = true;
    }

    const daylight = 0.5 + 0.5 * Math.sin(this.elapsed * 0.018 - 0.7);
    this.sun.color.copy(this.overcastSky).lerp(this.clearSky, daylight * 0.2);
    this.sun.intensity = this.graphics.directionalLightIntensity * (0.88 + daylight * 0.12);
    this.hemisphere.color.copy(this.overcastSky).lerp(this.clearSky, daylight * 0.08);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.overcastHaze).lerp(this.clearHaze, daylight * 0.28);
      const fogNear = this.location === 'floor2' || this.location === 'floor4' ? 24 : this.location === 'floor3' ? 42 : 38;
      const fogFar = this.location === 'floor2' || this.location === 'floor4' ? 96 : this.location === 'floor3' ? 148 : 132;
      this.scene.fog.near = fogNear + daylight * 5;
      this.scene.fog.far = fogFar + daylight * 16;
    }
    if (this.warmLight) {
      this.warmLight.intensity = 0.78 + Math.sin(this.elapsed * 8.2) * 0.07 + Math.sin(this.elapsed * 13.7) * 0.035;
    }
    this.brazierLights.forEach((light, index) => {
      light.intensity = 1.1 + Math.sin(this.elapsed * (7.4 + index * 0.31)) * 0.12
        + Math.sin(this.elapsed * (12.8 + index * 0.17)) * 0.055;
    });
    if (this.lavaMaterial) {
      this.lavaMaterial.emissiveIntensity = 1.7 + Math.sin(this.elapsed * 2.4) * 0.25;
    }
    if (this.lavaTerrainMaterial) {
      this.lavaTerrainMaterial.emissiveIntensity = 0.85 + Math.sin(this.elapsed * 1.8) * 0.16;
    }
  }

  startAmbience(): void {
    this.audio.start();
  }

  setGraphicsConfig(graphics: GraphicsConfig): void {
    this.graphics = graphics;
    this.hemisphere.intensity = graphics.hemisphereLightIntensity;
    this.sun.castShadow = graphics.shadows;
    this.sun.shadow.mapSize.set(graphics.shadowMapSize, graphics.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.needsUpdate = true;
    this.terrainTexture.anisotropy = graphics.textureAnisotropy;
  }

  private buildTerrain(): void {
    const side = TERRAIN_SEGMENTS + 1;
    const positions = new Float32Array(side * side * 3);
    const colors = new Float32Array(side * side * 3);
    const uvs = new Float32Array(side * side * 2);
    const heights = new Float32Array(side * side);
    const indices = new Uint32Array(TERRAIN_SEGMENTS * TERRAIN_SEGMENTS * 6);
    const palette = this.location === 'floor2' || this.location === 'floor4'
      ? [0x514b49, 0x66544a, 0x555353, 0x8a7770]
      : this.location === 'floor3'
        ? [0x69716f, 0x776d62, 0x737a7b, 0xc1c9ca]
        : this.location === 'hub'
          ? [0x687465, 0x83745e, 0x767977, 0xc0c8c8]
          : [0x75816f, 0x89745d, 0x78838b, 0xbec8cc];
    const grassColor = new THREE.Color(palette[0]);
    const dirtColor = new THREE.Color(palette[1]);
    const rockColor = new THREE.Color(palette[2]);
    const highlandColor = new THREE.Color(palette[3]);
    const blendedColor = new THREE.Color();
    const gridSpacing = WORLD_SIZE / TERRAIN_SEGMENTS;
    let vertex = 0;
    let index = 0;

    for (let row = 0; row <= TERRAIN_SEGMENTS; row++) {
      const z = -HALF_WORLD + row * gridSpacing;
      for (let column = 0; column <= TERRAIN_SEGMENTS; column++) {
        const x = -HALF_WORLD + column * gridSpacing;
        heights[row * side + column] = this.getSurfaceHeight(x, z);
      }
    }

    for (let row = 0; row <= TERRAIN_SEGMENTS; row++) {
      const z = -HALF_WORLD + row * gridSpacing;
      for (let column = 0; column <= TERRAIN_SEGMENTS; column++) {
        const x = -HALF_WORLD + column * gridSpacing;
        const y = heights[vertex];
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        uvs[vertex * 2] = x / 10;
        uvs[vertex * 2 + 1] = z / 10;

        let pathBlend = 0;
        let bankBlend = 0;
        if (this.location === 'floor1') {
          let pathDistance = Number.POSITIVE_INFINITY;
          for (const path of this.paths) {
            const distance = this.distanceToCurve(x, z, path.curve, 44);
            if (distance < pathDistance) pathDistance = distance;
          }
          const riverDistance = this.distanceToCurve(x, z, this.riverCurve, 32);
          pathBlend = 1 - smoothstep(0.7, 2.15, pathDistance);
          bankBlend = (1 - smoothstep(2.2, 4.2, riverDistance)) * 0.72;
        }
        const left = heights[row * side + Math.max(0, column - 1)];
        const right = heights[row * side + Math.min(TERRAIN_SEGMENTS, column + 1)];
        const above = heights[Math.max(0, row - 1) * side + column];
        const below = heights[Math.min(TERRAIN_SEGMENTS, row + 1) * side + column];
        const slopeX = column === 0
          ? (right - y) / gridSpacing
          : column === TERRAIN_SEGMENTS
            ? (y - left) / gridSpacing
            : (right - left) / (2 * gridSpacing);
        const slopeZ = row === 0
          ? (below - y) / gridSpacing
          : row === TERRAIN_SEGMENTS
            ? (y - above) / gridSpacing
            : (below - above) / (2 * gridSpacing);
        const slope = Math.hypot(slopeX, slopeZ);
        const exposedStone = Math.max(smoothstep(4, 14, y) * 0.65, smoothstep(0.28, 0.95, slope) * 0.86);
        blendedColor.copy(grassColor).lerp(dirtColor, Math.max(pathBlend, bankBlend));
        blendedColor.lerp(rockColor, exposedStone);
        const highlandCover = smoothstep(6, 14, y)
          * (0.68 + 0.32 * Math.sin(x * 0.17 + z * 0.11) ** 2);
        const lowlandSnow = this.location === 'floor1'
          ? (0.16 + 0.16 * (0.5 + 0.5 * Math.sin(x * 0.12 + z * 0.08)))
            * (1 - pathBlend * 0.9)
            * (1 - bankBlend * 0.55)
          : 0;
        const groundVariation = (
          Math.sin(x * 0.09 + Math.cos(z * 0.07)) * 0.025
          + Math.cos(z * 0.13 - x * 0.055) * 0.018
        );
        const highlandBlend = highlandCover * (this.location === 'floor2' || this.location === 'floor4' ? 0.54 : 0.82);
        blendedColor.lerp(highlandColor, Math.max(highlandBlend, lowlandSnow));
        blendedColor.multiplyScalar(1 + groundVariation);
        colors[vertex * 3] = blendedColor.r;
        colors[vertex * 3 + 1] = blendedColor.g;
        colors[vertex * 3 + 2] = blendedColor.b;
        vertex++;

        if (row < TERRAIN_SEGMENTS && column < TERRAIN_SEGMENTS) {
          const a = row * side + column;
          const b = a + 1;
          const c = a + side;
          const d = c + 1;
          indices[index++] = a;
          indices[index++] = c;
          indices[index++] = b;
          indices[index++] = b;
          indices[index++] = c;
          indices[index++] = d;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    this.geometries.add(geometry);

    const texture = this.createGroundTexture();
    this.terrainTexture = texture;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    if (this.location === 'floor2' || this.location === 'floor4') {
      material.emissive.setHex(0xff5124);
      material.emissiveMap = this.createLavaFissureTexture();
      material.emissiveIntensity = 0.85;
      this.lavaTerrainMaterial = material;
    }
    this.materials.add(material);
    if (this.location === 'floor1') void this.applyForestGroundMaterial(material);
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    terrain.frustumCulled = false;
    this.scene.add(terrain);

    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.physics.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(1.1),
      body,
    );
    this.colliders.push(body);

    this.buildWorldBoundaries();
  }

  private async applyForestGroundMaterial(material: THREE.MeshStandardMaterial): Promise<void> {
    const pbr = await this.assets.createPBRMaterial({
      roughness: 1,
      metalness: 0,
      baseColorMap: 'assets/terrain/forest_ground_04_diff_1k.jpg',
      normalMap: 'assets/terrain/forest_ground_04_nor_gl_1k.jpg',
      roughnessMap: 'assets/terrain/forest_ground_04_rough_1k.jpg',
    });
    if (this.disposed) return;

    material.map = pbr.map ?? material.map;
    material.normalMap = pbr.normalMap;
    material.roughnessMap = pbr.roughnessMap;
    material.normalScale.set(0.65, 0.65);
    for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
      if (!texture) continue;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
    }
    material.needsUpdate = true;
  }

  private createGroundTexture(): THREE.DataTexture {
    const size = 256;
    const pixels = new Uint8Array(size * size * 4);
    const [baseRed, baseGreen, baseBlue] = this.location === 'floor2' || this.location === 'floor4'
      ? [106, 96, 91]
      : this.location === 'floor3'
        ? [122, 135, 145]
        : this.location === 'hub'
          ? [132, 123, 106]
          : [116, 119, 88];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        const broad = Math.sin(u * 2.1 + Math.sin(v * 1.3)) * 6
          + Math.cos(v * 2.4 + Math.sin(u * 1.7)) * 4;
        const fine = Math.sin(u * 5.3 + Math.cos(v * 3.1)) * 2
          + Math.cos(v * 6.4 - Math.sin(u * 4.2)) * 1.2;
        const fleck = Math.sin(u * 11.2 + Math.cos(v * 8.6)) * 0.8;
        const offset = (y * size + x) * 4;
        pixels[offset] = baseRed + broad + fine + fleck;
        pixels[offset + 1] = baseGreen + broad * 1.12 + fine * 0.92 + fleck;
        pixels[offset + 2] = baseBlue + broad * 0.64 + fine * 0.75 + fleck;
        pixels[offset + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(this.graphics.textureAnisotropy, 8);
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private createLavaFissureTexture(): THREE.DataTexture {
    const size = 256;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * Math.PI * 2;
        const v = (y / size) * Math.PI * 2;
        const crackA = Math.abs(Math.sin(u * 3.2 + Math.sin(v * 2.1) * 0.7 + Math.cos(v * 5.3) * 0.12));
        const crackB = Math.abs(Math.sin(v * 3.5 + Math.sin(u * 1.9) * 0.65 + Math.sin(u * 6.1) * 0.1));
        const crack = 1 - smoothstep(0.018, 0.072, Math.min(crackA, crackB));
        const broken = 0.24 + 0.76 * smoothstep(
          -0.5,
          0.42,
          Math.sin(u * 1.4 + v * 0.9) * Math.cos(v * 1.7 - u * 0.6),
        );
        const value = Math.round(crack * broken * 255);
        const offset = (y * size + x) * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private buildWorldBoundaries(): void {
    const wallHeight = 38;
    const wallThickness = 2;
    for (const [x, z, width, depth] of [
      [0, -HALF_WORLD, WORLD_SIZE, wallThickness],
      [0, HALF_WORLD, WORLD_SIZE, wallThickness],
      [-HALF_WORLD, 0, wallThickness, WORLD_SIZE],
      [HALF_WORLD, 0, wallThickness, WORLD_SIZE],
    ]) {
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, wallHeight / 2 - 3, z),
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, wallHeight / 2, depth / 2),
        body,
      );
      this.colliders.push(body);
    }
  }

  private buildPaths(): void {
    for (const { curve, width } of this.paths) {
      const steps = 130;
      const positions = new Float32Array((steps + 1) * 2 * 3);
      const uvs = new Float32Array((steps + 1) * 2 * 2);
      const indices = new Uint32Array(steps * 6);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).setY(0).normalize();
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
        const edgeNoise = 0.91 + Math.sin(t * 67) * 0.045 + Math.sin(t * 131) * 0.035;
        for (let edge = 0; edge < 2; edge++) {
          const direction = edge === 0 ? -1 : 1;
          const x = point.x + side.x * width * 0.5 * edgeNoise * direction;
          const z = point.z + side.z * width * 0.5 * edgeNoise * direction;
          const offset = (i * 2 + edge) * 3;
          positions[offset] = x;
          positions[offset + 1] = this.getSurfaceHeight(x, z) + 0.035;
          positions[offset + 2] = z;
          uvs[(i * 2 + edge) * 2] = edge;
          uvs[(i * 2 + edge) * 2 + 1] = t * 22;
        }
        if (i < steps) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          const offset = i * 6;
          indices.set([a, b, c, b, d, c], offset);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      this.geometries.add(geometry);
      const path = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xb7a078,
          map: this.terrainTexture,
          roughness: 1,
          side: THREE.DoubleSide,
        }),
      );
      this.materials.add(path.material);
      path.receiveShadow = true;
      this.scene.add(path);
    }
  }

  private buildRiver(): void {
    const bankCurve = this.curveFollowingGround(this.riverCurve, 0.015);
    const waterCurve = this.curveFollowingGround(this.riverCurve, 0.34);
    const time = { value: 0 };
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x82a9a4,
      roughness: 0.24,
      metalness: 0.08,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uRiverTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uRiverTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.y += sin(position.x * 0.82 + position.z * 0.57 + uRiverTime * 1.3) * 0.035
            + cos(position.z * 1.17 - uRiverTime * 0.9) * 0.018;`,
        );
    };
    waterMaterial.customProgramCacheKey = () => 'red-valley-river-ripple-v1';
    this.materials.add(waterMaterial);
    this.waterTimeUniforms.push(time);
    const water = new THREE.Mesh(
      new THREE.TubeGeometry(waterCurve, 160, 1.34, 10, false),
      waterMaterial,
    );
    water.castShadow = false;
    water.receiveShadow = true;
    water.renderOrder = 1;
    this.trackObject(water);
    this.scene.add(water);

    const bank = new THREE.Mesh(
      new THREE.TubeGeometry(bankCurve, 160, 2.15, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x857754, roughness: 1 }),
    );
    bank.scale.y = 0.11;
    bank.position.y -= 0.045;
    bank.receiveShadow = true;
    this.trackObject(bank);
    this.scene.add(bank);

    const foamMaterial = new THREE.MeshBasicMaterial({
      color: 0xb6d5ca,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.materials.add(foamMaterial);
    const riverPoints = this.riverCurve.getPoints(80);
    for (const side of [-1, 1]) {
      const foamPoints = riverPoints.map((point, index) => {
        const tangent = this.riverCurve.getTangentAt(index / (riverPoints.length - 1)).setY(0).normalize();
        const offset = 1.16 + Math.sin(index * 1.9) * 0.12;
        const x = point.x - tangent.z * offset * side;
        const z = point.z + tangent.x * offset * side;
        return new THREE.Vector3(x, this.getSurfaceHeight(x, z) + 0.31, z);
      });
      const foam = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(foamPoints), 180, 0.035, 5, false),
        foamMaterial,
      );
      foam.castShadow = false;
      foam.renderOrder = 2;
      this.trackObject(foam);
      this.scene.add(foam);
    }

    const shorelineMat = new THREE.MeshStandardMaterial({ color: 0x667454, roughness: 1 });
    this.materials.add(shorelineMat);
    for (let i = 0; i < 32; i++) {
      const point = this.riverCurve.getPointAt((i + 0.5) / 32);
      const side = i % 2 === 0 ? 1 : -1;
      const x = point.x + side * (2.4 + (i % 3) * 0.45);
      const z = point.z + Math.sin(i * 4.1) * 1.1;
      const reed = new THREE.Mesh(
        new THREE.ConeGeometry(0.055, 0.8 + (i % 4) * 0.12, 4),
        shorelineMat,
      );
      reed.position.set(x, this.getSurfaceHeight(x, z) + 0.42, z);
      reed.rotation.z = Math.sin(i) * 0.14;
      reed.castShadow = false;
      this.trackObject(reed);
      this.scene.add(reed);
    }
  }

  private curveFollowingGround(curve: THREE.CatmullRomCurve3, heightOffset: number): THREE.CatmullRomCurve3 {
    const points = curve.getPoints(32).map((point) =>
      new THREE.Vector3(point.x, this.getSurfaceHeight(point.x, point.z) + heightOffset, point.z));
    return new THREE.CatmullRomCurve3(points);
  }

  private buildMountains(): void {
    const random = randomGenerator(45321);
    const variants = Array.from({ length: 4 }, (_, index) => this.createMountainGeometry(index));
    const nearPeaks: Array<Array<{ matrix: THREE.Matrix4; color: THREE.Color }>> = variants.map(() => []);
    const distantPeaks: Array<Array<{ matrix: THREE.Matrix4; color: THREE.Color }>> = variants.map(() => []);
    const addPeak = (
      index: number,
      count: number,
      radiusMin: number,
      radiusRange: number,
      heightMin: number,
      heightRange: number,
      widthMin: number,
      widthRange: number,
      instances: Array<Array<{ matrix: THREE.Matrix4; color: THREE.Color }>>,
    ): void => {
      const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.14;
      const radius = radiusMin + random() * radiusRange;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = heightMin + random() * heightRange;
      const position = new THREE.Vector3(x, this.getSurfaceHeight(x, z) + height * 0.28, z);
      const scale = new THREE.Vector3(
        widthMin + random() * widthRange,
        height,
        widthMin + random() * widthRange,
      );
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        random() * Math.PI,
      );
      const matrix = new THREE.Matrix4().compose(position, rotation, scale);
      const color = new THREE.Color().setHSL(0.56 + random() * 0.035, 0.09, 0.9 + random() * 0.06);
      instances[index % variants.length].push({ matrix, color });
    };

    for (let i = 0; i < 18; i++) {
      addPeak(i, 18, 48, 8, 18, 13, 10, 9, nearPeaks);
    }
    for (let i = 0; i < 30; i++) {
      addPeak(i, 30, 82, 27, 30, 34, 20, 25, distantPeaks);
    }

    const mountainMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7ebeb,
      vertexColors: true,
      flatShading: true,
      roughness: 1,
    });
    this.materials.add(mountainMaterial);
    variants.forEach((geometry, variant) => {
      this.geometries.add(geometry);
      this.addMountainInstances(geometry, mountainMaterial, nearPeaks[variant], true);
      this.addMountainInstances(geometry, mountainMaterial, distantPeaks[variant], false);
    });

    const skyGeometry = new THREE.SphereGeometry(280, 24, 16);
    const [horizonHex, zenithHex] = this.location === 'floor2' || this.location === 'floor4'
      ? [0x896657, 0x392c2d]
      : this.location === 'floor3'
        ? [0x8faabb, 0x2d3d4b]
        : [0x87939a, 0x53626c];
    const horizon = new THREE.Color(horizonHex);
    const zenith = new THREE.Color(zenithHex);
    const skyColor = new THREE.Color();
    const skyColors: number[] = [];
    const skyPosition = skyGeometry.getAttribute('position');
    for (let i = 0; i < skyPosition.count; i++) {
      const height = smoothstep(-0.04, 0.72, skyPosition.getY(i) / 280);
      skyColor.copy(horizon).lerp(zenith, height * 0.78);
      skyColors.push(skyColor.r, skyColor.g, skyColor.b);
    }
    skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    this.geometries.add(skyGeometry);
    const skyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.add(skyMaterial);
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.cloudTexture = this.createCloudTexture();
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: this.location === 'floor2' || this.location === 'floor4' ? 0x806057 : this.location === 'floor3' ? 0x8193a0 : 0xadb8be,
      map: this.cloudTexture,
      transparent: true,
      opacity: this.location === 'floor2' || this.location === 'floor4' ? 0.34 : 0.48,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    this.materials.add(cloudMaterial);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(279, 24, 16), cloudMaterial);
    clouds.frustumCulled = false;
    this.trackObject(clouds);
    this.scene.add(clouds);

    const mistMaterial = new THREE.MeshBasicMaterial({
      color: 0xa9b8bf,
      map: this.cloudTexture,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.materials.add(mistMaterial);
    const mistGeometry = new THREE.PlaneGeometry(150, 25);
    this.geometries.add(mistGeometry);
    for (const [x, y, z, rotation, scale] of [
      [0, 7, -8, 0.08, 1],
      [-9, 6, -29, -0.13, 0.82],
    ]) {
      const mist = new THREE.Mesh(mistGeometry, mistMaterial);
      mist.position.set(x, y, z);
      mist.rotation.y = rotation;
      mist.scale.setScalar(scale);
      mist.frustumCulled = false;
      this.scene.add(mist);
    }
  }

  private createMountainGeometry(seed: number): THREE.BufferGeometry {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const rock = new THREE.Color(
      this.location === 'floor2' || this.location === 'floor4' ? 0x3c3030 : this.location === 'floor3' ? 0x4e5e6a : 0x58636b,
    );
    const highland = new THREE.Color(
      this.location === 'floor2' || this.location === 'floor4' ? 0x786357 : this.location === 'floor3' ? 0xb9c9d1 : 0xc8d1d2,
    );
    const surface = new THREE.Color();

    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      const z = positions.getZ(vertex);
      const noise = Math.sin(x * 7.1 + z * 11.7 + seed * 1.7) * 0.065
        + Math.cos(y * 12.3 - x * 8.2 + seed) * 0.035;
      positions.setXYZ(vertex, x * (1 + noise), y * (1 + noise), z * (1 + noise));
      const highlandLine = smoothstep(0.16 + seed * 0.015, 0.78 + seed * 0.012, y + noise);
      surface.copy(rock).lerp(highland, highlandLine * 0.92);
      colors[vertex * 3] = surface.r;
      colors[vertex * 3 + 1] = surface.g;
      colors[vertex * 3 + 2] = surface.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private addMountainInstances(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    instances: Array<{ matrix: THREE.Matrix4; color: THREE.Color }>,
    castShadow: boolean,
  ): void {
    if (instances.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    instances.forEach(({ matrix, color }, index) => {
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    this.scene.add(mesh);
  }

  private createCloudTexture(): THREE.DataTexture {
    const width = 128;
    const height = 64;
    const pixels = new Uint8Array(width * height * 4);
    const random = randomGenerator(81357);
    const octaves = [
      { columns: 4, rows: 2, weight: 0.46, values: new Float32Array(4 * 2) },
      { columns: 8, rows: 4, weight: 0.27, values: new Float32Array(8 * 4) },
      { columns: 16, rows: 8, weight: 0.17, values: new Float32Array(16 * 8) },
      { columns: 32, rows: 16, weight: 0.1, values: new Float32Array(32 * 16) },
    ];
    for (const octave of octaves) {
      for (let index = 0; index < octave.values.length; index++) octave.values[index] = random();
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        for (const octave of octaves) {
          const sampleX = (x / width) * octave.columns;
          const sampleY = (y / height) * octave.rows;
          const x0 = Math.floor(sampleX);
          const y0 = Math.floor(sampleY);
          const x1 = (x0 + 1) % octave.columns;
          const y1 = (y0 + 1) % octave.rows;
          const tx = THREE.MathUtils.smoothstep(sampleX - x0, 0, 1);
          const ty = THREE.MathUtils.smoothstep(sampleY - y0, 0, 1);
          const top = THREE.MathUtils.lerp(
            octave.values[y0 * octave.columns + x0],
            octave.values[y0 * octave.columns + x1],
            tx,
          );
          const bottom = THREE.MathUtils.lerp(
            octave.values[y1 * octave.columns + x0],
            octave.values[y1 * octave.columns + x1],
            tx,
          );
          value += THREE.MathUtils.lerp(top, bottom, ty) * octave.weight;
        }
        const alpha = smoothstep(0.46, 0.68, value) * 220;
        const offset = (y * width + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = alpha;
      }
    }

    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private buildForest(): void {
    const random = randomGenerator(93751);
    const trunkGeometry = createTrunkGeometry();
    const rootCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.12, 0.055, 0),
      new THREE.Vector3(0.38, 0.025, 0.05),
      new THREE.Vector3(0.8, -0.055, 0.17),
    ]);
    const rootGeometry = new THREE.TubeGeometry(rootCurve, 8, 0.075, 6, false);
    const pineGeometry = createCanopyGeometry('pine', 1);
    const leafGeometry = createCanopyGeometry('broadleaf', 3);
    const pineLodGeometry = createCanopyGeometry('pine', 0);
    const leafLodGeometry = createCanopyGeometry('broadleaf', 1);
    const snowCapGeometry = new THREE.ConeGeometry(0.7, 0.34, 10, 2);
    const bushGeometry = new THREE.IcosahedronGeometry(1, 1);
    const fernGeometry = new THREE.ConeGeometry(0.12, 0.78, 4);
    const grassGeometry = new THREE.ConeGeometry(0.075, 0.52, 4);
    const rockGeometry = new THREE.DodecahedronGeometry(1, 1);
    const flowerGeometry = new THREE.IcosahedronGeometry(0.075, 1);
    for (const geometry of [
      trunkGeometry, rootGeometry, pineGeometry, leafGeometry, pineLodGeometry, leafLodGeometry,
      snowCapGeometry, bushGeometry, fernGeometry, grassGeometry, rockGeometry, flowerGeometry,
    ]) this.geometries.add(geometry);

    const bark = this.assets.materials.bark;
    const pineDark = this.createWindMaterial(this.assets.materials.leaves);
    const pineLight = this.createWindMaterial(this.assets.materials.leavesLight);
    const fernMaterial = this.createWindMaterial(this.assets.materials.leavesLight);
    const grassMaterial = this.createWindMaterial(this.assets.materials.grass);
    const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xc8d4d7, roughness: 0.94 });
    this.materials.add(snowMaterial);
    const frostColor = new THREE.Color(0xb9c6c7);
    const batches = new Map<string, Map<string, InstanceSpec[]>>();
    const add = (kind: string, x: number, z: number, spec: InstanceSpec): void => {
      const key = chunkKey(x, z);
      let chunk = batches.get(kind);
      if (!chunk) {
        chunk = new Map();
        batches.set(kind, chunk);
      }
      const instances = chunk.get(key);
      if (instances) instances.push(spec);
      else chunk.set(key, [spec]);
    };

    for (let i = 0; i < 210; i++) {
      const clusterAngle = random() * Math.PI * 2;
      const clusterRadius = 27 + random() * 23;
      const x = Math.cos(clusterAngle) * clusterRadius + (random() - 0.5) * 14;
      const z = Math.sin(clusterAngle) * clusterRadius + (random() - 0.5) * 14;
      if (!this.isVegetationLocation(x, z, 2.6)) continue;
      const ground = this.getSurfaceHeight(x, z);
      const size = 0.82 + random() * 0.54;
      const yaw = random() * Math.PI * 2;
      const rotation = new THREE.Euler((random() - 0.5) * 0.06, yaw, (random() - 0.5) * 0.06);
      const distanceFromValley = Math.hypot(x, z);
      const isDistant = distanceFromValley > 42;
      const isDeciduous = distanceFromValley < 40 && random() < 0.27;
      add('trunk', x, z, {
        position: new THREE.Vector3(x, ground + (isDeciduous ? 1.65 : 1.85) * size, z),
        rotation,
        scale: new THREE.Vector3(0.16 * size, (isDeciduous ? 3.3 : 3.7) * size, 0.16 * size),
      });
      for (let root = 0; root < 3; root++) {
        add('root', x, z, {
          position: new THREE.Vector3(x, ground + 0.07, z),
          rotation: new THREE.Euler(0, yaw + root * (Math.PI * 2 / 3), 0),
          scale: new THREE.Vector3(size, size, size),
        });
      }
      if (i % 3 === 0) this.addTrunkCollider(x, ground, z, size);
      if (isDeciduous) {
        const crowns = isDistant
          ? [[0, 2.85, 0, 1.85]]
          : [
              [-0.62, 2.65, 0, 1.28],
              [0.55, 2.75, 0.28, 1.12],
              [0, 3.22, -0.35, 1.1],
              [0.05, 2.45, 0.55, 0.9],
            ];
        for (const [offsetX, offsetY, offsetZ, crownSize] of crowns) {
          const crownMaterial = random() < 0.38 ? 'leafLight' : 'leafDark';
          const leafColor = new THREE.Color().setHSL(0.27 + random() * 0.04, 0.28, 0.38 + random() * 0.08);
          leafColor.lerp(frostColor, 0.18 + smoothstep(5, 12, ground) * (0.32 + random() * 0.38));
          add(isDistant ? 'leafLod' : crownMaterial, x, z, {
            position: new THREE.Vector3(x + offsetX * size, ground + offsetY * size, z + offsetZ * size),
            rotation: new THREE.Euler(0, yaw, 0),
            scale: new THREE.Vector3(crownSize * size, crownSize * size * 0.9, crownSize * size),
            color: leafColor,
          });
        }
      } else {
        const keys = isDistant ? ['pineLod'] : ['pineDark', 'pineLight', 'pineDark'];
        const tiers = isDistant
          ? [[2.55, 1.28, 4.2]]
          : [
              [1.65, 1.35, 2.15],
              [2.65, 1.08, 1.9],
              [3.55, 0.78, 1.62],
            ];
        tiers.forEach(([height, radius, tierHeight], tier) => {
          add(keys[tier], x, z, {
            position: new THREE.Vector3(x, ground + height * size, z),
            rotation: new THREE.Euler(0, yaw, 0),
            scale: new THREE.Vector3(radius * size, tierHeight * size, radius * size),
            color: new THREE.Color().setHSL(0.31 + random() * 0.035, 0.3, 0.3 + random() * 0.1),
          });
          const capHeight = tierHeight * 0.5;
          add('snowCap', x, z, {
            position: new THREE.Vector3(
              x,
              ground + (height + capHeight - 0.1) * size,
              z,
            ),
            rotation: new THREE.Euler(0, yaw, 0),
            scale: new THREE.Vector3(radius * 0.52 * size, size, radius * 0.52 * size),
          });
        });
      }
    }

    this.addChunkedInstances(batches.get('trunk'), trunkGeometry, bark, true, true);
    this.addChunkedInstances(batches.get('root'), rootGeometry, bark, true, true);
    this.addChunkedInstances(batches.get('pineDark'), pineGeometry, pineDark, true, true);
    this.addChunkedInstances(batches.get('pineLight'), pineGeometry, pineLight, true, true);
    this.addChunkedInstances(batches.get('leafDark'), leafGeometry, pineDark, true, true);
    this.addChunkedInstances(batches.get('leafLight'), leafGeometry, pineLight, true, true);
    this.addChunkedInstances(batches.get('pineLod'), pineLodGeometry, pineDark, true, true);
    this.addChunkedInstances(batches.get('leafLod'), leafLodGeometry, pineLight, true, true);
    this.addChunkedInstances(batches.get('snowCap'), snowCapGeometry, snowMaterial, false, true);

    const shrubBatches = new Map<string, InstanceSpec[]>();
    for (let i = 0; i < 250; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 16 + random() * 35;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!this.isVegetationLocation(x, z, 1.9)) continue;
      const ground = this.getSurfaceHeight(x, z);
      for (let lobe = 0; lobe < 3; lobe++) {
        const px = x + (random() - 0.5) * 0.8;
        const pz = z + (random() - 0.5) * 0.8;
        const specs = shrubBatches.get(chunkKey(x, z)) ?? [];
        specs.push({
          position: new THREE.Vector3(px, ground + 0.22 + random() * 0.12, pz),
          rotation: new THREE.Euler(random() * 0.2, random() * Math.PI, 0),
          scale: new THREE.Vector3(0.45 + random() * 0.34, 0.38 + random() * 0.28, 0.42 + random() * 0.36),
          color: new THREE.Color().setHSL(0.28 + random() * 0.06, 0.32, 0.31 + random() * 0.12),
        });
        shrubBatches.set(chunkKey(x, z), specs);
      }
    }
    this.addChunkedInstancesByKey(shrubBatches, bushGeometry, pineDark, false, true);

    const fernBatches = new Map<string, InstanceSpec[]>();
    const grassBatches = new Map<string, InstanceSpec[]>();
    const flowerBatches = new Map<string, InstanceSpec[]>();
    for (let i = 0; i < 330; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 12 + random() * 39;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!this.isVegetationLocation(x, z, 0.8)) continue;
      const ground = this.getSurfaceHeight(x, z);
      const key = chunkKey(x, z);
      if (i % 3 === 0) {
        const specs = fernBatches.get(key) ?? [];
        for (let blade = 0; blade < 6; blade++) {
          const yaw = random() * Math.PI * 2;
          specs.push({
            position: new THREE.Vector3(x + Math.cos(yaw) * 0.12, ground + 0.36, z + Math.sin(yaw) * 0.12),
            rotation: new THREE.Euler((random() - 0.5) * 0.5, yaw, (random() - 0.5) * 0.5),
            scale: new THREE.Vector3(0.7 + random() * 0.6, 0.7 + random() * 0.6, 0.7 + random() * 0.6),
            color: new THREE.Color().setHSL(0.29 + random() * 0.06, 0.38, 0.36 + random() * 0.12),
          });
        }
        fernBatches.set(key, specs);
      } else {
        const specs = grassBatches.get(key) ?? [];
        for (let blade = 0; blade < 7; blade++) {
          const yaw = random() * Math.PI * 2;
          specs.push({
            position: new THREE.Vector3(x + Math.cos(yaw) * random() * 0.35, ground + 0.22, z + Math.sin(yaw) * random() * 0.35),
            rotation: new THREE.Euler((random() - 0.5) * 0.45, yaw, (random() - 0.5) * 0.45),
            scale: new THREE.Vector3(0.65 + random() * 0.8, 0.55 + random() * 1.1, 0.65 + random() * 0.8),
            color: new THREE.Color().setHSL(0.25 + random() * 0.11, 0.35, 0.35 + random() * 0.16),
          });
        }
        grassBatches.set(key, specs);
      }
      if (i % 11 === 0) {
        const flowers = flowerBatches.get(key) ?? [];
        for (let bloom = 0; bloom < 3; bloom++) {
          const hue = [0.12, 0.83, 0.98][bloom];
          flowers.push({
            position: new THREE.Vector3(x + (random() - 0.5) * 0.45, ground + 0.22, z + (random() - 0.5) * 0.45),
            rotation: new THREE.Euler(0, random() * Math.PI, 0),
            scale: new THREE.Vector3(1, 1, 1),
            color: new THREE.Color().setHSL(hue, 0.55, 0.72),
          });
        }
        flowerBatches.set(key, flowers);
      }
    }
    this.addChunkedInstancesByKey(fernBatches, fernGeometry, fernMaterial, false, false);
    this.addChunkedInstancesByKey(grassBatches, grassGeometry, grassMaterial, false, false);
    const flowerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.materials.add(flowerMaterial);
    this.addChunkedInstancesByKey(flowerBatches, flowerGeometry, flowerMaterial, false, false);

    const rockBatches = new Map<string, InstanceSpec[]>();
    for (let i = 0; i < 145; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 17 + random() * 37;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!this.isVegetationLocation(x, z, 1.2)) continue;
      const size = 0.24 + random() * 0.95;
      const specs = rockBatches.get(chunkKey(x, z)) ?? [];
      specs.push({
        position: new THREE.Vector3(x, this.getSurfaceHeight(x, z) + size * 0.28, z),
        rotation: new THREE.Euler(random() * 0.4, random() * Math.PI, random() * 0.35),
        scale: new THREE.Vector3(size * 1.2, size * 0.72, size),
        color: new THREE.Color().setHSL(0.13 + random() * 0.06, 0.08, 0.53 + random() * 0.16),
      });
      rockBatches.set(chunkKey(x, z), specs);
    }
    this.addChunkedInstancesByKey(rockBatches, rockGeometry, this.assets.materials.stone, true, true);
    this.addFallenLogs(random);
  }

  private addFallenLogs(random: () => number): void {
    const logGeometry = new THREE.CylinderGeometry(0.16, 0.22, 3.1, 9);
    const logMaterial = this.assets.materials.bark.clone();
    logMaterial.color.setHex(0x594734);
    this.geometries.add(logGeometry);
    this.materials.add(logMaterial);
    for (let i = 0; i < 13; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 20 + random() * 25;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!this.isVegetationLocation(x, z, 2)) continue;
      const log = new THREE.Mesh(logGeometry, logMaterial);
      log.position.set(x, this.getSurfaceHeight(x, z) + 0.19, z);
      log.rotation.set(Math.PI / 2 + (random() - 0.5) * 0.12, random() * Math.PI, 0);
      log.castShadow = true;
      log.receiveShadow = true;
      this.scene.add(log);
    }
  }

  private async buildNatureKit(): Promise<void> {
    const definitions = [
      { name: 'Pine_1', count: this.location === 'floor1' ? 18 : 8, height: 6.2, tint: 0.72, shadows: true },
      { name: 'Bush_Common', count: this.location === 'floor1' ? 14 : 6, height: 1.15, tint: 0.64, shadows: false },
      { name: 'Fern_1', count: this.location === 'floor1' ? 11 : 4, height: 0.9, tint: 0.68, shadows: false },
      { name: 'Grass_Common_Tall', count: this.location === 'floor1' ? 34 : 14, height: 0.72, tint: 0.62, shadows: false },
      { name: 'Rock_Medium_1', count: this.location === 'floor1' ? 12 : 7, height: 1.25, tint: 0.7, shadows: true },
      { name: 'Pebble_Round_1', count: this.location === 'floor1' ? 22 : 10, height: 0.4, tint: 0.76, shadows: false },
    ] as const;
    const random = randomGenerator(this.location === 'floor1' ? 48291 : this.location === 'floor2' ? 48292 : this.location === 'floor3' ? 48293 : 48294);
    for (const definition of definitions) {
      if (this.disposed) return;
      const path = `assets/environment/nature-megakit/glTF/${definition.name}.gltf`;
      try {
        const response = await fetch(this.assets.resolveAssetUrl(path), { method: 'HEAD' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const loaded = await this.assets.loadModel(path, () => new THREE.Group());
        if (this.disposed) {
          this.assets.releaseModel(loaded.scene);
          return;
        }
        let renderable = false;
        loaded.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) renderable = true;
        });
        if (!renderable) {
          this.assets.releaseModel(loaded.scene);
          throw new Error('The glTF contains no renderable meshes.');
        }
        this.natureModels.push(loaded.scene);
        this.addNatureInstances(loaded.scene, definition, random);
      } catch (error) {
        console.error(`Could not load Nature MegaKit model "${path}".`, error);
      }
    }
  }

  private addNatureInstances(
    source: THREE.Object3D,
    definition: {
      name: string;
      count: number;
      height: number;
      tint: number;
      shadows: boolean;
    },
    random: () => number,
  ): void {
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const sourceHeight = bounds.getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
      throw new Error(`Nature model "${definition.name}" has invalid vertical bounds.`);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const inverseRoot = source.matrixWorld.clone().invert();
    const instances: InstanceSpec[] = [];
    if (definition.name === 'Rock_Medium_1' && this.location === 'floor1') {
      for (let index = 0; index < 8; index++) {
        const progress = 0.12 + index * 0.105;
        const riverPoint = this.riverCurve.getPointAt(progress);
        const tangent = this.riverCurve.getTangentAt(progress).setY(0).normalize();
        const side = index % 2 === 0 ? 1 : -1;
        const offset = 2.85 + random() * 0.52;
        const x = riverPoint.x - tangent.z * offset * side;
        const z = riverPoint.z + tangent.x * offset * side;
        instances.push({
          position: new THREE.Vector3(x, this.getSurfaceHeight(x, z), z),
          rotation: new THREE.Euler((random() - 0.5) * 0.18, random() * Math.PI * 2, (random() - 0.5) * 0.18),
          scale: new THREE.Vector3().setScalar((definition.height / sourceHeight) * (0.72 + random() * 0.62)),
        });
      }
    }
    const attempts = definition.count * 18;
    for (let attempt = 0; instances.length < definition.count && attempt < attempts; attempt++) {
      const angle = random() * Math.PI * 2;
      const radius = 18 + random() * 29;
      const x = Math.cos(angle) * radius + (random() - 0.5) * 7;
      const z = Math.sin(angle) * radius + (random() - 0.5) * 7;
      if (this.location === 'floor1' && !this.isVegetationLocation(x, z, definition.height * 0.3)) continue;
      if (this.location !== 'floor1' && Math.hypot(x, z + 27) < 14) continue;
      if (definition.name === 'Rock_Medium_1' && this.location === 'floor1' && this.distanceToCurve(x, z, this.riverCurve, 36) < 4.1) continue;
      const ground = this.getSurfaceHeight(x, z);
      const scaleFactor = 0.74 + random() * 0.62;
      instances.push({
        position: new THREE.Vector3(x, ground, z),
        rotation: new THREE.Euler(
          definition.name === 'Pine_1' ? 0 : (random() - 0.5) * 0.18,
          random() * Math.PI * 2,
          definition.name === 'Pine_1' ? 0 : (random() - 0.5) * 0.18,
        ),
        scale: new THREE.Vector3().setScalar((definition.height / sourceHeight) * scaleFactor),
      });
    }
    if (instances.length === 0) return;

    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
      const geometry = object.geometry.clone();
      const relativeTransform = inverseRoot.clone().multiply(object.matrixWorld);
      geometry.applyMatrix4(relativeTransform);
      geometry.translate(-center.x, -bounds.min.y, -center.z);
      this.geometries.add(geometry);
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materials = sourceMaterials.map((material) => {
        const adjusted = material.clone();
        if (adjusted instanceof THREE.MeshStandardMaterial) {
          adjusted.color.multiplyScalar(definition.tint);
          adjusted.roughness = Math.max(adjusted.roughness, 0.82);
          adjusted.metalness = 0;
          if (definition.name === 'Grass_Common_Tall') adjusted.side = THREE.DoubleSide;
        }
        this.materials.add(adjusted);
        return adjusted;
      });
      const mesh = new THREE.InstancedMesh(
        geometry,
        Array.isArray(object.material) ? materials : materials[0],
        instances.length,
      );
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      instances.forEach((instance, index) => {
        quaternion.setFromEuler(instance.rotation);
        matrix.compose(instance.position, quaternion, instance.scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = definition.shadows;
      mesh.receiveShadow = definition.shadows;
      this.scene.add(mesh);
    });
  }

  private isVegetationLocation(x: number, z: number, margin: number): boolean {
    if (Math.hypot(x, z - 13) < 7 + margin) return false;
    if (Math.hypot(x + 15, z + 13) < 8 + margin) return false;
    if (Math.hypot(x - 19, z + 4) < 8 + margin) return false;
    if (Math.hypot(x + 29, z - 17) < 7 + margin) return false;
    if (this.distanceToCurve(x, z, this.riverCurve, 36) < 4.3 + margin) return false;
    return this.paths.every(({ curve, width }) =>
      this.distanceToCurve(x, z, curve, 36) > width * 0.5 + margin);
  }

  private createWindMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const material = source.clone();
    const timeUniform = { value: 0 };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWorldWindTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWorldWindTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float windPhase = uWorldWindTime + instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.11;
            transformed.x += sin(windPhase + transformed.y * 1.8) * max(transformed.y + 0.5, 0.0) * 0.055;
          #endif`,
        );
    };
    material.customProgramCacheKey = () => 'red-valley-instanced-wind-v1';
    this.materials.add(material);
    this.windUniforms.push(timeUniform);
    return material;
  }

  private addChunkedInstances(
    chunks: Map<string, InstanceSpec[]> | undefined,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    castShadow: boolean,
    receiveShadow: boolean,
  ): void {
    if (!chunks) return;
    this.addChunkedInstancesByKey(chunks, geometry, material, castShadow, receiveShadow);
  }

  private addChunkedInstancesByKey(
    chunks: Map<string, InstanceSpec[]>,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    castShadow: boolean,
    receiveShadow: boolean,
  ): void {
    for (const instances of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      instances.forEach((instance, index) => {
        rotation.setFromEuler(instance.rotation);
        matrix.compose(instance.position, rotation, instance.scale);
        mesh.setMatrixAt(index, matrix);
        if (instance.color) mesh.setColorAt(index, instance.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      this.scene.add(mesh);
    }
  }

  private buildRuin(): void {
    const center = new THREE.Vector3(-15, this.getSurfaceHeight(-15, -13), -13);
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.38, 8),
      this.assets.materials.ruin,
    );
    platform.position.set(center.x, center.y + 0.16, center.z);
    platform.receiveShadow = true;
    this.trackObject(platform);
    this.scene.add(platform);
    this.addCollider(center.x, center.y + 0.16, center.z, 10, 0.38, 8);

    const pillars = [
      [-4, -2.7, 3.3], [4, -2.7, 3.3], [-4, 2.7, 3.3], [4, 2.7, 1.7],
    ];
    for (const [dx, dz, height] of pillars) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.58, height, 8, 2),
        this.assets.materials.ruin,
      );
      pillar.position.set(center.x + dx, center.y + 0.36 + height / 2, center.z + dz);
      pillar.rotation.z = dx === 4 && dz === 2.7 ? 0.08 : 0;
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.trackObject(pillar);
      this.scene.add(pillar);
      this.addCollider(pillar.position.x, pillar.position.y, pillar.position.z, 1, height, 1);
    }

    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.65, 0.85),
      this.assets.materials.ruin,
    );
    lintel.position.set(center.x, center.y + 3.72, center.z - 2.7);
    lintel.rotation.z = -0.035;
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    this.trackObject(lintel);
    this.scene.add(lintel);

    const brokenArch = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.2, 7, 12, Math.PI * 0.85),
      this.assets.materials.ruin,
    );
    brokenArch.position.set(center.x, center.y + 1.15, center.z - 0.7);
    brokenArch.rotation.z = Math.PI;
    brokenArch.castShadow = true;
    this.trackObject(brokenArch);
    this.scene.add(brokenArch);

    const rune = new THREE.PointLight(0x81b6a2, 2.2, 7);
    rune.position.set(center.x, center.y + 1.7, center.z);
    this.scene.add(rune);

    const runeGeometry = new THREE.BufferGeometry();
    runeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.34, -0.19, 0, -0.34, 0.19, 0,
      -0.34, 0.19, 0, 0, 0, 0,
      0, 0, 0, 0.34, 0.19, 0,
      0.34, 0.19, 0, 0.34, -0.19, 0,
      0, 0, 0, 0, -0.27, 0,
      -0.34, -0.19, 0, 0, -0.27, 0,
      0, -0.27, 0, 0.34, -0.19, 0,
    ], 3));
    const runeMaterial = new THREE.LineBasicMaterial({ color: 0x464b49, transparent: true, opacity: 0.9 });
    const runeMark = new THREE.LineSegments(runeGeometry, runeMaterial);
    runeMark.position.set(center.x, center.y + 3.72, center.z - 2.28);
    this.geometries.add(runeGeometry);
    this.materials.add(runeMaterial);
    this.scene.add(runeMark);

    const torch = new THREE.Group();
    torch.position.set(center.x + 3.1, center.y + 1.1, center.z - 2.18);
    const handleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 0.68, 6);
    const handle = new THREE.Mesh(handleGeometry, this.assets.materials.bark);
    handle.position.y = 0.22;
    torch.add(handle);
    const flameMaterial = new THREE.MeshStandardMaterial({
      color: 0xb65a30,
      emissive: 0x8b2f12,
      emissiveIntensity: 1.8,
      roughness: 0.7,
    });
    this.materials.add(flameMaterial);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.48, 6), flameMaterial);
    flame.position.y = 0.69;
    torch.add(flame);
    const flameCore = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.3, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd49a }),
    );
    flameCore.position.y = 0.63;
    torch.add(flameCore);
    this.trackObject(torch);
    this.scene.add(torch);
    this.warmLight = new THREE.PointLight(0xffa15c, 0.78, 9, 2);
    this.warmLight.position.set(torch.position.x, torch.position.y + 0.72, torch.position.z);
    this.scene.add(this.warmLight);

    const rubbleGeometry = new THREE.DodecahedronGeometry(1, 0);
    this.geometries.add(rubbleGeometry);
    for (let i = 0; i < 17; i++) {
      const angle = (i / 17) * Math.PI * 2;
      const radius = 5.3 + (i % 3) * 0.45;
      const rubble = new THREE.Mesh(rubbleGeometry, this.assets.materials.ruin);
      rubble.position.set(
        center.x + Math.cos(angle) * radius,
        center.y + 0.25,
        center.z + Math.sin(angle) * radius,
      );
      rubble.rotation.set(angle * 0.4, angle, angle * 0.2);
      rubble.scale.set(0.45 + (i % 4) * 0.12, 0.25 + (i % 3) * 0.09, 0.5 + (i % 5) * 0.1);
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      this.scene.add(rubble);
    }
  }

  private buildCave(): void {
    const x = 19;
    const z = -4;
    const ground = this.getSurfaceHeight(x, z);
    const entrance = new THREE.Group();
    entrance.position.set(x, ground, z);

    const boulderGeometry = new THREE.DodecahedronGeometry(1.8, 1);
    this.geometries.add(boulderGeometry);
    for (const [dx, dy, dz, sx, sy, sz] of [
      [-3.6, 1.5, 0, 1.9, 1.5, 1.4],
      [3.8, 1.8, -0.15, 2.1, 1.8, 1.6],
      [-2.2, 3.25, 0, 2.2, 1.3, 1.45],
      [2, 3.55, -0.1, 2.4, 1.55, 1.6],
    ]) {
      const rock = new THREE.Mesh(boulderGeometry, this.assets.materials.stone);
      rock.position.set(dx, dy, dz);
      rock.scale.set(sx, sy, sz);
      rock.rotation.y = dx * 0.22;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.trackObject(rock);
      entrance.add(rock);
    }
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(2.05, 24),
      new THREE.MeshBasicMaterial({ color: 0x111714, side: THREE.DoubleSide }),
    );
    mouth.position.set(0, 1.38, 1.55);
    entrance.add(mouth);
    const glow = new THREE.PointLight(0x78a994, 0.75, 6);
    glow.position.set(0, 1, 1.1);
    entrance.add(glow);

    const roots = new THREE.Mesh(
      new THREE.TorusGeometry(2.05, 0.11, 5, 18, Math.PI * 1.2),
      this.assets.materials.bark,
    );
    roots.position.set(0, 1.35, 1.62);
    roots.rotation.z = Math.PI * 0.84;
    roots.castShadow = true;
    entrance.add(roots);
    this.trackObject(entrance);
    this.scene.add(entrance);
  }

  private buildAbandonedCamp(): void {
    const x = -29;
    const z = 17;
    const ground = this.getSurfaceHeight(x, z);
    const camp = new THREE.Group();
    camp.position.set(x, ground, z);

    const canvas = new THREE.MeshStandardMaterial({
      color: 0x817250,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    this.materials.add(canvas);
    const tornTent = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.8, 4, 1, true), canvas);
    tornTent.position.set(-1.5, 0.88, 0.1);
    tornTent.rotation.y = Math.PI * 0.25;
    tornTent.scale.set(1, 1, 0.85);
    tornTent.castShadow = true;
    camp.add(tornTent);

    const wood = this.assets.materials.bark;
    const poleGeometry = new THREE.CylinderGeometry(0.045, 0.07, 2.15, 6);
    this.geometries.add(poleGeometry);
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeometry, wood);
      pole.position.set(-1.5 + side * 1.2, 0.72, 0.1);
      pole.rotation.z = side * 0.58;
      pole.castShadow = true;
      camp.add(pole);
    }

    const bedroll = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.18, 0.8),
      this.assets.materials.cloth,
    );
    bedroll.position.set(-1.25, 0.15, 1.4);
    bedroll.rotation.y = -0.18;
    camp.add(bedroll);

    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.65, 0.82),
      this.assets.materials.bark,
    );
    crate.position.set(1.65, 0.34, -0.8);
    crate.rotation.y = 0.24;
    crate.castShadow = true;
    crate.receiveShadow = true;
    camp.add(crate);
    const crateLid = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.12, 0.86),
      this.assets.materials.bark,
    );
    crateLid.position.set(1.65, 0.7, -0.8);
    crateLid.rotation.z = 0.16;
    camp.add(crateLid);

    const firepit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1, 0.12, 12),
      this.assets.materials.stone,
    );
    firepit.position.set(1, 0.06, 1.55);
    firepit.castShadow = true;
    camp.add(firepit);
    const ashes = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 12),
      new THREE.MeshStandardMaterial({ color: 0x272723, roughness: 1 }),
    );
    ashes.rotation.x = -Math.PI / 2;
    ashes.position.set(1, 0.13, 1.55);
    camp.add(ashes);

    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.075, 6, 12),
      wood,
    );
    wheel.position.set(2.65, 0.68, 0.5);
    wheel.rotation.y = 0.78;
    wheel.rotation.x = 0.18;
    camp.add(wheel);
    for (let spoke = 0; spoke < 6; spoke++) {
      const angle = (spoke / 6) * Math.PI * 2;
      const spokeMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 1.16, 5),
        wood,
      );
      spokeMesh.position.set(
        2.65 + Math.sin(angle) * 0.08,
        0.68 + Math.sin(angle) * 0.48,
        0.5 + Math.cos(angle) * 0.48,
      );
      spokeMesh.rotation.z = Math.PI / 2 - angle;
      camp.add(spokeMesh);
    }

    const scatteredWood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 1.45, 7),
      wood,
    );
    scatteredWood.position.set(0.35, 0.12, -1.75);
    scatteredWood.rotation.set(1.48, -0.35, 0.25);
    scatteredWood.castShadow = true;
    camp.add(scatteredWood);
    this.trackObject(camp);
    this.scene.add(camp);
  }

  private createArchitectureMaterial(color: number, roughness = 0.86, metalness = 0.08): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.add(material);
    return material;
  }

  private addArchitectureMesh<T extends THREE.BufferGeometry, M extends THREE.Material>(
    geometry: T,
    material: M,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh<T, M> {
    const mesh = new THREE.Mesh<T, M>(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.trackObject(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private buildSanctuary(): void {
    const stone = this.createArchitectureMaterial(0x656b69, 0.92);
    const wornStone = this.createArchitectureMaterial(0x817966, 0.9);
    const roof = this.createArchitectureMaterial(0x343b3c, 0.7, 0.18);
    const platformY = this.getSurfaceHeight(0, 1) + 0.03;
    this.addArchitectureMesh(new THREE.CylinderGeometry(17, 18, 0.12, 32), stone, 0, platformY, 1);
    this.addArchitectureMesh(new THREE.CylinderGeometry(9.4, 9.8, 0.08, 32), wornStone, 0, platformY + 0.1, 1);
    const sanctuaryRingMaterial = this.createArchitectureMaterial(0xb3945c, 0.42, 0.64);
    sanctuaryRingMaterial.emissive.setHex(0x6a4318);
    sanctuaryRingMaterial.emissiveIntensity = 0.32;
    const sanctuaryRing = this.addArchitectureMesh(
      new THREE.TorusGeometry(5.8, 0.12, 10, 72),
      sanctuaryRingMaterial,
      0,
      platformY + 0.22,
      1,
    );
    sanctuaryRing.rotation.x = -Math.PI / 2;
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 7.4;
      const z = 1 + Math.sin(angle) * 7.4;
      const ground = this.getSurfaceHeight(x, z);
      this.addArchitectureMesh(
        new THREE.CylinderGeometry(0.28, 0.48, 2.2 + (index % 3) * 0.24, 7),
        index % 2 === 0 ? wornStone : stone,
        x,
        ground + 1.1 + (index % 3) * 0.12,
        z,
      );
      this.addArchitectureMesh(
        new THREE.ConeGeometry(0.34, 0.46, 7),
        roof,
        x,
        ground + 2.35 + (index % 3) * 0.12,
        z,
      );
    }

    for (const [x, z] of [[-13, -13], [13, -13], [-13, 14], [13, 14]]) {
      const ground = this.getSurfaceHeight(x, z);
      this.addArchitectureMesh(new THREE.CylinderGeometry(1.7, 2.2, 8, 12), stone, x, ground + 4, z);
      this.addArchitectureMesh(new THREE.CylinderGeometry(0.35, 1.95, 2.7, 12), roof, x, ground + 9.25, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(1.25, 2.2, 0.12), roof, x, ground + 2.1, z + 1.77);
    }

    const portalColors = [0x9ac4ff, 0xef7945, 0x67b9d8];
    for (const [index, x] of [-8, 0, 8].entries()) {
      const z = -5;
      const ground = this.getSurfaceHeight(x, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(0.46, 3.2, 0.52), wornStone, x - 1.55, ground + 1.6, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(0.46, 3.2, 0.52), wornStone, x + 1.55, ground + 1.6, z);
      for (const side of [-1, 1]) {
        this.addArchitectureMesh(new THREE.BoxGeometry(0.82, 0.38, 0.88), stone, x + side * 1.55, ground + 0.19, z);
        this.addArchitectureMesh(new THREE.BoxGeometry(0.72, 0.34, 0.78), wornStone, x + side * 1.55, ground + 3.2, z);
        this.addArchitectureMesh(new THREE.BoxGeometry(0.1, 1.85, 0.08), roof, x + side * 1.55, ground + 1.6, z + 0.3);
      }
      this.addArchitectureMesh(new THREE.BoxGeometry(3.55, 0.48, 0.6), stone, x, ground + 3.25, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(0.82, 0.7, 0.78), wornStone, x, ground + 3.62, z);
      const frame = this.addArchitectureMesh(
        new THREE.TorusGeometry(1.05, 0.075, 10, 36),
        new THREE.MeshStandardMaterial({
          color: portalColors[index],
          emissive: portalColors[index],
          emissiveIntensity: 1.25,
          roughness: 0.36,
          metalness: 0.24,
          transparent: true,
          opacity: 0.88,
        }),
        x,
        ground + 1.55,
        z - 0.08,
      );
      this.materials.add(frame.material);
    }
    this.addBrazier(-13, -8, 0xffb36b);
    this.addBrazier(13, -8, 0xffb36b);

    const hallGround = this.getSurfaceHeight(0, -23);
    this.addArchitectureMesh(new THREE.BoxGeometry(16, 9, 2.2), stone, 0, hallGround + 4.5, -24);
    this.addArchitectureMesh(new THREE.BoxGeometry(18, 1.4, 3.2), roof, 0, hallGround + 9.5, -24);
    for (const x of [-5.2, 0, 5.2]) {
      this.addArchitectureMesh(new THREE.BoxGeometry(1.05, 5.2, 0.3), roof, x, hallGround + 3.5, -22.85);
    }
  }

  private buildAshenSanctuary(): void {
    const basalt = this.createArchitectureMaterial(0x292a2b, 0.93, 0.12);
    const cutStone = this.createArchitectureMaterial(0x484441, 0.86, 0.18);
    const lava = this.createArchitectureMaterial(0xff6a24, 0.32, 0.08);
    lava.emissive.set(0xff3d12);
    lava.emissiveIntensity = 2.1;
    this.lavaMaterial = lava;
    for (const x of [-15, -10, 10, 15]) {
      const z = -13 - (Math.abs(x) > 12 ? 7 : 0);
      const ground = this.getSurfaceHeight(x, z);
      this.addArchitectureMesh(new THREE.CylinderGeometry(0.7, 1.3, 5.6, 8), basalt, x, ground + 2.8, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(2.2, 0.42, 2.2), cutStone, x, ground + 5.65, z);
    }
    this.addBrazier(-13, -16, 0xff6330);
    this.addBrazier(13, -16, 0xff6330);
    this.addArchitectureMesh(
      new THREE.CylinderGeometry(12, 13, 0.14, 32),
      basalt,
      0,
      this.getSurfaceHeight(0, -18) + 0.05,
      -18,
    );
    const lavaCurves = [
      [[-24, 0, 7], [-17, 0, 4], [-13, 0, -4], [-11, 0, -16]],
      [[24, 0, 7], [17, 0, 4], [13, 0, -4], [11, 0, -16]],
    ];
    for (const points of lavaCurves) {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, , z]) =>
        new THREE.Vector3(x, this.getSurfaceHeight(x, z) + 0.16, z),
      ));
      this.addArchitectureMesh(new THREE.TubeGeometry(curve, 56, 0.72, 10, false), lava, 0, 0, 0);
    }
    this.buildVolcanicSmoke();
    this.addReturnPortal();
  }

  private buildVolcanicSmoke(): void {
    const random = randomGenerator(48193);
    const count = 72;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      const side = index % 2 === 0 ? -1 : 1;
      const x = side * (11 + random() * 9);
      const z = -17 + random() * 21;
      positions[index * 3] = x;
      positions[index * 3 + 1] = this.getSurfaceHeight(x, z) + 1 + random() * 8;
      positions[index * 3 + 2] = z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometries.add(geometry);
    const material = new THREE.PointsMaterial({
      color: 0x70605a,
      map: this.cloudTexture,
      size: 2.2,
      transparent: true,
      opacity: 0.22,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.materials.add(material);
    this.smokeParticles = new THREE.Points(geometry, material);
    this.smokeParticles.frustumCulled = false;
    this.scene.add(this.smokeParticles);
  }

  private buildDragonThrone(): void {
    const fortressStone = this.createArchitectureMaterial(0x4b5051, 0.9, 0.12);
    const iron = this.createArchitectureMaterial(0x272d30, 0.55, 0.72);
    const bridgeDeckY = this.getSurfaceHeight(0, -13) + 0.04;
    this.addArchitectureMesh(
      new THREE.BoxGeometry(10, 0.12, 39),
      fortressStone,
      0,
      bridgeDeckY,
      -12,
    );
    for (const x of [-5.25, 5.25]) {
      for (let z = 5; z >= -30; z -= 5) {
        const ground = this.getSurfaceHeight(x, z);
        this.addArchitectureMesh(new THREE.BoxGeometry(0.55, 1.4, 0.62), iron, x, ground + 0.7, z);
        if (z > -30) {
          this.addArchitectureMesh(
            new THREE.BoxGeometry(0.38, 0.72, 4.25),
            fortressStone,
            x,
            ground + 0.52,
            z - 2.5,
          );
        }
      }
    }
    for (const z of [-8, -23]) {
      const arch = this.addArchitectureMesh(
        new THREE.TorusGeometry(4.3, 0.34, 8, 28, Math.PI),
        fortressStone,
        0,
        bridgeDeckY - 3.8,
        z,
      );
      arch.castShadow = true;
    }
    for (const [x, z] of [[-12, -28], [12, -28]]) {
      const ground = this.getSurfaceHeight(x, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(4.5, 13, 4.5), fortressStone, x, ground + 6.5, z);
      this.addArchitectureMesh(new THREE.ConeGeometry(3.3, 5.2, 8), iron, x, ground + 15.5, z);
      this.addArchitectureMesh(new THREE.BoxGeometry(5.5, 0.8, 6), iron, x, ground + 13.2, z);
    }
    this.addBrazier(-7.5, -12, 0x9bc7df);
    this.addBrazier(7.5, -12, 0x9bc7df);
    const gateGround = this.getSurfaceHeight(0, -33);
    this.addArchitectureMesh(new THREE.BoxGeometry(18, 10, 2), fortressStone, 0, gateGround + 5, -33);
    this.addArchitectureMesh(new THREE.BoxGeometry(20, 1.2, 3), iron, 0, gateGround + 10.4, -33);
    this.addArchitectureMesh(new THREE.BoxGeometry(6.2, 7.2, 2.5), iron, 0, gateGround + 3.8, -31.8);
    this.addReturnPortal();
  }

  private addReturnPortal(): void {
    const x = 0;
    const z = 24;
    const ground = this.getSurfaceHeight(x, z);
    const portal = this.addArchitectureMesh(
      new THREE.TorusGeometry(1.25, 0.09, 10, 40),
      new THREE.MeshStandardMaterial({
        color: 0x91c6c1,
        emissive: 0x397d78,
        emissiveIntensity: 1.35,
        roughness: 0.4,
        metalness: 0.28,
      }),
      x,
      ground + 1.55,
      z,
    );
    this.materials.add(portal.material);
  }

  private addBrazier(x: number, z: number, flameColor: number): void {
    const ground = this.getSurfaceHeight(x, z);
    const iron = this.createArchitectureMaterial(0x292e30, 0.52, 0.72);
    const stone = this.createArchitectureMaterial(0x555452, 0.9, 0.08);
    const flameMaterial = new THREE.MeshStandardMaterial({
      color: flameColor,
      emissive: flameColor,
      emissiveIntensity: 1.7,
      roughness: 0.48,
      metalness: 0.04,
    });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffe6ad });
    this.materials.add(flameMaterial);
    this.materials.add(coreMaterial);

    this.addArchitectureMesh(new THREE.BoxGeometry(0.92, 0.22, 0.92), stone, x, ground + 0.11, z);
    this.addArchitectureMesh(new THREE.CylinderGeometry(0.29, 0.4, 1.1, 8), iron, x, ground + 0.76, z);
    this.addArchitectureMesh(new THREE.CylinderGeometry(0.53, 0.34, 0.28, 8), iron, x, ground + 1.35, z);
    this.addArchitectureMesh(new THREE.ConeGeometry(0.27, 0.78, 7), flameMaterial, x, ground + 1.82, z);
    this.addArchitectureMesh(new THREE.ConeGeometry(0.13, 0.46, 6), coreMaterial, x, ground + 1.74, z);

    const light = new THREE.PointLight(flameColor, 1.1, 13, 2);
    light.position.set(x, ground + 1.95, z);
    this.scene.add(light);
    this.brazierLights.push(light);
  }

  private buildLighting(): void {
    const skyColor = this.location === 'floor2' || this.location === 'floor4' ? 0x9c7566 : this.location === 'floor3' ? 0xa2b4c0 : 0xc8dcf5;
    const groundColor = this.location === 'floor2' || this.location === 'floor4' ? 0x302a29 : this.location === 'floor3' ? 0x3e454b : 0x493a36;
    this.hemisphere = new THREE.HemisphereLight(
      skyColor,
      groundColor,
      this.graphics.hemisphereLightIntensity,
    );
    this.scene.add(this.hemisphere);
    const sunlight = this.location === 'floor2' || this.location === 'floor4' ? 0xff8a4b : this.location === 'floor3' ? 0xc5d8e6 : 0xffd5a1;
    this.sun = new THREE.DirectionalLight(sunlight, this.graphics.directionalLightIntensity);
    this.sun.position.set(-28, 52, 25);
    this.sun.castShadow = this.graphics.shadows;
    this.sun.shadow.mapSize.set(this.graphics.shadowMapSize, this.graphics.shadowMapSize);
    this.sun.shadow.camera.left = -43;
    this.sun.shadow.camera.right = 43;
    this.sun.shadow.camera.top = 43;
    this.sun.shadow.camera.bottom = -43;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 125;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  private buildParticles(): void {
    const random = randomGenerator(27183);
    const positions = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 5 + random() * 45;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = this.getSurfaceHeight(positions[i * 3], Math.sin(angle) * radius) + 0.4 + random() * 6;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometries.add(geometry);
    const material = new THREE.PointsMaterial({
      color: this.location === 'floor2' || this.location === 'floor4'
        ? 0xff8750
        : this.location === 'floor3'
          ? 0xd8e4ed
          : this.location === 'hub'
            ? 0xe6d7a7
            : 0xdce9f1,
      size: this.location === 'floor2' || this.location === 'floor4' ? 0.08 : this.location === 'hub' ? 0.07 : 0.12,
      transparent: true,
      opacity: this.location === 'floor2' || this.location === 'floor4' ? 0.58 : this.location === 'hub' ? 0.24 : 0.42,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.materials.add(material);
    this.particles = new THREE.Points(geometry, material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  private addCollider(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2),
      body,
    );
    this.colliders.push(body);
  }

  private addTrunkCollider(x: number, ground: number, z: number, scale: number): void {
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, ground + 1.45 * scale, z),
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cylinder(1.45 * scale, 0.24 * scale),
      body,
    );
    this.colliders.push(body);
  }

  private distanceToCurve(
    x: number,
    z: number,
    curve: THREE.CatmullRomCurve3,
    samples: number,
  ): number {
    let nearestSquared = Number.POSITIVE_INFINITY;
    let points = this.curvePoints.get(curve);
    if (!points) {
      points = curve.getPoints(samples);
      this.curvePoints.set(curve, points);
    }
    for (const point of points) {
      const dx = x - point.x;
      const dz = z - point.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < nearestSquared) nearestSquared = distanceSquared;
    }
    return Math.sqrt(nearestSquared);
  }

  private trackObject<T extends THREE.Object3D>(object: T): T {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.geometries.add(child.geometry);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (!Object.values(this.assets.materials).includes(material)) this.materials.add(material);
        });
      }
    });
    return object;
  }

  dispose(): void {
    this.disposed = true;
    this.audio.dispose();
    for (const model of this.natureModels) this.assets.releaseModel(model);
    this.natureModels.length = 0;
    for (const body of this.colliders) this.physics.removeRigidBody(body);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.scene.clear();
    this.scene.background = null;
    this.scene.fog = null;
    this.colliders.length = 0;
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.curvePoints.clear();
    this.windUniforms.length = 0;
    this.waterTimeUniforms.length = 0;
    this.brazierLights.length = 0;
  }
}
