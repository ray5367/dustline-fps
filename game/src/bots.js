// Bots: meshes, routes, sight, hearing, and gunfire.
// A bot is a small state machine: route -> hold -> combat -> (defuse when the
// charge is planted). Decisions live here; damage numbers live in combat.js.
import * as THREE from 'three';
import { BOT, WEAPONS } from './config.js';
import { clamp, range, pick } from './rng.js';

const FRIEND_NAMES = ['Rook', 'Sable', 'Wren', 'Kip'];
const ENEMY_NAMES = ['Dune', 'Fang', 'Husk', 'Vex', 'Rattle'];
const FRIEND_COLOR = 0x2e8b8b;
const ENEMY_COLOR = 0xc75b2a;
const SKIN = 0x8a6f4d;
const DARK = 0x2a2a26;

const _v = new THREE.Vector3();

function buildBotMesh(team) {
  const color = team === 'vultures' ? FRIEND_COLOR : ENEMY_COLOR;
  const group = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const matDark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.9 });
  const matSkin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.3), matDark);
  legs.position.y = 0.375;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.34), matBody);
  torso.position.y = 1.06;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.3), matSkin);
  head.position.y = 1.56;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), matDark);
  helmet.position.y = 1.72;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), matDark);
  gun.position.set(0.2, 1.25, 0.35);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.3, 4),
    new THREE.MeshBasicMaterial({ color }),
  );
  marker.position.y = 2.05;
  marker.rotation.y = Math.PI / 4;
  group.add(legs, torso, head, helmet, gun, marker);
  group.traverse((m) => { m.castShadow = true; });
  return { group, torso, head, gun, marker };
}

export function createBots(scene, map, rng) {
  const bots = [];
  const make = (team, i) => {
    const spawn = map.spawns[team][i];
    const name = team === 'vultures' ? FRIEND_NAMES[i] : ENEMY_NAMES[i];
    const weaponId = team === 'vultures'
      ? (i % 2 === 0 ? 'hornet' : 'longspur')
      : (i % 2 === 0 ? 'longspur' : 'hornet');
    const { group, torso, head, gun, marker } = buildBotMesh(team);
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);
    const bot = {
      id: `${team}-${i}`, team, name, x: spawn[0], z: spawn[1],
      yaw: team === 'vultures' ? -Math.PI / 2 : Math.PI / 2,
      health: BOT.health, alive: true, weaponId,
      path: [], wpIdx: 0, holdAt: null, holdYaw: 0,
      reaction: 0, burstLeft: 0, burstCooldown: 0, fireCooldown: 0,
      target: null, targetIsPlayer: false,
      investigate: null, defuseProgress: 0, strafeDir: 1, strafeTimer: 0,
      speed: 0, site: null,
      mesh: group, torso, head, gun, marker,
    };
    torso.userData = { bot, part: 'body' };
    head.userData = { bot, part: 'head' };
    bots.push(bot);
    return bot;
  };
  for (let i = 0; i < 4; i++) make('vultures', i);
  for (let i = 0; i < 5; i++) make('jackals', i);
  return bots;
}

export function resetBotsForRound(bots, map, rng, state) {
  for (const bot of bots) {
    const idx = Number(bot.id.split('-')[1]);
    const spawn = map.spawns[bot.team][idx];
    bot.x = spawn[0]; bot.z = spawn[1];
    bot.yaw = bot.team === 'vultures' ? -Math.PI / 2 : Math.PI / 2;
    bot.health = BOT.health; bot.alive = true;
    bot.path = []; bot.wpIdx = 0; bot.target = null;
    bot.reaction = 0; bot.burstLeft = 0; bot.fireCooldown = range(rng, 0.2, 0.8);
    bot.investigate = null; bot.defuseProgress = 0;
    bot.site = null;
    bot.mesh.visible = true;
    bot.mesh.position.set(bot.x, 0, bot.z);
    // Attackers pick a site and push it; defenders split across A, B and mid.
    if (bot.team === 'vultures') {
      bot.site = pick(rng, ['A', 'A', 'B']);
      const target = map.sites[bot.site];
      bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), map.nearestWaypoint(target.x, target.z));
    } else {
      const site = idx < 2 ? 'A' : idx < 4 ? 'B' : null;
      bot.site = site;
      if (site) {
        const s = map.sites[site];
        const wp = map.nearestWaypoint(s.x + range(rng, -4, 4), s.z + range(rng, -4, 4));
        bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), wp);
        bot.holdAt = wp;
      } else {
        bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), 12);
        bot.holdAt = 12;
      }
    }
  }
}

function angleTo(x1, z1, x2, z2) { return Math.atan2(-(x2 - x1), -(z2 - z1)); }

