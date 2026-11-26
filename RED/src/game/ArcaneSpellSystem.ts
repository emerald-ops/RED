import * as THREE from 'three';
import type { Creature } from '../creatures/Creature';

function createSparkTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2) / (size / 2);
      const alpha = Math.round(Math.pow(Math.max(0, 1 - distance), 2) * 255);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

interface ChargeEffect {
  group: THREE.Group;
  particles: THREE.Points;
  particlePositions: THREE.BufferAttribute;
  light: THREE.PointLight;
  elapsed: number;
}

interface ArcaneProjectile {
  group: THREE.Group;
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  orbiters: THREE.Group;
  light: THREE.PointLight;
  velocity: THREE.Vector3;
  trail: THREE.Points;
  trailPositions: THREE.BufferAttribute;
  history: THREE.Vector3[];
  rangeRemaining: number;
  damage: number;
}

interface ImpactEffect {
  group: THREE.Group;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  particleMaterial: THREE.PointsMaterial;
  positions: THREE.BufferAttribute;
  velocities: THREE.Vector3[];
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  elapsed: number;
}

export interface ArcaneImpact {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
  target: Creature | null;
}

export class ArcaneSpellSystem {
  private readonly projectiles: ArcaneProjectile[] = [];
  private readonly impacts: ImpactEffect[] = [];
  private readonly sparkTexture = createSparkTexture();
  private charge: ChargeEffect | null = null;
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {}

