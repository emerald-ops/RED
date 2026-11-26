import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { AssetManager } from '../core/AssetManager';
import type { CharacterData, GameLocation } from '../core/types';
import { Creature, type CreatureBossConfig } from './Creature';
import { DragonCombatSystem } from './DragonCombatSystem';
import type { DragonBossStyle } from './CreatureAssetConfig';
import {
  DIREWOLF_COMPANION_ASSET,
  DRAGON_BOSSES,
  GLOOM_STALKER_ASSET,
  HOLLOW_WARDEN_ASSET,
} from './CreatureAssetConfig';
import type { CreatureAssetConfig } from './CreatureAssetConfig';

export class CreatureSystem {
  readonly creatures: Creature[] = [];
  private spirit: THREE.Group | null = null;
  private spiritAura: THREE.Points | null = null;
  private spiritAuraMaterial: THREE.PointsMaterial | null = null;
  private spiritCooldown = 0;
  private spiritAttackTimer = 0;
  private spiritLife = 0;
  private readonly rewarded = new Set<Creature>();
  private readonly dragonCombat: DragonCombatSystem;
  private companionRecoverRemaining = 0;
  companion: Creature | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: RAPIER.World,
    private readonly assets: AssetManager,
    character: CharacterData,
    private readonly surfaceHeightAt: (x: number, z: number) => number = () => 0,
    location: GameLocation = 'floor1',
  ) {
    this.dragonCombat = new DragonCombatSystem(scene, surfaceHeightAt);
    if (location === 'floor1') {
      this.spawn('wolf', new THREE.Vector3(-8, 0, 3));
      this.spawn('wolf', new THREE.Vector3(10, 0, -16));
      this.spawn('deer', new THREE.Vector3(7, 0, 9));
      this.spawn('deer', new THREE.Vector3(-19, 0, 5));
      this.spawn('bear', new THREE.Vector3(23, 0, 12));
      this.spawn('bear', new THREE.Vector3(-28, 0, -23));
      this.spawn('bear', new THREE.Vector3(-22, 0, -24), null, GLOOM_STALKER_ASSET);
    } else if (location === 'floor2') {
      this.spawn('bear', new THREE.Vector3(7, 0, -14), null, HOLLOW_WARDEN_ASSET);
    } else if (location === 'floor3') {
      this.spawn('bear', new THREE.Vector3(7, 0, -14), null, HOLLOW_WARDEN_ASSET);
    }
    const floor = location === 'hub' ? 0 : Number(location.slice(-1));
    const boss = DRAGON_BOSSES.find((definition) => definition.floor === floor);
    if (boss && !character.tower.defeatedBosses.includes(boss.id)) {
      this.spawn('bear', new THREE.Vector3(0, 0, -21), {
        id: boss.id,
        name: boss.name,
        style: boss.style,
        health: boss.health,
        damage: boss.damage,
        range: boss.range,
        size: boss.size,
        modelHeight: boss.modelHeight,
      }, boss.asset);
    }
    const companion = this.spawn('wolf', new THREE.Vector3(-1.8, 0, 15.2), null, DIREWOLF_COMPANION_ASSET);
    companion.tame();
    this.companion = companion;
  }

  private spawn(
    kind: 'wolf' | 'deer' | 'bear',
    position: THREE.Vector3,
    boss: CreatureBossConfig | null = null,
    asset: CreatureAssetConfig | null = null,
  ): Creature {
    const creature = new Creature(kind, position, this.physics, this.assets, this.surfaceHeightAt, boss, asset);
    this.creatures.push(creature);
    this.scene.add(creature.model);
    return creature;
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    damagePlayer: (damage: number, style?: DragonBossStyle) => void,
    reward: (creature: Creature) => void,
  ): void {
    this.spiritCooldown = Math.max(0, this.spiritCooldown - delta);
    this.spiritAttackTimer -= delta;
    const companion = this.companion;
    const companionTarget = companion && companion.mood !== 'dead'
      ? this.creatures.find((creature) =>
        (creature.kind === 'wolf' || creature.kind === 'bear')
        && creature !== companion
        && creature.mood !== 'dead' && creature.mood !== 'tamed'
        && (creature.bossId !== null || creature.model.position.distanceTo(playerPosition) < 13)
        && creature.model.position.distanceTo(companion.model.position) < 12,
      ) ?? null
      : null;
    for (const creature of this.creatures) {
      creature.update(delta, playerPosition, {
        damagePlayer: (damage, style) => damagePlayer(damage, style),
        damageCompanion: (damage) => {
          if (creature.bossId && this.companion && this.companion.mood !== 'dead') {
            this.companion.takeDamage(damage);
          }
        },
        companionPosition: this.companion?.mood === 'dead' ? null : this.companion?.model.position,
        companionTarget: creature === companion ? companionTarget?.model.position ?? null : null,
        companionAttack: creature === companion && companionTarget
          ? () => companionTarget.takeDamage(8, companionTarget.model.position.clone().sub(creature.model.position))
          : undefined,
        bossAttack: (attack) => this.dragonCombat.launch(attack),
      });
      if (creature !== this.companion && creature.defeatReady && !this.rewarded.has(creature)) {
        this.rewarded.add(creature);
        reward(creature);
      }
    }
    if (companion) {
      const distance = companion.model.position.distanceTo(playerPosition);
      if (companion.mood === 'dead') {
        companion.companionState = 'Recovering';
        this.companionRecoverRemaining = this.companionRecoverRemaining || 12;
        this.companionRecoverRemaining = Math.max(0, this.companionRecoverRemaining - delta);
        if (this.companionRecoverRemaining === 0) {
          companion.reviveCompanion(playerPosition.clone().add(new THREE.Vector3(-1.5, 0, 1.5)));
          this.companionRecoverRemaining = 0;
        }
      } else {
        if (companionTarget) {
          const targetDistance = companion.model.position.distanceTo(companionTarget.model.position);
          companion.companionState = targetDistance < 3.2 ? 'Attacking' : 'Alert';
        } else if (distance > 24) {
          companion.companionState = 'Returning';
          const x = playerPosition.x - 1.4;
          const z = playerPosition.z + 1.2;
          companion.body.setTranslation({
            x,
            y: companion.groundHeightAt(x, z),
            z,
          }, true);
        } else {
          companion.companionState = distance > 3.2 ? 'Following' : 'Exploring';
        }
      }
    }
    this.dragonCombat.update(
      delta,
      playerPosition,
      damagePlayer,
      this.companion?.mood === 'dead' ? null : this.companion?.model.position ?? null,
      (damage) => this.companion?.takeDamage(damage),
    );
    if (this.spirit) {
      this.spiritLife -= delta;
      const spiritX = playerPosition.x + Math.sin(this.spiritLife * 1.4) * 0.8;
      const spiritZ = playerPosition.z - 1.1;
      const spiritTime = 18 - this.spiritLife;
      this.spirit.position.set(
        spiritX,
        this.surfaceHeightAt(spiritX, spiritZ) + 0.55 + Math.sin(spiritTime * 2.4) * 0.07,
        spiritZ,
      );
      this.spirit.rotation.y += delta * 0.45;
      if (this.spiritAuraMaterial) this.spiritAuraMaterial.opacity = 0.38 + Math.sin(spiritTime * 3.2) * 0.12;
      this.spiritAura?.scale.setScalar(1 + Math.sin(spiritTime * 3.2) * 0.12);
      const target = this.creatures.find((creature) =>
        (creature.kind === 'wolf' || creature.kind === 'bear')
        && creature.mood !== 'dead' && creature.mood !== 'tamed'
        && creature.model.position.distanceTo(this.spirit!.position) < 8,
      );
      if (target && this.spiritAttackTimer <= 0) {
        target.takeDamage(12);
        this.spiritAttackTimer = 1.1;
      }
      if (this.spiritLife <= 0) this.dismissSpirit();
    }
  }

  summonSpirit(playerPosition: THREE.Vector3): boolean {
    if (this.spirit || this.spiritCooldown > 0) return false;
    this.spirit = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.assets.materials.spirit);
    body.scale.set(1.35, 0.85, 0.75);
    body.position.y = 0.65;
    this.spirit.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 6), this.assets.materials.spirit);
    head.position.set(0, 0.84, 0.48);
    this.spirit.add(head);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4), this.assets.materials.spirit);
      ear.position.set(side * 0.17, 1.08, 0.48);
      this.spirit.add(ear);
    }
    const auraPositions = new Float32Array(20 * 3);
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      auraPositions[i * 3] = Math.cos(angle) * 0.62;
      auraPositions[i * 3 + 1] = 0.42 + Math.sin(i * 2.7) * 0.48;
      auraPositions[i * 3 + 2] = Math.sin(angle) * 0.52;
    }
    const auraGeometry = new THREE.BufferGeometry();
    auraGeometry.setAttribute('position', new THREE.BufferAttribute(auraPositions, 3));
    this.spiritAuraMaterial = new THREE.PointsMaterial({
      color: 0x9ce8d7,
      size: 0.09,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.spiritAura = new THREE.Points(auraGeometry, this.spiritAuraMaterial);
    this.spiritAura.frustumCulled = false;
    this.spirit.add(this.spiritAura);
    this.spirit.position.set(
      playerPosition.x,
      this.surfaceHeightAt(playerPosition.x, playerPosition.z - 1) + 0.55,
      playerPosition.z - 1,
    );
    this.scene.add(this.spirit);
    this.spiritCooldown = 35;
    this.spiritLife = 18;
    return true;
  }

  dismissSpirit(): void {
    if (!this.spirit) return;
    this.scene.remove(this.spirit);
    this.spirit.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) object.geometry.dispose();
    });
    this.spiritAuraMaterial?.dispose();
    this.spirit = null;
    this.spiritAura = null;
    this.spiritAuraMaterial = null;
  }

  get spiritActive(): boolean {
    return this.spirit !== null;
  }

  get spiritRemainingCooldown(): number {
    return this.spiritCooldown;
  }

  dispose(): void {
    this.dismissSpirit();
    this.dragonCombat.dispose();
    for (const creature of this.creatures) {
      this.scene.remove(creature.model);
      creature.dispose();
    }
  }
}
