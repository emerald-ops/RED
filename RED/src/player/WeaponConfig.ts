import crystalStaffPath from '../../crystal-staff.glb?url';

export interface WeaponAssetConfig {
  path: string;
  targetHeight: number;
  damageMultiplier: number;
  gripEnd: 'min-z' | 'max-z' | 'min-y';
  lengthAxis?: 'y' | 'z';
  gripOffset?: number;
  firstPersonScale?: number;
  weaponRotationX: number;
}

export const EQUIPPABLE_WEAPONS: Readonly<Record<string, WeaponAssetConfig>> = {
  Broadsword: {
    path: 'assets/weapons/medieval-pack-1/broadsword.glb',
    targetHeight: 0.95,
    damageMultiplier: 1.15,
    gripEnd: 'max-z',
    weaponRotationX: Math.PI / 2,
  },
  'Ornate Sword': {
    path: 'assets/weapons/medieval-pack-1/ornate-sword.glb',
    targetHeight: 1.05,
    damageMultiplier: 1.28,
    gripEnd: 'max-z',
    weaponRotationX: Math.PI / 2,
  },
  Dagger: {
    path: 'assets/weapons/medieval-pack-1/dagger.glb',
    targetHeight: 0.68,
    damageMultiplier: 0.9,
    gripEnd: 'min-z',
    weaponRotationX: -Math.PI / 2,
  },
  'Crystal Staff': {
    path: crystalStaffPath,
    targetHeight: 1.18,
    damageMultiplier: 1.1,
    gripEnd: 'min-y',
    lengthAxis: 'y',
    gripOffset: 0,
    firstPersonScale: 0.45,
    weaponRotationX: 0,
  },
};

export function getWeaponAssetConfig(item: string): WeaponAssetConfig | null {
  return Object.prototype.hasOwnProperty.call(EQUIPPABLE_WEAPONS, item)
    ? EQUIPPABLE_WEAPONS[item]
    : null;
}

export function getWeaponDamageMultiplier(equipment: readonly string[]): number {
  const equippedWeapon = equipment
    .map(getWeaponAssetConfig)
    .find((weapon) => weapon !== null);
  return equippedWeapon?.damageMultiplier ?? 1;
}