  beginCharge(position: THREE.Vector3): void {
    if (this.disposed) return;
    this.cancelCharge();
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.055, 1),
      new THREE.MeshBasicMaterial({ color: 0xc4faff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending }),
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x20aaff, transparent: true, opacity: 0.19, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x63eaff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 40), ringMaterial);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.006, 6, 40), ringMaterial.clone());
    ringA.rotation.x = Math.PI / 2;
    ringB.rotation.y = Math.PI / 2;
    const particlePositions = new THREE.BufferAttribute(new Float32Array(24 * 3), 3);
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', particlePositions);
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0x8df5ff,
        size: 0.025,
        map: this.sparkTexture,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    const light = new THREE.PointLight(0x20aaff, 2.2, 1.8);
    group.add(core, aura, ringA, ringB, particles, light);
    group.position.copy(position);
    this.scene.add(group);
    this.charge = { group, particles, particlePositions, light, elapsed: 0 };
  }

  updateCharge(delta: number, position: THREE.Vector3, progress: number): void {
    if (this.disposed || !this.charge) return;
    const charge = this.charge;
    charge.elapsed += delta;
    charge.group.position.copy(position);
    const pulse = 0.86 + Math.sin(charge.elapsed * 18) * 0.14;
    charge.group.scale.setScalar(0.76 + progress * 0.22);
    charge.light.intensity = 1.6 + pulse * 2.2;
    charge.light.distance = 1.5 + pulse * 0.5;
    const point = charge.particles.geometry.getAttribute('position');
    for (let index = 0; index < point.count; index++) {
      const progressOffset = (index / point.count + charge.elapsed * 1.35) % 1;
      const radius = 0.21 * (1 - progressOffset) * (0.62 + 0.38 * progress);
      const angle = index * 2.399963 + charge.elapsed * (2.4 + index % 4);
      point.setXYZ(
        index,
        Math.cos(angle) * radius,
        Math.sin(angle * 1.17) * radius,
        Math.sin(angle) * radius,
      );
    }
    charge.particlePositions.needsUpdate = true;
    charge.group.children[1].scale.setScalar(pulse);
    charge.group.children[2].rotation.z += delta * 1.8;
    charge.group.children[3].rotation.x -= delta * 1.15;
  }

  cancelCharge(): void {
    if (!this.charge) return;
    this.scene.remove(this.charge.group);
    this.disposeTree(this.charge.group);
    this.charge = null;
  }

  launch(position: THREE.Vector3, direction: THREE.Vector3, damage: number): void {
    if (this.disposed) return;
    this.cancelCharge();
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.075, 2),
      new THREE.MeshStandardMaterial({
        color: 0xb9f9ff,
        emissive: 0x00aaff,
        emissiveIntensity: 7,
        roughness: 0.2,
        metalness: 0.1,
      }),
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 16),
      new THREE.MeshBasicMaterial({
        color: 0x16aaff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x75edff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.01, 6, 32), ringMaterial);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 32), ringMaterial.clone());
    ringA.rotation.x = Math.PI / 2;
    ringB.rotation.y = Math.PI / 2;
    const orbiters = new THREE.Group();
    for (let index = 0; index < 6; index++) {
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.026, 0),
        new THREE.MeshBasicMaterial({ color: index % 2 ? 0x62eaff : 0xc0fbff, blending: THREE.AdditiveBlending }),
      );
      shard.position.set(Math.cos(index * Math.PI / 3) * 0.12, Math.sin(index * Math.PI / 3) * 0.12, 0);
      orbiters.add(shard);
    }
    const light = new THREE.PointLight(0x13baff, 6, 4);
    group.add(core, glow, ringA, ringB, orbiters, light);

    const history = Array.from({ length: 18 }, () => position.clone());
    const trailPositions = new THREE.BufferAttribute(new Float32Array(history.length * 3), 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', trailPositions);
    const trail = new THREE.Points(
      trailGeometry,
      new THREE.PointsMaterial({
        color: 0x58ddff,
        size: 0.035,
        map: this.sparkTexture,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    trail.frustumCulled = false;
    group.position.copy(position);
    this.scene.add(trail, group);
    this.projectiles.push({
      group,
      glow,
      orbiters,
      light,
      velocity: direction.clone().normalize().multiplyScalar(15.5),
      trail,
      trailPositions,
      history,
      rangeRemaining: 32,
      damage,
    });
  }

  update(
    delta: number,
    creatures: readonly Creature[],
    surfaceHeightAt: (x: number, z: number) => number,
    onImpact: (impact: ArcaneImpact) => void,
  ): void {
    if (this.disposed) return;
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      const start = projectile.group.position.clone();
      const travel = projectile.velocity.clone().multiplyScalar(delta);
      const end = start.clone().add(travel);
      const segmentLengthSq = travel.lengthSq();
      let collision: { position: THREE.Vector3; target: Creature } | null = null;
      let collisionDistance = Infinity;

      for (const creature of creatures) {
        if (creature.mood === 'dead' || creature.mood === 'tamed') continue;
        const center = creature.model.position.clone().add(new THREE.Vector3(0, creature.height * 0.55, 0));
        const amount = segmentLengthSq > 0
          ? THREE.MathUtils.clamp(center.clone().sub(start).dot(travel) / segmentLengthSq, 0, 1)
          : 0;
        const closest = start.clone().addScaledVector(travel, amount);
        const radius = creature.kind === 'bear' ? 0.9 : 0.56;
        if (amount < collisionDistance && closest.distanceToSquared(center) <= radius * radius) {
          collision = { position: closest, target: creature };
          collisionDistance = amount;
        }
      }

      projectile.rangeRemaining -= travel.length();
      projectile.group.position.copy(end);
      projectile.group.rotation.x += delta * 5.2;
      projectile.group.rotation.y += delta * 7.1;
      projectile.orbiters.rotation.z += delta * 8;
      projectile.history.unshift(end.clone());
      projectile.history.length = 18;
      const trailPosition = projectile.trail.geometry.getAttribute('position');
      projectile.history.forEach((point, pointIndex) => trailPosition.setXYZ(pointIndex, point.x, point.y, point.z));
      projectile.trailPositions.needsUpdate = true;

      const groundHeight = surfaceHeightAt(end.x, end.z);
      const hitGround = end.y <= groundHeight + 0.08 && travel.y < 0;
      const expired = projectile.rangeRemaining <= 0;
      if (collision || hitGround || expired) {
        const position = collision?.position ?? (hitGround
          ? new THREE.Vector3(end.x, groundHeight + 0.04, end.z)
          : end);
        const direction = projectile.velocity.clone().normalize();
        if (collision) {
          collision.target.takeDamage(projectile.damage, direction);
        }
        onImpact({
          position,
          direction,
          damage: collision ? projectile.damage : 0,
          target: collision?.target ?? null,
        });
        this.createImpact(position, direction);
        this.removeProjectile(index);
        continue;
      }
      const pulse = 0.92 + Math.sin(performance.now() * 0.018) * 0.08;
      projectile.glow.scale.setScalar(pulse);
      projectile.light.intensity = 5 + pulse * 3;
    }

    for (let index = this.impacts.length - 1; index >= 0; index--) {
      const impact = this.impacts[index];
      impact.elapsed += delta;
      const progress = Math.min(1, impact.elapsed / 0.46);
      const positions = impact.particles.geometry.getAttribute('position');
      for (let particle = 0; particle < impact.velocities.length; particle++) {
        const velocity = impact.velocities[particle];
        velocity.multiplyScalar(Math.max(0, 1 - delta * 1.8));
        velocity.y -= delta * 1.6;
        positions.setXYZ(
          particle,
          positions.getX(particle) + velocity.x * delta,
          positions.getY(particle) + velocity.y * delta,
          positions.getZ(particle) + velocity.z * delta,
        );
      }
      impact.positions.needsUpdate = true;
      impact.ring.scale.setScalar(0.4 + progress * 4.4);
      impact.ring.material.opacity = 0.9 * (1 - progress);
      impact.light.intensity = 8 * (1 - progress);
      impact.light.distance = 3 + progress * 5;
      impact.particleMaterial.opacity = 0.95 * (1 - progress);
      if (progress >= 1) this.removeImpact(index);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCharge();
    while (this.projectiles.length) this.removeProjectile(this.projectiles.length - 1);
    while (this.impacts.length) this.removeImpact(this.impacts.length - 1);
    this.sparkTexture.dispose();
  }

  private createImpact(position: THREE.Vector3, direction: THREE.Vector3): void {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({
        color: 0x72eaff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().negate());
    const velocities = Array.from({ length: 34 }, (_, index) => {
      const angle = index * 2.399963;
      const vertical = ((index % 7) - 3) / 5;
      return new THREE.Vector3(Math.cos(angle), vertical, Math.sin(angle)).normalize()
        .multiplyScalar(1.7 + (index % 5) * 0.52);
    });
    const positions = new Float32Array(velocities.length * 3);
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', positionAttribute);
    const particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x86efff,
        size: 0.045,
        map: this.sparkTexture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    particles.frustumCulled = false;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xbafaff,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const light = new THREE.PointLight(0x25baff, 8, 8);
    group.add(ring, particles, flash, light);
    group.position.copy(position);
    this.scene.add(group);
    this.impacts.push({
      group,
      particles,
      particleMaterial: particles.material,
      positions: positionAttribute,
      velocities,
      ring,
      light,
      elapsed: 0,
    });
  }

  private removeProjectile(index: number): void {
    const [projectile] = this.projectiles.splice(index, 1);
    this.scene.remove(projectile.group, projectile.trail);
    this.disposeTree(projectile.group);
    this.disposeTree(projectile.trail);
  }

  private removeImpact(index: number): void {
    const [impact] = this.impacts.splice(index, 1);
    this.scene.remove(impact.group);
    this.disposeTree(impact.group);
  }

  private disposeTree(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
