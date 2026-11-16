// The single place game state lives. Every module reads and writes this one
// object (created fresh per match); nothing keeps a parallel copy of the score,
// the timer or the bomb.
import { ECONOMY, PLAYER, ROUND, WEAPONS } from './config.js';

export function createState() {
  return {
    phase: 'title', // title | buy | live | roundEnd | matchEnd
    round: 1,
    wins: { vultures: 0, jackals: 0 },
    timer: ROUND.buySeconds,
    money: ECONOMY.startMoney,
    kills: 0,
    deaths: 0,
    feed: [], // {text, cls, t}
    banner: null, // {title, sub, until}
    bomb: {
      state: 'carried', // carried | planting | planted | dropped | defusing | defused | detonated
      site: null,
      fuse: 0,
      progress: 0,
      defuser: null,
      x: 0, z: 0, carrier: null,
    },
    player: {
      x: -29, z: 0, yaw: -Math.PI / 2, pitch: 0,
      vx: 0, vz: 0, health: PLAYER.health, armor: 0, alive: true,
      crouch: false, moving: false, speed: 0,
      weapon: 'kestrel', mag: WEAPONS.kestrel.mag, reserve: WEAPONS.kestrel.reserve,
      primary: null, primaryMag: 0, primaryReserve: 0,
      pistolMag: WEAPONS.kestrel.mag, pistolReserve: WEAPONS.kestrel.reserve,
      grenades: 0, reloading: 0, fireCooldown: 0, bloom: 0, recoilKick: 0,
      lastStepAt: 0, stepSide: 0,
    },
    bots: [],
    grenades: [],
    tracers: [],
    time: 0,
    matchWinner: null,
    roundEndReason: '',
    stats: { shots: 0, hits: 0, headshots: 0 },
  };
}

export function playerWeapon(state) {
  return WEAPONS[state.player.weapon];
}

export function addFeed(state, text, cls = '') {
  state.feed.unshift({ text, cls, t: state.time });
  if (state.feed.length > 5) state.feed.length = 5;
}

export function applyDamageToPlayer(state, amount, attackerName) {
  const p = state.player;
  if (!p.alive) return;
  let remaining = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, remaining * 0.5);
    p.armor -= absorbed;
    remaining -= absorbed;
  }
  p.health -= remaining;
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    state.deaths += 1;
    addFeed(state, `${attackerName} eliminated you`, 'bad');
  }
}

export function resetForRound(state) {
  const p = state.player;
  p.health = PLAYER.health;
  p.alive = true;
  p.reloading = 0;
  p.fireCooldown = 0;
  p.bloom = 0;
  p.recoilKick = 0;
  p.vx = 0; p.vz = 0;
  const w = WEAPONS[p.weapon];
  p.mag = w.mag;
  p.reserve = w.reserve;
  if (p.primary) {
    const pw = WEAPONS[p.primary];
    p.primaryMag = pw.mag;
    p.primaryReserve = pw.reserve;
  }
  state.bomb = { state: 'carried', site: null, fuse: 0, progress: 0, defuser: null, x: 0, z: 0, carrier: null };
  state.grenades = [];
  state.tracers = [];
}
