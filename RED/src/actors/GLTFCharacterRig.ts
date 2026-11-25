import * as THREE from 'three';
import type { AssetManager, LoadedModel } from '../core/AssetManager';
import type { CharacterRig } from './CharacterRig';

export type ActorAnimationState = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death' | 'block' | 'jump';

export type ActorAnimationMap = Partial<Record<ActorAnimationState, string | readonly string[]>>;

export interface RiggedActorReview {
  name: string;
  author: string;
  sourceUrl: string;
  license: string;
  fileSizeBytes: number;
  faceCount: number;
  maxTextureSize: number;
  externalResourceCount: number;
  skeletonBoneCount: number;
  animationClips: readonly string[];
  branded?: boolean;
  placeholder?: boolean;
}

export interface RiggedCharacterAssetConfig {
  path: string;
  targetHeight: number;
  walkSpeed?: number;
  runSpeed?: number;
  attackDurations?: readonly [number, number, number];
  attackBoneNames?: readonly string[];
  groundOffset?: number;
  rotationY?: number;
  animations: ActorAnimationMap;
  rootBoneName?: string;
  inPlaceRootMotionClips?: readonly string[];
  weaponSocketName?: string;
  review: RiggedActorReview;
}

const ALLOWED_LICENSES = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'MIT',
  'Apache-2.0',
]);

export function validateRiggedActorReview(review: RiggedActorReview): string[] {
  const failures: string[] = [];
  if (!review.name.trim() || /test|mannequin|placeholder|sample|cesium|primitive/i.test(review.name)) {
    failures.push('The asset name indicates a test, sample, mannequin, or placeholder model.');
  }
  if (!review.author.trim() || !review.sourceUrl.startsWith('https://')) {
    failures.push('The credited author and original HTTPS source are required.');
  }
  if (!ALLOWED_LICENSES.has(review.license)) failures.push(`Unapproved or unverified license: ${review.license || 'missing'}.`);
  if (review.branded) failures.push('Branded sample content is not accepted.');
  if (review.placeholder) failures.push('Placeholder geometry is not accepted.');
  if (review.fileSizeBytes <= 0 || review.fileSizeBytes > 20 * 1024 * 1024) {
    failures.push('The model must be non-empty and no larger than 20 MiB.');
  }
  if (review.faceCount <= 0 || review.faceCount > 80_000) failures.push('The model must contain 1-80,000 faces.');
  if (review.maxTextureSize <= 0 || review.maxTextureSize > 4096) {
    failures.push('Textures must be no larger than 4096 pixels per side.');
  }
  if (review.externalResourceCount < 0 || review.externalResourceCount > 8) {
    failures.push('The model may reference no more than eight external resources.');
  }
  if (review.skeletonBoneCount < 12) failures.push('A usable character skeleton must contain at least 12 bones.');
  if (new Set(review.animationClips).size !== review.animationClips.length) {
    failures.push('The reviewed animation clip list contains duplicate names.');
  }
  return failures;
}

export class GLTFCharacterRig implements CharacterRig {
  readonly model = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly animationByName: Map<string, THREE.AnimationClip>;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly attackActions: THREE.AnimationAction[] = [];
  private activeAction: THREE.AnimationAction | null = null;
  private activeAttackAction: THREE.AnimationAction | null = null;
  private activeTransient: ActorAnimationState | null = null;
  private locomotionState: ActorAnimationState = 'idle';
  private attackSequence = 0;
  private blockBlend = 0;
  private disposed = false;

