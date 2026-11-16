// Player movement: acceleration, friction, crouch, circle-vs-AABB collision.
// Pure function of (player, input, map, dt) — no rendering, no DOM.
import { PLAYER } from './config.js';
import { clamp } from './rng.js';

export function createInputState() {
  return {
    forward: false, back: false, left: false, right: false,
    crouch: false, fire: false, jump: false,
  };
}

// keys: a Set of currently-down codes, read by main.js each frame.
export function updatePlayer(player, keys, map, dt) {
  if (!player.alive) return;
  const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  player.crouch = crouch;
  const maxSpeed = crouch ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  // Forward on the ground plane is (-sin(yaw), -cos(yaw)) for a Y-up camera.
  let wx = (-sin) * fwd + cos * strafe;
  let wz = (-cos) * fwd - sin * strafe;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  player.vx += wx * PLAYER.accel * dt;
  player.vz += wz * PLAYER.accel * dt;
  // Friction when no input, and a hard cap so speed never runs away.
  const speed = Math.hypot(player.vx, player.vz);
  if (len === 0 && speed > 0) {
    const drop = Math.max(0, speed - PLAYER.friction * speed * dt);
    player.vx *= drop / speed;
    player.vz *= drop / speed;
  }
  const capped = Math.min(Math.hypot(player.vx, player.vz), maxSpeed);
  if (speed > 0.001) {
    const s = capped / Math.hypot(player.vx, player.vz);
    player.vx *= s; player.vz *= s;
  }
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  const [rx, rz] = map.resolveCircle(player.x, player.z, PLAYER.radius);
  player.x = rx; player.z = rz;
  player.speed = Math.hypot(player.vx, player.vz);
  player.moving = player.speed > 0.6;
  player.eyeHeight = player.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
}

export function eyeHeight(player) {
  return player.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
}

export function applyRecoil(player, amount) {
  player.pitch = clamp(player.pitch + amount, -1.45, 1.45);
}
