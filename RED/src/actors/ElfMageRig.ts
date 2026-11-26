import * as THREE from 'three';
import type { AssetManager, LoadedModel } from '../core/AssetManager';
import type { CharacterRig } from './CharacterRig';

const REQUIRED_BONES = [
  'root',
  'pelvis',
  'spine_01',
  'spine_02',
  'chest',
  'neck',
  'head',
  'clavicle_R',
  'upperarm_R',
  'forearm_R',
  'hand_R',
  'clavicle_L',
  'upperarm_L',
  'forearm_L',
  'hand_L',
  'thigh_R',
  'calf_R',
  'foot_R',
  'toe_R',
  'thigh_L',
  'calf_L',
  'foot_L',
  'toe_L',
] as const;

export class ElfMageRig implements CharacterRig {
  readonly model = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly bindPose = new Map<string, THREE.Quaternion>();
  private movementBlend = 0;
  private sprintBlend = 0;
  private jumpBlend = 0;
  private dodgeBlend = 0;
  private castBlend = 0;
  private attackBlend = 0;
  private attackProgress = 1;
  private attackSequence = 0;
  private previousAttacking = false;
  private hitBlend = 0;
  private blockBlend = 0;
  private disposed = false;
  private time = 0;

  constructor(
    private readonly loaded: LoadedModel,
    targetHeight: number,
    private readonly assets: AssetManager,
  ) {
    const bounds = new THREE.Box3().setFromObject(loaded.scene);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0 || targetHeight <= 0) {
      throw new Error('The rigged Elf model has invalid bounds or target height.');
    }

