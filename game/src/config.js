// Dustline — central tuning: weapons, economy, rounds, teams.
// One place for every number the rest of the game reads; nothing here touches the DOM or three.js.
export const GAME_NAME = 'Dustline';
export const MAP_NAME = 'Cinder Yard';
export const PLAYER_TEAM = 'Vultures';
export const ENEMY_TEAM = 'Jackals';

export const ROUND = {
  buySeconds: 15,
  roundSeconds: 100,
  plantSeconds: 40,
  plantHoldSeconds: 3,
  defuseHoldSeconds: 5,
  winsToTakeMatch: 5,
  maxRounds: 9,
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plantReward: 300,
  armorPrice: 650,
  grenadePrice: 300,
};

export const PLAYER = {
  radius: 0.35,
  eyeStand: 1.62,
  eyeCrouch: 1.05,
  walkSpeed: 5.4,
  crouchSpeed: 2.7,
  accel: 42,
  friction: 9,
  health: 100,
  armorAbsorb: 0.5,
};

// damage, rate (shots/sec), mag, reserve, reload s, spread deg, recoil deg, moveSpread, range, price, auto?
export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 3.0, rate: 4.5, mag: 12, reserve: 48, reload: 1.4,
    spread: 1.1, recoil: 0.9, moveSpread: 2.2, range: 45, auto: false,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9', kind: 'smg', price: 1200,
    damage: 22, headMult: 3.2, rate: 11, mag: 30, reserve: 120, reload: 2.0,
    spread: 1.6, recoil: 0.7, moveSpread: 3.0, range: 40, auto: true,
  },
  longspur: {
    id: 'longspur', name: 'Longspur-47', kind: 'rifle', price: 2700,
    damage: 34, headMult: 4.0, rate: 9, mag: 30, reserve: 90, reload: 2.4,
    spread: 0.7, recoil: 1.5, moveSpread: 3.4, range: 70, auto: true,
  },
  breacher: {
    id: 'breacher', name: 'Breacher-12', kind: 'shotgun', price: 1700,
    damage: 14, headMult: 2.5, rate: 1.4, mag: 6, reserve: 30, reload: 2.8,
    spread: 3.4, recoil: 3.2, moveSpread: 2.0, range: 22, auto: false, pellets: 8,
  },
  falcon: {
    id: 'falcon', name: 'Falcon-88', kind: 'sniper', price: 4750,
    damage: 95, headMult: 4.0, rate: 0.9, mag: 5, reserve: 20, reload: 3.2,
    spread: 0.15, recoil: 4.5, moveSpread: 6.0, range: 120, auto: false, zoom: true,
  },
};

export const BUY_ORDER = ['longspur', 'falcon', 'breacher', 'hornet', 'kestrel'];

export const BOT = {
  radius: 0.35,
  eye: 1.45,
  health: 100,
  walkSpeed: 3.6,
  runSpeed: 4.6,
  reactionMin: 0.45,
  reactionMax: 1.1,
  // per-shot hit probability at 10 m, scaled by distance and target movement
  baseHit: 0.42,
  burstMin: 2,
  burstMax: 5,
};
