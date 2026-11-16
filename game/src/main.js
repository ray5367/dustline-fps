// Dustline — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. Round flow, input, pointer lock, buy logic and the
// deterministic ?shot= hooks for screenshots live here; the sim lives in the
// modules this file wires together.
import * as THREE from 'three';
import { ECONOMY, PLAYER_TEAM, ENEMY_TEAM, ROUND, WEAPONS } from './config.js';
import { mulberry32, clamp } from './rng.js';
import { createAudio } from './audio.js';
import { createMap } from './map.js';
import { createState, addFeed, playerWeapon, resetForRound } from './state.js';
import { updatePlayer, eyeHeight } from './player.js';
import { createBots, resetBotsForRound, updateBot } from './bots.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);

const audio = createAudio();
const map = createMap(scene);
const state = createState();
const bots = createBots(scene, map, rng);
state.bots = bots;

// Bomb prop: a small blinking charge that appears where the plant lands.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.25, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
);
bombLight.position.set(0, 0.18, 0);
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Viewmodel: the player's own gun, parented to the camera.
const viewmodel = new THREE.Group();
const vmBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.07, 0.1, 0.42),
  new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.5, metalness: 0.4 }),
);
const vmBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10),
  new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.4, metalness: 0.6 }),
);
vmBarrel.rotation.x = Math.PI / 2;
vmBarrel.position.set(0, 0.02, -0.34);
const vmAccent = new THREE.Mesh(
  new THREE.BoxGeometry(0.075, 0.02, 0.26),
  new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.5 }),
);
vmAccent.position.set(0, 0.06, -0.04);
viewmodel.add(vmBody, vmBarrel, vmAccent);
viewmodel.position.set(0.24, -0.22, -0.55);
camera.add(viewmodel);

const keys = new Set();
let mouseDown = false;
let rightMouse = false;
let frozen = false; // shot mode: sim runs its setup steps, then freezes.
let shotSetupDone = false;
let renders = 0;
let bobPhase = 0;
let stepTimer = 0;

const world = {
  scene, camera, map, state, rng, audio,
  onHitmarker: (head, kill) => hud.showHitmarker(head),
  onPlayerHurt: () => hud.showHurt(),
  onPlanted: (site) => plantCharge(site, 'You'),
  onBotPlanted: (bot, site) => plantCharge(site, bot.name),
  onFeed: (text, cls) => addFeed(state, text, cls),
  onDetonated: () => {
    bombMesh.visible = false;
    endRound('vultures', 'The charge detonated — the yard is ours.');
  },
  onDefused: (bot) => {
    state.bomb.state = 'defused';
    bombMesh.visible = false;
    addFeed(state, `${bot.name} defused the charge`, 'bad');
    endRound('jackals', `${bot.name} defused the charge.`);
  },
  onDefuseProgress: (bot, progress) => {
    state.bomb.defuseProgress = progress;
    if (Math.floor(progress * 2) !== Math.floor((progress - FIXED_STEP) * 2)) audio.plantTick();
  },
};
const combat = createCombat(world);

const hud = createHud({
  onOverlayClick: () => {
    audio.unlock();
    if (state.phase === 'title' || state.phase === 'matchEnd') startMatch();
    else lockPointer();
  },
  onBuy: (id) => buyItem(id),
});
// Install the title screen's button handler (the overlay is visible in the
// HTML from the start, so this must run at boot, not only on showOverlay).
hud.showOverlay(
  'DUST<em>LINE</em>',
  'A tactical round-based shooter in the Cinder Yard. Plant the charge at Site A or B, or wipe the Jackals out. Stop, aim, and make every round count.',
  'Click to play',
);
document.getElementById('buy-done').addEventListener('click', () => hud.setBuyOpen(false, state));

function plantCharge(site, byName) {
  const bomb = state.bomb;
  bomb.state = 'planted';
  bomb.site = site;
  bomb.fuse = ROUND.plantSeconds;
  bomb.progress = 0;
  state.money += ECONOMY.plantReward;
  addFeed(state, `${byName} planted the charge at Site ${site} — $300`, 'good');
  audio.plantDone();
  const s = map.sites[site];
  bombMesh.position.set(s.x, 0.15, s.z);
  bombMesh.visible = true;
}

