export interface CreatureAssetConfig {
  id: string;
  label: string;
  path: string;
  targetHeight: number;
  rotationY?: number;
  animationMap?: Partial<Record<CreatureAnimationState, string>>;
}

export type CreatureAnimationState = 'idle' | 'walk' | 'run' | 'fly' | 'sit' | 'attack' | 'special' | 'telegraph' | 'hit' | 'death';
export type DragonBossStyle = 'eastern' | 'hydra' | 'ice' | 'fire';

export const TYRANNOSAURUS_TEST_ASSET: CreatureAssetConfig = {
  id: 'tyrannosaurus-test',
  label: 'Tyrannosaurus (in-world test)',
  path: 'assets/monsters/enemies/tyrannosaurus.glb',
  targetHeight: 4.1,
  animationMap: { idle: 'ArmatureAction' },
};

export const DIREWOLF_COMPANION_ASSET: CreatureAssetConfig = {
  id: 'direwolf-companion',
  label: 'Direwolf Companion',
  path: 'assets/monsters/bosses/ancient-wolf/rigged-wolf.glb',
  targetHeight: 1.4,
  animationMap: {
    idle: 'Wolf_Idle_',
    walk: 'Wolf_Walk_cycle_',
    run: 'Wolf_Run_Cycle_',
    sit: 'Wolf_seat_',
    attack: 'Wolf_Run_Cycle_',
    special: 'Wolf_Run_Cycle_',
    telegraph: 'Wolf_creep_cycle',
  },
};

export interface DragonBossDefinition {
  floor: number;
  id: string;
  name: string;
  style: DragonBossStyle;
  health: number;
  damage: number;
  range: number;
  size: number;
  modelHeight: number;
  asset: CreatureAssetConfig;
}

export const DRAGON_BOSSES: readonly DragonBossDefinition[] = [
  {
    floor: 1,
    id: 'eastern-dragon',
    name: 'Jade Eastern Dragon',
    style: 'eastern',
    health: 480,
    damage: 23,
    range: 8,
    size: 2.1,
    modelHeight: 5.4,
    asset: {
      id: 'eastern-dragon',
      label: 'Eastern Dragon',
      path: 'assets/monsters/bosses/dragons/eastern-dragon.glb',
      targetHeight: 5.4,
      animationMap: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Walk',
        fly: 'Fly',
        attack: 'Attack',
        special: 'Attack',
        telegraph: 'Roar',
      },
    },
  },
  {
    floor: 2,
    id: 'three-headed-hydra',
    name: 'Three-Headed Hydra',
    style: 'hydra',
    health: 760,
    damage: 30,
    range: 9,
    size: 2.5,
    modelHeight: 7.6,
    asset: {
      id: 'three-headed-hydra',
      label: 'Three-Headed Hydra',
      path: 'assets/monsters/bosses/dragons/three-headed-hydra.glb',
      targetHeight: 7.6,
      animationMap: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Walk',
        attack: 'Attack',
        special: 'Attack',
        telegraph: 'Roar',
      },
    },
  },
  {
    floor: 3,
    id: 'ice-dragon',
    name: 'Frostbound Dragon',
    style: 'ice',
    health: 920,
    damage: 32,
    range: 11,
    size: 2.2,
    modelHeight: 6.1,
    asset: {
      id: 'ice-dragon',
      label: 'Ice Dragon',
      path: 'assets/monsters/bosses/dragons/ice-dragon.glb',
      targetHeight: 6.1,
      animationMap: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Walk',
        fly: 'Fly',
        attack: 'Attack',
        special: 'Attack',
        telegraph: 'Roar',
      },
    },
  },
  {
    floor: 4,
    id: 'fire-dragon',
    name: 'Emberheart Dragon',
    style: 'fire',
    health: 1120,
    damage: 36,
    range: 12,
    size: 2.3,
    modelHeight: 6.2,
    asset: {
      id: 'fire-dragon',
      label: 'Fire Dragon',
      path: 'assets/monsters/bosses/dragons/fire-dragon.glb',
      targetHeight: 6.2,
      animationMap: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Walk',
        fly: 'Fly',
        attack: 'Attack',
        special: 'Attack',
        telegraph: 'Roar',
      },
    },
  },
];

export const MONSTER_PREVIEW_ASSETS: readonly CreatureAssetConfig[] = [
  DIREWOLF_COMPANION_ASSET,
  {
    id: 'marsh-direwolf-reference',
    label: 'Reference - Marsh Direwolf (static)',
    path: 'assets/monsters/bosses/ancient-wolf/marsh-direwolf.glb',
    targetHeight: 1.4,
  },
  ...DRAGON_BOSSES.map(({ asset }) => asset),
  TYRANNOSAURUS_TEST_ASSET,
  {
    id: 'knight-preview',
    label: 'Knight in Armor (static rig preview only)',
    path: 'assets/characters/preview/knight-in-armor.glb',
    targetHeight: 1.8,
  },
];

export const GLOOM_STALKER_ASSET: CreatureAssetConfig = {
  id: 'gloom-stalker',
  label: 'Gloom Stalker',
  path: 'assets/monsters/enemies/gloom-stalker.glb',
  targetHeight: 1.8,
  animationMap: {
    idle: 'combat_idle',
    walk: 'walk_forward',
    run: 'run_forward',
    attack: 'punch_right',
    special: 'kick',
    hit: 'hit_reaction',
    death: 'death_fall',
  },
};

export const HOLLOW_WARDEN_ASSET: CreatureAssetConfig = {
  id: 'hollow-warden',
  label: 'Hollow Warden',
  path: 'assets/monsters/enemies/hollow-warden.glb',
  targetHeight: 1.8,
  animationMap: {
    idle: 'sword_idle',
    walk: 'walk_forward',
    run: 'run_forward',
    attack: 'sword_slash_horizontal',
    special: 'shield_bash',
    hit: 'stagger_back',
    death: 'knocked_down',
  },
};