  constructor(
    private readonly loaded: LoadedModel,
    private readonly config: RiggedCharacterAssetConfig,
    private readonly assets: AssetManager,
  ) {
    const validationFailures = validateRiggedActorReview(config.review);
    if (validationFailures.length) throw new Error(validationFailures.join(' '));

    const bones = new Set<THREE.Bone>();
    const geometries = new Set<THREE.BufferGeometry>();
    let faceCount = 0;
    let maxTextureSize = 0;
    let hasSkinnedMesh = false;
    loaded.scene.traverse((object) => {
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (object instanceof THREE.SkinnedMesh) {
        hasSkinnedMesh = true;
        object.skeleton.bones.forEach((bone) => bones.add(bone));
      }
      if (!geometries.has(object.geometry)) {
        geometries.add(object.geometry);
        faceCount += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (!(value instanceof THREE.Texture)) continue;
          const image = value.image as { width?: number; height?: number } | undefined;
          maxTextureSize = Math.max(maxTextureSize, image?.width ?? 0, image?.height ?? 0);
        }
      }
    });
    if (!hasSkinnedMesh || bones.size < 12) {
      throw new Error('The configured character model does not contain a usable skinned skeleton.');
    }
    if (bones.size !== config.review.skeletonBoneCount) {
      throw new Error(`Reviewed ${config.review.skeletonBoneCount} skeleton bones but loaded ${bones.size}.`);
    }
    if (faceCount > 80_000 || Math.abs(faceCount - config.review.faceCount) > Math.max(12, faceCount * 0.1)) {
      throw new Error(`The loaded model face count (${faceCount}) does not match the reviewed budget.`);
    }
    if (maxTextureSize > 4096 || maxTextureSize > config.review.maxTextureSize) {
      throw new Error(`The loaded texture size (${maxTextureSize}px) exceeds the reviewed budget.`);
    }

