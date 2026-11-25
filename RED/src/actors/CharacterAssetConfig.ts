import type { Race } from '../core/types';
import type { RiggedCharacterAssetConfig } from './GLTFCharacterRig';

export const PATCH_ANIMATED_KNIGHT: RiggedCharacterAssetConfig = {
  path: 'assets/characters/patch-knight/animatedKnightInPlateArmour.glb',
  targetHeight: 1.85,
  rotationY: 0,
  rootBoneName: 'pelvis',
  inPlaceRootMotionClips: ['Jump'],
  weaponSocketName: 'hand_R',
  animations: {
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    attack: ['Attack', 'Kick'],
    hit: 'Hit',
    jump: 'Jump',
  },
  review: {
    name: 'Animated Knight in Plate Armour',
    author: 'Patch',
    sourceUrl: 'https://github.com/patch-gg/anymove',
    license: 'CC0-1.0',
    fileSizeBytes: 9_711_192,
    faceCount: 59_281,
    maxTextureSize: 4096,
    externalResourceCount: 0,
    skeletonBoneCount: 22,
    animationClips: [
      'Idle',
      'Walk',
      'Walk_Root',
      'Run',
      'Run_Root',
      'Attack',
      'Hit',
      'Jump',
      'Kick',
    ],
  },
};

export const PLAYER_CHARACTER_ASSETS: Partial<Record<Race, RiggedCharacterAssetConfig>> = {
  Human: PATCH_ANIMATED_KNIGHT,
};