    let skinnedMeshCount = 0;
    loaded.scene.traverse((object) => {
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
      if (!(object instanceof THREE.SkinnedMesh)) return;
      skinnedMeshCount++;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    if (skinnedMeshCount === 0) throw new Error('The Elf model has no skinned mesh.');
    const missingBones = REQUIRED_BONES.filter((name) => !this.bones.has(name));
    if (missingBones.length) throw new Error(`The Elf skeleton is missing required bones: ${missingBones.join(', ')}.`);
    for (const [name, bone] of this.bones) this.bindPose.set(name, bone.quaternion.clone());

    const center = bounds.getCenter(new THREE.Vector3());
    loaded.scene.position.set(-center.x, -bounds.min.y, -center.z);
    this.model.scale.setScalar(targetHeight / size.y);
    this.model.add(loaded.scene);
    this.model.updateMatrixWorld(true);

    const hand = this.bones.get('hand_R')!;
    const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
    const modelWorld = this.model.getWorldQuaternion(new THREE.Quaternion());
    this.weaponSocket.name = 'ElfWeaponSocket';
    this.weaponSocket.position.set(0, 0.065, 0);
    this.weaponSocket.quaternion.copy(handWorld.invert().multiply(modelWorld));
    hand.add(this.weaponSocket);
  }

  update(
    delta: number,
    movement: number,
    sprinting: boolean,
    attacking: boolean,
    takingDamage: boolean,
    dead: boolean,
    blocking: boolean,
    jumping: boolean,
    _attackSequence = 0,
    casting = false,
    dodging = false,
  ): void {
    if (this.disposed) return;
    this.time += delta;
    this.movementBlend = THREE.MathUtils.damp(this.movementBlend, Math.min(1, movement), 9, delta);
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, sprinting ? 1 : 0, 8, delta);
    this.jumpBlend = THREE.MathUtils.damp(this.jumpBlend, jumping ? 1 : 0, 12, delta);
    this.dodgeBlend = THREE.MathUtils.damp(this.dodgeBlend, dodging ? 1 : 0, 18, delta);
    this.castBlend = THREE.MathUtils.damp(this.castBlend, casting ? 1 : 0, 15, delta);
    if (attacking && !this.previousAttacking) {
      this.attackSequence = _attackSequence % 3;
      this.attackProgress = 0;
    }
    this.previousAttacking = attacking;
    if (this.attackProgress < 1) {
      const attackDuration = [0.54, 0.59, 0.68][this.attackSequence];
      this.attackProgress = Math.min(1, this.attackProgress + delta / attackDuration);
    }
    this.attackBlend = this.attackProgress < 1
      ? 1 - THREE.MathUtils.smoothstep(this.attackProgress, 0.78, 1)
      : 0;
    this.hitBlend = THREE.MathUtils.damp(this.hitBlend, takingDamage ? 1 : 0, 20, delta);
    this.blockBlend = THREE.MathUtils.damp(this.blockBlend, blocking ? 1 : 0, 12, delta);

    for (const [name, bone] of this.bones) {
      const bind = this.bindPose.get(name);
      if (bind) bone.quaternion.copy(bind);
    }

    const gaitSpeed = THREE.MathUtils.lerp(7, 11, this.sprintBlend);
    const stride = this.movementBlend * THREE.MathUtils.lerp(0.48, 0.82, this.sprintBlend);
    const gait = this.time * gaitSpeed;
    const rightStep = Math.sin(gait) * stride;
    const leftStep = Math.sin(gait + Math.PI) * stride;
    const jump = this.jumpBlend;
    const dodge = this.dodgeBlend;
    const cast = this.castBlend;
    const attack = this.attackBlend;
    const block = this.blockBlend;
    const anticipation = 1 - THREE.MathUtils.smoothstep(this.attackProgress, 0, 0.31);
    const swing = Math.sin(Math.PI * THREE.MathUtils.clamp((this.attackProgress - 0.19) / 0.62, 0, 1));
    const attackFade = this.attackBlend;
    let chestAttackX = 0;
    let chestAttackY = 0;
    let chestAttackZ = 0;
    let shoulderAttackX = 0;
    let shoulderAttackZ = 0;
    let forearmAttackX = 0;
    let forearmAttackY = 0;
    let handAttackY = 0;
    let handAttackZ = 0;
    if (this.attackSequence === 0) {
      chestAttackX = (-0.12 * anticipation + 0.1 * swing) * attackFade;
      chestAttackY = (-0.11 * anticipation + 0.16 * swing) * attackFade;
      chestAttackZ = -0.07 * anticipation * attackFade;
      shoulderAttackX = (-0.82 * anticipation + 0.72 * swing) * attackFade;
      shoulderAttackZ = 0.2 * swing * attackFade;
      forearmAttackX = (0.48 * anticipation - 0.42 * swing) * attackFade;
      forearmAttackY = -0.18 * swing * attackFade;
      handAttackY = -0.12 * swing * attackFade;
    } else if (this.attackSequence === 1) {
      chestAttackX = -0.08 * anticipation * attackFade;
      chestAttackY = (0.27 * anticipation - 0.32 * swing) * attackFade;
      chestAttackZ = 0.12 * swing * attackFade;
      shoulderAttackX = (-0.62 * anticipation + 0.48 * swing) * attackFade;
      shoulderAttackZ = (0.14 * anticipation - 0.28 * swing) * attackFade;
      forearmAttackX = (0.36 * anticipation - 0.32 * swing) * attackFade;
      forearmAttackY = -0.34 * swing * attackFade;
      handAttackY = 0.2 * swing * attackFade;
      handAttackZ = -0.12 * swing * attackFade;
    } else {
      chestAttackX = (-0.18 * anticipation + 0.22 * swing) * attackFade;
      chestAttackY = (-0.2 * anticipation + 0.27 * swing) * attackFade;
      shoulderAttackX = (-1.25 * anticipation + 0.72 * swing) * attackFade;
      shoulderAttackZ = -0.18 * anticipation * attackFade;
      forearmAttackX = (-0.12 * anticipation - 0.42 * swing) * attackFade;
      forearmAttackY = 0.18 * swing * attackFade;
      handAttackY = -0.12 * swing * attackFade;
      handAttackZ = 0.14 * swing * attackFade;
    }

    this.pose('pelvis', -0.035 * Math.abs(rightStep), 0, Math.sin(gait * 0.5) * stride * 0.035);
    this.pose('spine_01', -0.025 * this.sprintBlend - 0.12 * jump, Math.sin(gait * 0.5) * stride * 0.025, -0.2 * dodge);
    this.pose('spine_02', -0.045 * cast - 0.08 * jump, 0, 0.12 * dodge);
    this.pose(
      'chest',
      -0.08 * cast - 0.05 * jump + 0.12 * this.hitBlend + chestAttackX,
      0.08 * cast + chestAttackY,
      -0.32 * dodge + 0.08 * block + chestAttackZ,
    );
    this.pose('neck', -0.035 * cast + 0.06 * this.hitBlend, 0, 0);
    this.pose('head', Math.sin(this.time * 1.15) * 0.012, Math.sin(this.time * 0.65) * 0.025, 0);

    this.pose('thigh_R', rightStep * 0.72 - 0.12 * jump + 0.22 * dodge, 0, -0.08 * dodge);
    this.pose('thigh_L', leftStep * 0.72 - 0.12 * jump - 0.22 * dodge, 0, 0.08 * dodge);
    this.pose('calf_R', Math.max(0, -rightStep) * 0.78 + 0.24 * jump, 0, 0);
    this.pose('calf_L', Math.max(0, -leftStep) * 0.78 + 0.24 * jump, 0, 0);
    this.pose('foot_R', -rightStep * 0.24 - 0.12 * jump, 0, 0);
    this.pose('foot_L', -leftStep * 0.24 - 0.12 * jump, 0, 0);

    this.pose(
      'upperarm_R',
      -rightStep * 0.52 - 0.58 * jump - 1.15 * cast + 0.24 * attack + shoulderAttackX,
      0,
      -0.12 * block + shoulderAttackZ,
    );
    this.pose(
      'forearm_R',
      -0.18 * Math.max(0, rightStep) - 0.3 * jump - 0.58 * cast - 0.24 * attack + forearmAttackX,
      forearmAttackY,
      -0.12 * block,
    );
    this.pose('hand_R', 0.06 * cast, -0.1 * cast + handAttackY, handAttackZ);
    this.pose('upperarm_L', -leftStep * 0.52 - 0.58 * jump - 0.42 * cast - 0.2 * dodge - 0.28 * swing * attackFade, 0, 0.12 * block);
    this.pose('forearm_L', -0.18 * Math.max(0, leftStep) - 0.3 * jump - 0.28 * cast, 0, 0.12 * block);
    this.pose('hand_L', 0, 0, 0);

    if (dead) {
      this.pose('spine_01', 0.58, 0, -0.15);
      this.pose('head', 0.2, 0, 0);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.assets.releaseModel(this.loaded.scene);
    this.model.clear();
    this.bones.clear();
    this.bindPose.clear();
  }

  private pose(name: string, x: number, y: number, z: number): void {
    const bone = this.bones.get(name);
    const bind = this.bindPose.get(name);
    if (!bone || !bind) return;
    bone.quaternion.copy(bind).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
    ).normalize();
  }
}
