// Combat: hitscan firing, bot gunfire, grenades, the charge, and damage.
// Everything that changes health or ammo flows through here.
import * as THREE from 'three';
import { BOT, ECONOMY, WEAPONS } from './config.js';
import { applyDamageToPlayer, addFeed } from './state.js';
import { clamp, degToRad, range } from './rng.js';
import { hearNoise } from './bots.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function createCombat(world) {
  const { scene, camera, map, state, rng, audio } = world;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 130;

  function addTracer(from, to, color = 0xffe08a) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    scene.add(line);
    state.tracers.push({ line, life: 0.09 });
  }

  function updateTracers(dt) {
    for (let i = state.tracers.length - 1; i >= 0; i--) {
      const t = state.tracers[i];
      t.life -= dt;
      if (t.isFlash) {
        t.line.material.opacity = Math.max(0, t.life / 0.25) * 0.7;
        const s = 1 + (0.25 - Math.max(0, t.life)) * 22;
        t.line.scale.set(s, s, s);
      } else {
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      }
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        state.tracers.splice(i, 1);
      }
    }
  }

  function botHitMeshes() {
    const meshes = [];
    for (const b of state.bots) {
      if (!b.alive) continue;
      meshes.push(b.torso, b.head);
    }
    return meshes;
  }

  function damageBot(bot, amount, attackerName, isHead, byPlayer) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.mesh.visible = false;
      bot.target = null;
      if (bot.carrying) {
        bot.carrying = false;
        state.bomb.state = 'dropped';
        state.bomb.x = bot.x;
        state.bomb.z = bot.z;
        state.bomb.carrier = null;
        addFeed(state, `${bot.name} was carrying the charge — it dropped`, 'bad');
      }
      if (state.bomb.defuser === bot.id) state.bomb.defuser = null;
      addFeed(state, `${attackerName} eliminated ${bot.name} (${bot.team === 'jackals' ? 'Jackal' : 'Vulture'})`, byPlayer ? 'good' : '');
      if (byPlayer) {
        state.money += ECONOMY.killReward;
        state.kills += 1;
        audio.kill();
      }
    }
  }

  function firePlayer() {
    const p = state.player;
    if (!p.alive || p.reloading > 0 || p.fireCooldown > 0) return;
    const def = WEAPONS[p.weapon];
    if (p.mag <= 0) { audio.dryFire(); startReload(); return; }
    p.fireCooldown = 1 / def.rate;
    p.mag -= 1;
    state.stats.shots += 1;
    const pellets = def.pellets ?? 1;
    // Spread: base + bloom from firing + a penalty for moving fast.
    const movePenalty = def.moveSpread * clamp(p.speed / 5.4, 0, 1) * (p.crouch ? 0.4 : 1);
    const spreadDeg = def.spread + p.bloom + movePenalty;
    camera.getWorldDirection(_dir);
    _origin.copy(camera.position);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _muzzle.copy(_origin).addScaledVector(_dir, 0.6).addScaledVector(_right, 0.18).addScaledVector(_up, -0.14);

    let hitSomething = false;
    for (let i = 0; i < pellets; i++) {
      const d = _dir.clone();
      const a = range(rng, 0, Math.PI * 2);
      const r = degToRad(spreadDeg) * Math.sqrt(rng());
      d.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      raycaster.set(_origin, d);
      raycaster.far = def.range;
      const hits = raycaster.intersectObjects(botHitMeshes().concat(map.shootables), false);
      const end = hits.length ? hits[0].point : _origin.clone().addScaledVector(d, def.range);
      addTracer(_muzzle, end);
      if (hits.length) {
        const hit = hits[0];
        const ud = hit.object.userData;
        if (ud && ud.bot) {
          const isHead = ud.part === 'head';
          const dist = hit.distance;
          const dmg = def.damage * (isHead ? def.headMult : 1) * (dist > 30 ? 0.75 : 1);
          state.stats.hits += 1;
          if (isHead) state.stats.headshots += 1;
          damageBot(ud.bot, dmg, 'You', isHead, true);
          audio.hit(isHead);
          world.onHitmarker(isHead, !ud.bot.alive);
          hitSomething = true;
        }
      }
    }
    // Recoil: a temporary kick that decays back (camera adds it in main.js).
    p.recoilKick = Math.min(0.14, (p.recoilKick ?? 0) + degToRad(def.recoil));
    p.bloom = Math.min(4.5, p.bloom + def.recoil * 0.35);
    audio.shot(def.kind);
    hearNoise(world, p.x, p.z, 28);
    if (p.mag === 0) startReload();
    return hitSomething;
  }

  function startReload() {
    const p = state.player;
    const def = WEAPONS[p.weapon];
    if (p.reloading > 0 || p.mag >= def.mag || p.reserve <= 0) return;
    p.reloading = def.reload;
    audio.reload();
  }

  function updateWeapon(dt) {
    const p = state.player;
    if (p.fireCooldown > 0) p.fireCooldown -= dt;
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        const def = WEAPONS[p.weapon];
        const need = def.mag - p.mag;
        const take = Math.min(need, p.reserve);
        p.mag += take;
        p.reserve -= take;
        p.reloading = 0;
      }
    }
    p.bloom = Math.max(0, p.bloom - dt * 6);
    // Recoil kick decays back to the player's true aim.
    if (p.recoilKick) p.recoilKick = Math.max(0, p.recoilKick - dt * 0.35);
  }

  function botShoot(bot, enemy) {
    const def = WEAPONS[bot.weaponId];
    const from = new THREE.Vector3(bot.x, 1.3, bot.z);
    const tx = enemy.x, tz = enemy.z;
    const dist = Math.hypot(tx - bot.x, tz - bot.z);
    const moving = enemy.isPlayer ? state.player.moving : (enemy.ref && enemy.ref.speed > 1);
    const crouching = enemy.isPlayer ? state.player.crouch : false;
    let pHit = BOT.baseHit * clamp(12 / Math.max(4, dist), 0.3, 1);
    if (moving) pHit *= 0.7;
    if (crouching) pHit *= 0.8;
    const hit = rng() < pHit;
    const isHead = hit && rng() < 0.08;
    let end;
    if (hit) {
      end = new THREE.Vector3(tx, isHead ? 1.56 : 1.1, tz);
      const dmg = def.damage * (isHead ? def.headMult : 1) * (dist > 30 ? 0.75 : 1);
      if (enemy.isPlayer) {
        applyDamageToPlayer(state, dmg, bot.name);
        audio.hurt();
        world.onPlayerHurt();
      } else if (enemy.ref) {
        damageBot(enemy.ref, dmg, bot.name, isHead, false);
      }
    } else {
      end = new THREE.Vector3(tx + range(rng, -1.4, 1.4), range(rng, 0.3, 1.8), tz + range(rng, -1.4, 1.4));
    }
    addTracer(from, end, bot.team === 'jackals' ? 0xff9a5a : 0x7ad9d9);
    if (enemy.isPlayer) audio.enemyShot(dist);
    else if (dist < 30) audio.enemyShot(dist * 1.6);
  }

  function throwGrenade() {
    const p = state.player;
    if (!p.alive || p.grenades <= 0) return false;
    p.grenades -= 1;
    camera.getWorldDirection(_dir);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6 }),
    );
    mesh.position.copy(camera.position);
    scene.add(mesh);
    state.grenades.push({
      mesh, x: camera.position.x, y: camera.position.y, z: camera.position.z,
      vx: _dir.x * 15, vy: _dir.y * 15 + 3.5, vz: _dir.z * 15,
      timer: 1.6,
    });
    audio.buy();
    return true;
  }

  function explode(g) {
    scene.remove(g.mesh);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.7 }),
    );
    flash.position.set(g.x, Math.max(0.4, g.y), g.z);
    scene.add(flash);
    state.tracers.push({ line: flash, life: 0.25, isFlash: true });
    audio.explosion();
    const radius = 7;
    const hurtAt = (x, z, y) => {
      const d = Math.hypot(x - g.x, z - g.z);
      if (d > radius) return;
      if (map.losBlocked(g.x, g.z, x, z) && d > 2) return;
      const dmg = Math.round(120 - (100 * d) / radius);
      return dmg;
    };
    const pd = hurtAt(state.player.x, state.player.z, 1.2);
    if (pd && state.player.alive) {
      applyDamageToPlayer(state, pd, 'Ember Frag');
      audio.hurt();
      world.onPlayerHurt();
    }
    for (const b of state.bots) {
      if (!b.alive) continue;
      const bd = hurtAt(b.x, b.z, 1.1);
      if (bd) damageBot(b, bd, 'You', false, true);
    }
    hearNoise(world, g.x, g.z, 40);
  }

  function updateGrenades(dt) {
    for (let i = state.grenades.length - 1; i >= 0; i--) {
      const g = state.grenades[i];
      g.timer -= dt;
      g.vy -= 18 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      const [rx, rz] = map.resolveCircle(g.x, g.z, 0.14);
      if (rx !== g.x || rz !== g.z) { g.vx *= -0.3; g.vz *= -0.3; g.x = rx; g.z = rz; }
      if (g.y < 0.14) { g.y = 0.14; g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; }
      g.mesh.position.set(g.x, g.y, g.z);
      if (g.timer <= 0) { explode(g); state.grenades.splice(i, 1); }
    }
  }

  function updatePlant(dt, keys) {
    const bomb = state.bomb;
    if (state.phase !== 'live') return;
    if ((bomb.state === 'carried' || bomb.state === 'planting') && state.player.alive) {
      let near = null;
      for (const [name, s] of Object.entries(map.sites)) {
        if (Math.hypot(state.player.x - s.x, state.player.z - s.z) < s.r) { near = name; break; }
      }
      if (near && keys.has('KeyE')) {
        bomb.state = 'planting';
        bomb.site = near;
        bomb.progress += dt;
        if (Math.floor(bomb.progress * 4) !== Math.floor((bomb.progress - dt) * 4)) audio.plantTick();
        if (bomb.progress >= 3) {
          world.onPlanted(near);
        }
      } else {
        bomb.progress = Math.max(0, bomb.progress - dt * 2);
        if (bomb.state === 'planting' && bomb.progress === 0) bomb.state = 'carried';
      }
    } else if (bomb.state === 'planted') {
      bomb.fuse -= dt;
      if (bomb.fuse <= 10 && Math.floor(bomb.fuse) !== Math.floor(bomb.fuse + dt)) audio.plantTick();
      if (bomb.fuse <= 0) {
        bomb.state = 'detonated';
        world.onDetonated();
      }
    }
  }

  return {
    firePlayer, startReload, updateWeapon, botShoot, throwGrenade,
    updateGrenades, updatePlant, updateTracers, damageBot,
  };
}