function lockPointer() {
  if (shot) return;
  try {
    const p = renderer.domElement.requestPointerLock?.();
    // A synthetic click (or an Esc-resume race) rejects: never let that surface.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* pointer lock unavailable; the game still plays */ }
}

function startMatch() {
  state.wins.vultures = 0;
  state.wins.jackals = 0;
  state.round = 1;
  state.money = ECONOMY.startMoney;
  state.kills = 0;
  state.deaths = 0;
  state.matchWinner = null;
  const p = state.player;
  p.primary = null;
  p.weapon = 'kestrel';
  p.armor = 0;
  p.grenades = 0;
  p.pistolMag = WEAPONS.kestrel.mag;
  p.pistolReserve = WEAPONS.kestrel.reserve;
  startBuyPhase();
}

function startBuyPhase() {
  resetForRound(state);
  const p = state.player;
  const spawn = map.spawns.vultures[0];
  p.x = spawn[0]; p.z = spawn[1];
  p.yaw = -Math.PI / 2; p.pitch = 0;
  resetBotsForRound(bots, map, rng, state);
  state.phase = 'buy';
  state.timer = ROUND.buySeconds;
  hud.hideOverlay();
  hud.setBuyOpen(true, state);
  hud.setHint('Buy phase — press B to close the shop, then push a site.');
  hud.showBanner(`ROUND ${state.round}`, `${PLAYER_TEAM} attack · plant at Site A or Site B`);
  audio.roundStart();
  lockPointer();
}

function startLive() {
  state.phase = 'live';
  state.timer = ROUND.roundSeconds;
  hud.setBuyOpen(false, state);
  hud.setHint('Hold E at a site to plant · B buy (buy phase only) · G frag');
}

function endRound(winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.wins[winner] += 1;
  state.roundEndReason = reason;
  const won = winner === 'vultures';
  state.money += won ? ECONOMY.roundWin : ECONOMY.roundLoss;
  hud.setBuyOpen(false, state);
  hud.showBanner(
    won ? 'ROUND WON' : 'ROUND LOST',
    `${reason}  ·  ${PLAYER_TEAM} ${state.wins.vultures} — ${state.wins.jackals} ${ENEMY_TEAM}  ·  +$${won ? ECONOMY.roundWin : ECONOMY.roundLoss}`,
    4200,
  );
  if (won) audio.roundWin(); else audio.roundLose();
  setTimeout(() => {
    if (frozen) return;
    if (state.wins.vultures >= ROUND.winsToTakeMatch || state.wins.jackals >= ROUND.winsToTakeMatch || state.round >= ROUND.maxRounds) {
      endMatch();
    } else {
      state.round += 1;
      startBuyPhase();
    }
  }, 4200);
}

function endMatch() {
  state.phase = 'matchEnd';
  const won = state.wins.vultures > state.wins.jackals;
  state.matchWinner = won ? 'vultures' : 'jackals';
  hud.showOverlay(
    won ? 'VICTORY IN THE CINDER YARD' : 'THE JACKALS TAKE THE YARD',
    `Final score — ${PLAYER_TEAM} ${state.wins.vultures} · ${state.wins.jackals} ${ENEMY_TEAM}. ` +
    `You finished with ${state.kills} eliminations. Click to run it back.`,
    'Play again',
    () => startMatch(),
  );
  if (document.pointerLockElement) document.exitPointerLock();
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  const jackalsAlive = bots.some((b) => b.team === 'jackals' && b.alive);
  const vulturesAlive = state.player.alive || bots.some((b) => b.team === 'vultures' && b.alive);
  if (!jackalsAlive) { endRound('vultures', 'Every Jackal is down.'); return; }
  if (!vulturesAlive) { endRound('jackals', 'The whole Vulture squad is down.'); return; }
  // Only the player's own carry drops on death; a bot carrying the charge
  // keeps it (its own death drops it via damageBot).
  if ((state.bomb.state === 'carried' || state.bomb.state === 'planting') && !state.player.alive && !state.bomb.carrier) {
    // The charge drops where its carrier fell; a living Vulture recovers it.
    state.bomb.state = 'dropped';
    state.bomb.x = state.player.x;
    state.bomb.z = state.player.z;
    addFeed(state, 'The charge was dropped — a Vulture is recovering it', 'bad');
  }
  if (state.timer <= 0 && state.bomb.state !== 'planted') {
    endRound('jackals', 'Time expired — the Jackals hold the yard.');
  }
}

function buyItem(id) {
  const p = state.player;
  if (id === 'armor') {
    if (p.armor >= 100 || state.money < ECONOMY.armorPrice) { audio.denied(); return; }
    state.money -= ECONOMY.armorPrice;
    p.armor = 100;
  } else if (id === 'grenade') {
    if (state.money < ECONOMY.grenadePrice) { audio.denied(); return; }
    state.money -= ECONOMY.grenadePrice;
    p.grenades += 1;
  } else {
    const w = WEAPONS[id];
    if (!w || p.primary === id || state.money < w.price) { audio.denied(); return; }
    state.money -= w.price;
    p.primary = id;
    p.primaryMag = w.mag;
    p.primaryReserve = w.reserve;
    switchWeapon('primary');
  }
  audio.buy();
  hud.renderBuy(state);
}

function switchWeapon(slot) {
  const p = state.player;
  if (slot === 'primary' && !p.primary) return;
  // Stash the current weapon's ammo in its slot, load the other slot.
  if (p.weapon === 'kestrel') { p.pistolMag = p.mag; p.pistolReserve = p.reserve; }
  else if (p.primary) { p.primaryMag = p.mag; p.primaryReserve = p.reserve; }
  if (slot === 'primary') {
    p.weapon = p.primary;
    p.mag = p.primaryMag; p.reserve = p.primaryReserve;
  } else {
    p.weapon = 'kestrel';
    p.mag = p.pistolMag; p.reserve = p.pistolReserve;
  }
  p.reloading = 0;
  p.fireCooldown = 0.25;
  const def = WEAPONS[p.weapon];
  vmBarrel.scale.z = def.kind === 'sniper' ? 1.8 : def.kind === 'shotgun' ? 1.3 : def.kind === 'smg' ? 0.7 : 1;
}

// ---- Input ----
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyR') combat.startReload();
  if (e.code === 'KeyG') combat.throwGrenade();
  if (e.code === 'Digit1') switchWeapon('primary');
  if (e.code === 'Digit2') switchWeapon('pistol');
  if (e.code === 'KeyB' && state.phase === 'buy') {
    const open = document.getElementById('buy-menu').classList.contains('hidden');
    hud.setBuyOpen(open, state);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state.phase === 'title' || state.phase === 'matchEnd') return;
  if (e.button === 0) {
    mouseDown = true;
    const def = playerWeapon(state);
    if (!def.auto) combat.firePlayer();
  }
  if (e.button === 2) rightMouse = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) rightMouse = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const p = state.player;
  const sens = 0.0021 * (rightMouse ? 0.6 : 1);
  p.yaw -= e.movementX * sens;
  p.pitch = clamp(p.pitch - e.movementY * sens, -1.45, 1.45);
});
document.addEventListener('pointerlockchange', () => {
  if (!shot && document.pointerLockElement !== renderer.domElement
    && (state.phase === 'live' || state.phase === 'buy')) {
    hud.showOverlay('Paused', 'Pointer lock released. Click to jump back in.', 'Resume', () => lockPointer());
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Fixed-step simulation ----
function step(dt) {
  state.time += dt;
  const p = state.player;
  if (state.phase === 'buy') {
    state.timer -= dt;
    updatePlayer(p, keys, map, dt);
    for (const b of bots) updateBot(b, { state, map, rng, audio, botShoot: combat.botShoot, onDefused: world.onDefused, onDefuseProgress: world.onDefuseProgress, onBotPlanted: world.onBotPlanted, onFeed: world.onFeed }, dt);
    if (state.timer <= 0) startLive();
  } else if (state.phase === 'live') {
    if (state.bomb.state === 'planted') state.timer = Math.max(0, state.bomb.fuse);
    else state.timer -= dt;
    updatePlayer(p, keys, map, dt);
    combat.updateWeapon(dt);
    if (mouseDown && p.alive) {
      const def = playerWeapon(state);
      if (def.auto) combat.firePlayer();
    }
    for (const b of bots) updateBot(b, { state, map, rng, audio, botShoot: combat.botShoot, onDefused: world.onDefused, onDefuseProgress: world.onDefuseProgress, onBotPlanted: world.onBotPlanted, onFeed: world.onFeed }, dt);
    combat.updateGrenades(dt);
    combat.updatePlant(dt, keys);
    combat.updateTracers(dt);
    // Footsteps while moving.
    if (p.moving && p.alive) {
      stepTimer -= dt;
      if (stepTimer <= 0) { audio.step(); stepTimer = p.crouch ? 0.7 : 0.42; }
    }
    checkRoundEnd();
    if (state.bomb.state === 'planted' && state.bomb.fuse <= 0) {
      // updatePlant already moved the bomb to detonated; onDetonated ends the round.
    }
  } else if (state.phase === 'roundEnd' || state.phase === 'matchEnd') {
    combat.updateTracers(dt);
    combat.updateGrenades(dt);
  }
  // Bomb light blink while planted.
  if (state.bomb.state === 'planted') {
    bombLight.material.color.setHex(Math.floor(state.time * 3) % 2 === 0 ? 0xff3b30 : 0x550000);
  }
}

// ---- Render ----
function render() {
  const p = state.player;
  if (state.phase === 'title') {
    const t = state.time * 0.08;
    camera.position.set(Math.cos(t) * 22, 10, Math.sin(t) * 15);
    camera.lookAt(0, 0.5, 0);
  } else {
    camera.position.set(p.x, eyeHeight(p), p.z);
    camera.rotation.set(p.pitch + (p.recoilKick ?? 0), p.yaw, 0);
    // Aim down sights: narrow the field of view while the right button is held.
    const def = playerWeapon(state);
    const targetFov = rightMouse ? (def.zoom ? 28 : 55) : 74;
    if (Math.abs(camera.fov - targetFov) > 0.5) {
      camera.fov += (targetFov - camera.fov) * 0.2;
      camera.updateProjectionMatrix();
    }
    // Viewmodel bob + recoil.
    bobPhase += p.speed * 0.09;
    const bob = p.moving ? Math.sin(bobPhase) * 0.008 : 0;
    viewmodel.position.set(0.24 + bob, -0.22 + Math.abs(Math.cos(bobPhase)) * 0.005 - (p.recoilKick ?? 0) * 0.4, -0.55 + (p.recoilKick ?? 0) * 0.6);
    viewmodel.visible = p.alive;
  }
  renderer.render(scene, camera);
}

// ---- Deterministic shot setups ----
function setupShot() {
  if (shot === 'start') {
    // Title screen over the orbiting yard.
    state.phase = 'title';
  } else if (shot === 'buy') {
    startMatch();
    state.phase = 'buy';
    state.timer = 12;
    hud.setBuyOpen(true, state);
  } else if (shot === 'play') {
    startMatch();
    startLive();
    state.timer = 78;
    // Stage a mid-round fight: player at the north gap of the mid wall, three
    // Jackals visible down the lane through it, one Vulture beside the player.
    const p = state.player;
    p.x = -6; p.z = -6; p.yaw = -Math.PI / 2; p.pitch = 0;
    p.weapon = 'longspur';
    p.primary = 'longspur';
    p.mag = 24; p.reserve = 90;
    const stage = [
      ['jackals', 0, 6, -6, 1.5], ['jackals', 1, 10, -3, 1.2], ['jackals', 2, 8, -9, 1.8],
      ['vultures', 0, -8, -2, -1.4],
    ];
    for (const [team, idx, x, z, yaw] of stage) {
      const b = bots.find((bb) => bb.team === team && bb.id.endsWith(`-${idx}`));
      if (!b) continue;
      b.x = x; b.z = z; b.yaw = yaw; b.alive = true; b.health = 100;
      b.mesh.visible = true;
      b.mesh.position.set(x, 0, z);
      b.mesh.rotation.y = yaw;
      b.path = []; b.holdAt = null;
    }
    // Let the sim run briefly so bots take positions and tracers fly, then
    // restore a clean mid-round capture: full health, no death feed, charge carried.
    for (let i = 0; i < 90; i++) step(FIXED_STEP);
    p.health = 100;
    p.alive = true;
    p.armor = 0;
    state.feed = [];
    if (state.bomb.state === 'dropped' || state.bomb.state === 'planting') {
      state.bomb = { state: 'carried', site: null, fuse: 0, progress: 0, defuser: null, x: 0, z: 0, carrier: null };
    }
    hud.clearHurt();
    state.timer = 78;
  } else if (shot === 'end') {
    startMatch();
    state.phase = 'roundEnd';
    state.wins.vultures = 1;
    state.roundEndReason = 'Every Jackal is down.';
    const p = state.player;
    p.x = 6; p.z = -2; p.yaw = -Math.PI / 2; p.pitch = 0;
    hud.setBuyOpen(false, state);
    hud.hideOverlay();
    hud.showOverlay(
      'ROUND WON — VULTURES TAKE THE YARD',
      'Every Jackal is down. Vultures 1 — 0 Jackals. Click to play the next round.',
      'Next round',
      () => { startMatch(); },
    );
    for (let i = 0; i < 30; i++) step(FIXED_STEP);
  }
  shotSetupDone = true;
}

// ---- Main loop ----
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  if (shot && !shotSetupDone) setupShot();
  if (!frozen) {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= FIXED_STEP && n < 5) {
      if (shot && shotSetupDone && shot !== 'start') {
        // In shot mode the setup already advanced the sim; freeze after render.
        acc = 0;
        break;
      }
      step(FIXED_STEP);
      acc -= FIXED_STEP;
      n += 1;
    }
    if (acc > FIXED_STEP * 5) acc = 0;
  }
  render();
  hud.update(state, playerWeapon(state));
  renders += 1;
  if (shot && shotSetupDone && renders >= 3) {
    frozen = true;
    window.__shotReady = true;
  }
}
requestAnimationFrame(frame);

// Test / automation hooks (no network, same-origin only).
window.__dustline = { state, map, bots, combat, hud, startMatch, startLive, endRound, buyItem };
window.addEventListener('error', (e) => { window.__dustlineError = String(e.message); });