    const bounds = new THREE.Box3().setFromObject(loaded.scene);
    const sourceHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || !Number.isFinite(config.targetHeight) || config.targetHeight <= 0) {
      throw new Error('The configured character model has invalid bounds or target height.');
    }

    this.model.rotation.y = config.rotationY ?? 0;
    const scale = config.targetHeight / sourceHeight;
    this.model.scale.setScalar(scale);
    loaded.scene.position.y = (config.groundOffset ?? 0) / scale - bounds.min.y;
    this.model.add(loaded.scene);
    this.mixer = new THREE.AnimationMixer(loaded.scene);
    const inPlaceRootMotionClips = new Set(config.inPlaceRootMotionClips ?? []);
    const rootBoneNames = new Set([...bones].map((bone) => bone.name));
    if (inPlaceRootMotionClips.size
      && (!config.rootBoneName || !rootBoneNames.has(config.rootBoneName))) {
      throw new Error(`The in-place root bone "${config.rootBoneName ?? ''}" is missing from the imported skeleton.`);
    }
    const actualClipNames = loaded.animations.map((clip) => clip.name).sort();
    const reviewedClipNames = [...config.review.animationClips].sort();
    if (actualClipNames.length !== reviewedClipNames.length
      || actualClipNames.some((name, index) => name !== reviewedClipNames[index])) {
      throw new Error('The loaded animation clips do not match the reviewed asset inventory.');
    }
    const missingRootMotionClips = [...inPlaceRootMotionClips]
      .filter((name) => !actualClipNames.includes(name));
    if (missingRootMotionClips.length) {
      throw new Error(`Root-motion correction references missing clips: ${missingRootMotionClips.join(', ')}.`);
    }
    this.animationByName = new Map(loaded.animations.map((clip) => {
      if (!config.rootBoneName || !inPlaceRootMotionClips.has(clip.name)) return [clip.name, clip];
      const rootTranslationTrack = `${config.rootBoneName}.position`;
      const tracks = clip.tracks.filter((track) => track.name !== rootTranslationTrack);
      if (tracks.length === clip.tracks.length) {
        throw new Error(`The "${clip.name}" root translation track "${rootTranslationTrack}" was not found.`);
      }
      return [clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)];
    }));
    const configuredClipNames = Object.values(config.animations)
      .flatMap((mapping) => mapping === undefined ? [] : typeof mapping === 'string' ? [mapping] : [...mapping]);
    const missingClips = configuredClipNames.filter((name) => !this.animationByName.has(name));
    if (missingClips.length) {
      throw new Error(`Configured character animations are missing from the GLB: ${missingClips.join(', ')}.`);
    }
    if (config.attackBoneNames?.length) {
      const missingBones = config.attackBoneNames.filter((name) => !this.bones.has(name));
      if (missingBones.length) {
        throw new Error(`Configured procedural attack bones are missing from the GLB: ${missingBones.join(', ')}.`);
      }
      const attackMapping = config.animations.attack;
      const attackClipName = typeof attackMapping === 'string' ? attackMapping : attackMapping?.[0];
      const sourceClip = attackClipName ? this.animationByName.get(attackClipName) : undefined;
      if (!sourceClip) throw new Error('Configured procedural attacks require an existing attack animation clip.');
      const attackBoneNames = new Set(config.attackBoneNames);
      const attackTracks = sourceClip.tracks
        .filter((track) => {
          const separator = track.name.indexOf('.');
          return separator !== -1
            && attackBoneNames.has(track.name.slice(0, separator))
            && track.name.endsWith('.quaternion');
        })
        .map((track) => track.clone());
      if (!attackTracks.length) {
        throw new Error(`The "${sourceClip.name}" clip has no rotation tracks for the configured attack bones.`);
      }
      for (let sequence = 0; sequence < 3; sequence++) {
        const clip = new THREE.AnimationClip(
          `${sourceClip.name}-Combo-${sequence + 1}`,
          sourceClip.duration,
          attackTracks.map((track) => track.clone()),
          THREE.AdditiveAnimationBlendMode,
        );
        THREE.AnimationUtils.makeClipAdditive(clip, 0, sourceClip);
        this.attackActions.push(this.mixer.clipAction(clip));
      }
    }
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
    attackSequence = 0,
  ): void {
    if (this.disposed) return;
    if (this.activeTransient === 'death' && !dead) {
      this.activeAction?.fadeOut(0.18);
      this.activeTransient = null;
      this.activeAction = null;
    }
    this.locomotionState = movement > 0.01
      ? sprinting ? 'run' : 'walk'
      : 'idle';

    this.blockBlend = THREE.MathUtils.damp(this.blockBlend, blocking ? 1 : 0, 12, delta);
    if (attacking && this.activeTransient === 'jump') {
      this.activeAction?.fadeOut(0.1);
      this.activeAction = null;
      this.activeTransient = null;
    }
    const transient = dead ? 'death' : takingDamage ? 'hit' : jumping && !attacking ? 'jump' : null;
    if (transient) this.playTransient(transient, attackSequence);
    else if (this.activeTransient && this.activeTransient !== 'death' && !this.activeAction?.isRunning()) {
      this.activeTransient = null;
      this.activeAction = null;
    }

    if (attacking && !dead && !takingDamage) this.playAttack(attackSequence);
    else if ((dead || takingDamage || (jumping && !attacking)) && this.activeAttackAction) {
      this.activeAttackAction.fadeOut(0.1);
      this.activeAttackAction = null;
    }
    if (this.activeAttackAction && !this.activeAttackAction.isRunning()) {
      this.activeAttackAction.fadeOut(0.12);
      this.activeAttackAction = null;
    }

    if (!this.activeTransient) this.playLoop(this.locomotionState);
    this.mixer.update(delta);
    this.applyProceduralPose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.loaded.scene);
    this.assets.releaseModel(this.loaded.scene);
    this.actions.clear();
    this.attackActions.length = 0;
    this.bones.clear();
    this.model.clear();
  }

  private playAttack(sequence: number): void {
    if (!this.attackActions.length) return;
    const action = this.attackActions[sequence % this.attackActions.length];
    const previous = this.activeAttackAction;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    const duration = this.config.attackDurations?.[sequence % 3] ?? 0.58;
    action.setEffectiveTimeScale(action.getClip().duration / duration);
    if (previous && previous !== action) action.crossFadeFrom(previous, 0.08, false).play();
    else action.fadeIn(0.08).play();
    this.activeAttackAction = action;
    this.attackSequence = sequence % 3;
  }

  private applyProceduralPose(): void {
    const action = this.activeAttackAction;
    if (action) {
      const progress = THREE.MathUtils.clamp(action.time / action.getClip().duration, 0, 1);
      const windup = 1 - THREE.MathUtils.smoothstep(progress, 0, 0.34);
      const strike = Math.sin(Math.PI * THREE.MathUtils.clamp((progress - 0.2) / 0.62, 0, 1));
      if (this.attackSequence === 0) {
        this.rotateBone('chest', 0.02 * strike, -0.12 * strike, 0.04 * strike);
        this.rotateBone('upperarm_R', 0, 0, 0.08 * strike);
        this.rotateBone('forearm_R', 0, 0.05 * strike, 0);
        this.rotateBone('hand_R', 0.05 * strike, 0, 0);
      } else if (this.attackSequence === 1) {
        this.rotateBone('chest', 0, 0.24 * windup - 0.4 * strike, 0.1 * strike);
        this.rotateBone('upperarm_R', 0, 0, 0.2 * strike);
        this.rotateBone('forearm_R', 0, -0.28 * strike, 0);
        this.rotateBone('hand_R', 0, 0.16 * strike, -0.1 * strike);
      } else if (this.attackSequence === 2) {
        this.rotateBone('chest', -0.18 * windup + 0.28 * strike, -0.24 * windup + 0.32 * strike, 0);
        this.rotateBone('upperarm_R', -0.25 * windup + 0.28 * strike, 0, 0.18 * strike);
        this.rotateBone('forearm_R', 0.16 * strike, 0, -0.3 * strike);
        this.rotateBone('hand_R', -0.15 * strike, 0, 0.18 * strike);
      }
    }

    const blockWeight = this.blockBlend * (action ? 0.2 : 1);
    if (blockWeight > 0.001) {
      this.rotateBone('chest', -0.04 * blockWeight, -0.08 * blockWeight, 0);
      this.rotateBone('upperarm_R', -0.12 * blockWeight, 0, -0.28 * blockWeight);
      this.rotateBone('forearm_R', -0.18 * blockWeight, 0, -0.12 * blockWeight);
      this.rotateBone('upperarm_L', -0.16 * blockWeight, 0, 0.22 * blockWeight);
      this.rotateBone('forearm_L', -0.2 * blockWeight, 0, 0.12 * blockWeight);
    }
  }

  private rotateBone(name: string, x: number, y: number, z: number): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    bone.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')),
    ).normalize();
  }

  private playTransient(state: ActorAnimationState, sequence: number): void {
    const action = this.resolveAction(state, sequence);
    if (!action) return;
    if (this.activeAction === action
      && this.activeTransient === state
      && action.isRunning()
      && action.time < action.getClip().duration - 0.04) return;
    this.activeAction?.fadeOut(0.12);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(0.12).play();
    this.activeAction = action;
    this.activeTransient = state;
  }

  private playLoop(state: ActorAnimationState): void {
    const action = this.resolveAction(state, 0);
    if (!action) {
      this.activeAction?.fadeOut(0.18);
      this.activeAction = null;
      return;
    }
    if (action === this.activeAction) return;
    this.activeAction?.fadeOut(0.18);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.fadeIn(0.18).play();
    this.activeAction = action;
  }

  private resolveAction(state: ActorAnimationState, sequence: number): THREE.AnimationAction | null {
    const mapping = this.config.animations[state];
    if (!mapping) return null;
    const clipName = typeof mapping === 'string'
      ? mapping
      : mapping.length > 0 ? mapping[sequence % mapping.length] : undefined;
    if (!clipName || !this.animationByName.has(clipName)) return null;
    let action = this.actions.get(clipName);
    if (!action) {
      const clip = this.animationByName.get(clipName);
      if (!clip) return null;
      action = this.mixer.clipAction(clip);
      this.actions.set(clipName, action);
    }
    return action;
  }
}