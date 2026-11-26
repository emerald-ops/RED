import * as THREE from 'three';
import type { DragonAttack } from './Creature';
import type { DragonBossStyle } from './CreatureAssetConfig';

interface Projectile {
  group: THREE.Group;
  velocity: THREE.Vector3;
  style: DragonBossStyle;
  damage: number;
  age: number;
  maximumAge: number;
}

interface Breath {
  group: THREE.Group;
  start: THREE.Vector3;
  end: THREE.Vector3;
  elapsed: number;
  style: DragonBossStyle;
  damage: number;
  material: THREE.MeshBasicMaterial;
}

interface GroundZone {
  group: THREE.Group;
  position: THREE.Vector3;
  style: DragonBossStyle;
  damage: number;
  elapsed: number;
  nextDamage: number;
  radius: number;
}

interface Impact {
  group: THREE.Group;
  particles: THREE.Points;
  positions: THREE.BufferAttribute;
  velocities: THREE.Vector3[];
  elapsed: number;
}

const ELEMENT_COLORS: Record<DragonBossStyle, number> = {
  eastern: 0x68e8ce,
  hydra: 0xff7953,
  ice: 0x8beaff,
  fire: 0xff5426,
};

export class DragonCombatSystem {
  private readonly projectiles: Projectile[] = [];
  private readonly breaths: Breath[] = [];
  private readonly zones: GroundZone[] = [];
  private readonly impacts: Impact[] = [];
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly surfaceHeightAt: (x: number, z: number) => number,
  ) {}

  launch(attack: DragonAttack): void {
    if (this.disposed) return;
    if (attack.type === 'projectile') this.launchProjectile(attack);
    else if (attack.type === 'breath') this.launchBreath(attack);
    else this.launchGroundZone(attack);
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    damagePlayer: (damage: number, style: DragonBossStyle) => void,
    companionPosition: THREE.Vector3 | null,
    damageCompanion: (damage: number) => void,
  ): void {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      projectile.age += delta;
      const previous = projectile.group.position.clone();
      projectile.group.position.addScaledVector(projectile.velocity, delta);
      projectile.group.rotation.y += delta * 5.5;
      projectile.group.rotation.x += delta * 3.2;
      if (projectile.group.position.distanceTo(playerPosition) < 1.25) {
        this.createImpact(projectile.group.position, projectile.style);
        damagePlayer(projectile.damage, projectile.style);
        this.removeProjectile(index);
      } else if (companionPosition && projectile.group.position.distanceTo(companionPosition) < 1.25) {
        this.createImpact(projectile.group.position, projectile.style);
        damageCompanion(projectile.damage);
        this.removeProjectile(index);
      } else if (
        projectile.age >= projectile.maximumAge
        || projectile.group.position.y <= this.surfaceHeightAt(projectile.group.position.x, projectile.group.position.z) + 0.12
      ) {
        this.createImpact(projectile.group.position, projectile.style);
        this.removeProjectile(index);
      } else {
        const trail = projectile.group.userData.trail as THREE.Line;
        const points = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
        points.setXYZ(0, previous.x, previous.y, previous.z);
        points.setXYZ(1, projectile.group.position.x, projectile.group.position.y, projectile.group.position.z);
        points.needsUpdate = true;
      }
    }

    for (let index = this.breaths.length - 1; index >= 0; index--) {
      const breath = this.breaths[index];
      breath.elapsed += delta;
      const progress = Math.min(1, breath.elapsed / 0.62);
      breath.group.scale.setScalar(0.65 + progress * 0.35);
      breath.material.opacity = 0.6 * (1 - progress);
      if (breath.elapsed >= 0.62) {
        if (this.distanceToSegment(playerPosition, breath.start, breath.end) < 2.1) {
          damagePlayer(breath.damage, breath.style);
        }
        if (companionPosition && this.distanceToSegment(companionPosition, breath.start, breath.end) < 2.1) {
          damageCompanion(breath.damage);
        }
        this.createImpact(breath.end, breath.style);
        this.removeGroup(this.breaths.splice(index, 1)[0].group);
      }
    }

    for (let index = this.zones.length - 1; index >= 0; index--) {
      const zone = this.zones[index];
      zone.elapsed += delta;
      const age = Math.min(1, zone.elapsed / 0.85);
      zone.group.scale.setScalar(0.55 + age * 0.75);
      const ring = zone.group.children[0] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      ring.material.opacity = zone.elapsed < 0.85 ? 0.72 : 0.42;
      if (zone.elapsed >= zone.nextDamage) {
        const playerHit = playerPosition.distanceTo(zone.position) < zone.radius;
        const companionHit = companionPosition !== null && companionPosition.distanceTo(zone.position) < zone.radius;
        if (playerHit) damagePlayer(zone.damage, zone.style);
        if (companionHit) damageCompanion(zone.damage);
        zone.nextDamage = zone.style === 'fire' ? zone.elapsed + 0.8 : Number.POSITIVE_INFINITY;
        if ((playerHit || companionHit) && zone.style !== 'fire') this.createImpact(zone.position, zone.style);
      }
      const duration = zone.style === 'fire' ? 3.3 : 1.45;
      if (zone.elapsed >= duration) this.removeGroup(this.zones.splice(index, 1)[0].group);
    }

    for (let index = this.impacts.length - 1; index >= 0; index--) {
      const impact = this.impacts[index];
      impact.elapsed += delta;
      const position = impact.positions;
      for (let particle = 0; particle < impact.velocities.length; particle++) {
        const velocity = impact.velocities[particle];
        velocity.multiplyScalar(Math.max(0, 1 - delta * 1.7));
        velocity.y -= delta * 1.25;
        position.setXYZ(
          particle,
          position.getX(particle) + velocity.x * delta,
          position.getY(particle) + velocity.y * delta,
          position.getZ(particle) + velocity.z * delta,
        );
      }
      position.needsUpdate = true;
      const material = impact.particles.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - impact.elapsed / 0.65);
      impact.group.scale.setScalar(1 + impact.elapsed * 2.3);
      if (impact.elapsed >= 0.65) this.removeImpact(index);
    }
  }

  dispose(): void {
    this.disposed = true;
    while (this.projectiles.length) this.removeProjectile(this.projectiles.length - 1);
    while (this.breaths.length) this.removeGroup(this.breaths.pop()!.group);
    while (this.zones.length) this.removeGroup(this.zones.pop()!.group);
    while (this.impacts.length) this.removeImpact(this.impacts.length - 1);
  }

  private launchProjectile(attack: DragonAttack): void {
    const color = ELEMENT_COLORS[attack.style];
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24, 2),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 3.6,
        roughness: 0.24,
      }),
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.035, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xe7fbff, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2;
    const light = new THREE.PointLight(color, 2.4, 5);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 }),
    );
    group.add(core, aura, ring, light, trail);
    group.userData.trail = trail;
    group.position.copy(attack.origin);
    this.scene.add(group);
    const direction = attack.target.clone().sub(attack.origin).normalize();
    this.projectiles.push({
      group,
      velocity: direction.multiplyScalar(13.5),
      style: attack.style,
      damage: attack.damage,
      age: 0,
      maximumAge: Math.max(0.5, attack.origin.distanceTo(attack.target) / 13.5),
    });
  }

  private launchBreath(attack: DragonAttack): void {
    const direction = attack.target.clone().sub(attack.origin);
    const length = Math.min(direction.length(), 10);
    direction.normalize();
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: ELEMENT_COLORS[attack.style],
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, length, 18, 1, true), material);
    group.add(cone);
    group.position.copy(attack.origin).addScaledVector(direction, length * 0.5);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    group.scale.set(0.65, 1, 0.65);
    this.scene.add(group);
    this.breaths.push({
      group,
      start: attack.origin.clone(),
      end: attack.origin.clone().addScaledVector(direction, length),
      elapsed: 0,
      style: attack.style,
      damage: attack.damage,
      material,
    });
  }

  private launchGroundZone(attack: DragonAttack): void {
    const group = new THREE.Group();
    const color = ELEMENT_COLORS[attack.style];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.5, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const light = new THREE.PointLight(color, 1.8, 6);
    light.position.y = 0.5;
    group.add(light);
    const position = attack.target.clone();
    position.y = this.surfaceHeightAt(position.x, position.z) + 0.08;
    group.position.copy(position);
    this.scene.add(group);
    this.zones.push({
      group,
      position,
      style: attack.style,
      damage: attack.damage * 0.78,
      elapsed: 0,
      nextDamage: 0.85,
      radius: 4.1,
    });
  }

  private createImpact(position: THREE.Vector3, style: DragonBossStyle): void {
    const group = new THREE.Group();
    const color = ELEMENT_COLORS[style];
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const count = 20;
    const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    const velocities = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), 0.3 + Math.random() * 1.8, Math.sin(angle))
        .multiplyScalar(1.4 + Math.random() * 3);
    });
    const particles = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', positions),
      new THREE.PointsMaterial({
        color,
        size: 0.16,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    );
    group.add(particles);
    const light = new THREE.PointLight(color, 3, 7);
    group.add(light);
    group.position.copy(position);
    this.scene.add(group);
    this.impacts.push({ group, particles, positions, velocities, elapsed: 0 });
  }

  private distanceToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
    const segment = end.clone().sub(start);
    const denominator = segment.lengthSq();
    if (denominator === 0) return point.distanceTo(start);
    const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / denominator, 0, 1);
    return point.distanceTo(start.addScaledVector(segment, t));
  }

  private removeProjectile(index: number): void {
    this.removeGroup(this.projectiles.splice(index, 1)[0].group);
  }

  private removeImpact(index: number): void {
    const impact = this.impacts.splice(index, 1)[0];
    this.removeGroup(impact.group);
  }

  private removeGroup(group: THREE.Group): void {
    this.scene.remove(group);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