function nearestEnemy(bot, ctx) {
  const { state, map } = ctx;
  let best = null, bestD = 48;
  const consider = (x, z, isPlayer, ref) => {
    const dx = x - bot.x, dz = z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) return;
    if (map.losBlocked(bot.x, bot.z, x, z)) return;
    best = { x, z, d, isPlayer, ref };
    bestD = d;
  };
  if (bot.team === 'jackals' && state.player.alive) consider(state.player.x, state.player.z, true, null);
  for (const other of state.bots) {
    if (other.team === bot.team || !other.alive) continue;
    consider(other.x, other.z, false, other);
  }
  return best;
}

function moveToward(bot, map, tx, tz, speed, dt) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += clamp(diff, -3.2 * dt, 3.2 * dt);
  const step = Math.min(d, speed * dt);
  // Forward on the ground plane is (-sin yaw, -cos yaw).
  bot.x += -Math.sin(bot.yaw) * step;
  bot.z += -Math.cos(bot.yaw) * step;
  const [rx, rz] = map.resolveCircle(bot.x, bot.z, BOT.radius);
  bot.x = rx; bot.z = rz;
  bot.speed = speed;
  return d < 0.6;
}

export function updateBot(bot, ctx, dt) {
  const { state, map, rng, audio } = ctx;
  if (!bot.alive) return;
  bot.fireCooldown -= dt;
  bot.burstCooldown -= dt;

  // The planted charge pulls every defender to its site; one of them defuses.
  if (state.bomb.state === 'planted' && bot.team === 'jackals') {
    const site = map.sites[state.bomb.site];
    const d = Math.hypot(site.x - bot.x, site.z - bot.z);
    if (d < 2.4 && state.bomb.defuser !== bot.id && !state.bomb.defuser) {
      state.bomb.defuser = bot.id;
    }
    if (state.bomb.defuser === bot.id) {
      bot.defuseProgress += dt;
      ctx.onDefuseProgress(bot, bot.defuseProgress);
      if (bot.defuseProgress >= 5) ctx.onDefused(bot);
      return;
    }
    if (d > 3) {
      const wp = map.nearestWaypoint(site.x, site.z);
      if (bot.path.length === 0 || bot.wpIdx >= bot.path.length) {
        bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), wp);
        bot.wpIdx = 0;
      }
    }
  }

  // A dropped charge: the nearest living Vulture runs to recover it, then
  // carries it to their site and plants it there.
  if (state.bomb.state === 'dropped' && bot.team === 'vultures') {
    let nearest = null, nd = Infinity;
    for (const other of state.bots) {
      if (other.team !== 'vultures' || !other.alive) continue;
      const d = Math.hypot(other.x - state.bomb.x, other.z - state.bomb.z);
      if (d < nd) { nd = d; nearest = other; }
    }
    if (nearest === bot) {
      const d = Math.hypot(state.bomb.x - bot.x, state.bomb.z - bot.z);
      if (d < 1.4) {
        state.bomb.state = 'carried';
        state.bomb.carrier = bot.id;
        bot.carrying = true;
        bot.plantProgress = 0;
        bot.gotoDrop = null;
        ctx.onFeed(`${bot.name} recovered the charge`, 'good');
        // Re-route to this bot's site to plant.
        const s = map.sites[bot.site ?? 'A'];
        bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), map.nearestWaypoint(s.x, s.z));
        bot.wpIdx = 0;
      } else if (!bot.gotoDrop || Math.hypot(bot.gotoDrop.x - state.bomb.x, bot.gotoDrop.z - state.bomb.z) > 0.5) {
        // Route to the drop point (and keep re-routing if it moved).
        bot.gotoDrop = { x: state.bomb.x, z: state.bomb.z };
        bot.path = map.bfsPath(map.nearestWaypoint(bot.x, bot.z), map.nearestWaypoint(state.bomb.x, state.bomb.z));
        bot.wpIdx = 0;
      }
    }
  }
  if (bot.carrying && state.bomb.state === 'carried' && bot.team === 'vultures') {
    const s = map.sites[bot.site ?? 'A'];
    if (Math.hypot(bot.x - s.x, bot.z - s.z) < s.r) {
      bot.plantProgress = (bot.plantProgress ?? 0) + dt;
      if (Math.floor(bot.plantProgress * 4) !== Math.floor((bot.plantProgress - dt) * 4)) audio.plantTick();
      if (bot.plantProgress >= 3) {
        bot.carrying = false;
        ctx.onBotPlanted(bot, bot.site ?? 'A');
        return;
      }
    } else {
      bot.plantProgress = Math.max(0, (bot.plantProgress ?? 0) - dt * 2);
    }
  }

  // Sight: nearest visible enemy decides combat.
  const enemy = nearestEnemy(bot, ctx);
  if (enemy) {
    bot.target = enemy;
    const want = angleTo(bot.x, bot.z, enemy.x, enemy.z);
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += clamp(diff, -4.5 * dt, 4.5 * dt);
    if (bot.reaction <= 0) bot.reaction = range(rng, BOT.reactionMin, BOT.reactionMax);
    bot.reaction -= dt;
    if (bot.reaction <= 0) {
      // Strafe while shooting so bots are not turrets.
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) { bot.strafeDir *= -1; bot.strafeTimer = range(rng, 0.5, 1.4); }
      const side = bot.strafeDir;
      const sx = Math.cos(bot.yaw) * side, sz = -Math.sin(bot.yaw) * side;
      const [rx, rz] = map.resolveCircle(bot.x + sx * BOT.walkSpeed * 0.5 * dt, bot.z + sz * BOT.walkSpeed * 0.5 * dt, BOT.radius);
      bot.x = rx; bot.z = rz;
      if (bot.burstLeft <= 0 && bot.burstCooldown <= 0) {
        bot.burstLeft = Math.floor(range(rng, BOT.burstMin, BOT.burstMax + 1));
        bot.burstCooldown = range(rng, 0.7, 1.6);
      }
      if (bot.burstLeft > 0 && bot.fireCooldown <= 0) {
        bot.burstLeft -= 1;
        bot.fireCooldown = 1 / WEAPONS[bot.weaponId].rate;
        ctx.botShoot(bot, enemy);
      }
    }
    syncMesh(bot);
    return;
  }
  bot.target = null;

  // Hearing: a recent loud noise pulls bots toward it.
  if (bot.investigate && state.time - bot.investigate.t < 6) {
    const arrived = moveToward(bot, map, bot.investigate.x, bot.investigate.z, BOT.runSpeed, dt);
    if (arrived) bot.investigate = null;
    syncMesh(bot);
    return;
  }

  // Route: walk the waypoint path; hold at the end, scanning. A retriever
  // steers the last leg straight to the drop point (waypoints only get near it).
  if (bot.wpIdx < bot.path.length) {
    const wp = bot.path[bot.wpIdx];
    const [wx, wz] = [ctx.map.waypoints[wp][0], ctx.map.waypoints[wp][1]];
    const beforeX = bot.x, beforeZ = bot.z;
    let arrived;
    if (bot.sidestepUntil && state.time < bot.sidestepUntil) {
      // Sidestep perpendicular to the target direction to slide off a corner.
      const dx = wx - bot.x, dz = wz - bot.z;
      const d = Math.hypot(dx, dz) || 1;
      const px = (-dz / d) * bot.sidestepDir, pz = (dx / d) * bot.sidestepDir;
      const [rx, rz] = map.resolveCircle(bot.x + px * BOT.walkSpeed * dt, bot.z + pz * BOT.walkSpeed * dt, BOT.radius);
      bot.x = rx; bot.z = rz;
      arrived = false;
    } else {
      arrived = moveToward(bot, map, wx, wz, BOT.runSpeed, dt);
    }
    const moved = Math.hypot(bot.x - beforeX, bot.z - beforeZ);
    if (!arrived && moved < 0.02) {
      bot.stuckT = (bot.stuckT ?? 0) + dt;
      if (bot.stuckT > 1.2) {
        bot.sidestepUntil = state.time + 0.9;
        bot.sidestepDir = rng() < 0.5 ? 1 : -1;
        bot.stuckT = 0;
      }
    } else bot.stuckT = 0;
    if (arrived) bot.wpIdx += 1;
  } else if (bot.gotoDrop && state.bomb.state === 'dropped') {
    moveToward(bot, map, state.bomb.x, state.bomb.z, BOT.runSpeed, dt);
  } else if (bot.holdAt !== null && bot.holdAt !== undefined) {
    // Slow scan sweep while holding.
    bot.holdYaw += dt * 0.5;
    bot.yaw += Math.sin(bot.holdYaw) * dt * 0.6;
    bot.speed = 0;
  } else if (bot.team === 'vultures') {
    // Attackers who reached their site hold it.
    bot.holdYaw += dt * 0.5;
    bot.yaw += Math.sin(bot.holdYaw) * dt * 0.6;
    bot.speed = 0;
  }
  syncMesh(bot);
}

function syncMesh(bot) {
  bot.mesh.position.set(bot.x, 0, bot.z);
  bot.mesh.rotation.y = bot.yaw;
  // Bob the marker so a living bot reads at a glance.
  bot.marker.rotation.y += 0.05;
}

export function hearNoise(ctx, x, z, radius) {
  for (const bot of ctx.state.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.x - x, bot.z - z);
    if (d < radius) bot.investigate = { x, z, t: ctx.state.time };
  }
}
