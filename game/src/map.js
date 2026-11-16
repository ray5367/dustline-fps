// Cinder Yard — an original desert-industrial map: two plant sites (A north-east,
// B south-east), a mid lane, a long north corridor and a south depot lane.
// Builds every mesh, the AABB colliders, the waypoint graph bots walk, and the
// 2D line-of-sight / collision helpers. Palette: sand, ochre, rust, teal accent.
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x3a4a5c,
  ground: 0xb59a6b,
  groundDark: 0x8f7a52,
  wall: 0xc9a86a,
  wallDark: 0x9c7f4e,
  rust: 0x9a4a2e,
  rustDark: 0x6e331f,
  teal: 0x2e8b8b,
  amber: 0xe8a33d,
  crate: 0x7a5c33,
  container: 0x4a6b7a,
  container2: 0x7a4a3a,
};

// Each solid: x0,z0,x1,z1 in metres, h height, y base 0, mat key, top = walkable roof?
const SOLIDS = [
  // perimeter (h 4)
  [-33, -23, 33, -22, 4, 'wall'], [-33, 22, 33, 23, 4, 'wall'],
  [-33, -23, -32, 23, 4, 'wall'], [32, -23, 33, 23, 4, 'wall'],
  // mid divider wall with two gaps (north gap z -8..-4, south gap z 4..8)
  [-2, -22, 0, -8, 3.2, 'wallDark'], [-2, -4, 0, 4, 3.2, 'wallDark'], [-2, 8, 0, 22, 3.2, 'wallDark'],
  // long north corridor walls
  [-14, -18, -12, -8, 3, 'wall'], [10, -18, 12, -8, 3, 'wall'],
  // site A enclosure (NE)
  [18, -20, 30, -18, 3, 'rust'], [18, -20, 20, -10, 3, 'rust'],
  [26, -16, 30, -8, 2.6, 'wallDark'],
  // site B enclosure (SE)
  [18, 18, 30, 20, 3, 'rust'], [18, 10, 20, 20, 3, 'rust'],
  [26, 8, 30, 16, 2.6, 'wallDark'],
  // spawn cover walls (west)
  [-26, -12, -24, -6, 2.8, 'wallDark'], [-26, 6, -24, 12, 2.8, 'wallDark'],
  // central crates (low, h 1.1 — crouch cover, block movement, not sight over)
  [-6, -2, -3, 1, 1.1, 'crate'], [4, -1, 7, 2, 1.1, 'crate'],
  [-8, 12, -5, 15, 1.1, 'crate'], [8, -15, 11, -12, 1.1, 'crate'],
  // tall crates (block sight)
  [-12, -6, -9, -3, 2.4, 'crate'], [12, 3, 15, 6, 2.4, 'crate'],
  [-4, 16, -1, 19, 2.4, 'crate'], [2, -19, 5, -16, 2.4, 'crate'],
  // containers (h 2.6)
  [-20, -16, -14, -13, 2.6, 'container'], [-20, 13, -14, 16, 2.6, 'container2'],
  [14, -6, 20, -3, 2.6, 'container'], [14, 3, 20, 6, 2.6, 'container2'],
  // mid pillars
  [-1, -12, 1, -10, 3.4, 'rustDark'], [-1, 10, 1, 12, 3.4, 'rustDark'],
];

export const WAYPOINTS = [
  // id: [x, z] — spawn west, mid, long north, long south, A, B
  [-29, 0], [-22, -8], [-22, 8], [-14, 0], [-8, -12], [-8, 12], // 0..5
  [-1, -6], [-1, 6], [-1, -14], [-1, 14], // 6..9 mid crossings
  [6, -14], [6, 14], [6, 0], // 10..12
  [13, -12], [13, 12], [13, 0], // 13..15
  [22, -14], [22, 14], [24, -4], [24, 4], // 16..19 sites + east lane
  [-18, -6], [-18, 6], [8, -20], [8, 20], // 20..23 flanks
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6], [3, 7], [4, 8], [5, 9],
  [6, 8], [6, 12], [7, 9], [7, 12], [8, 10], [9, 11], [10, 22], [11, 23],
  [12, 13], [12, 14], [12, 15], [13, 15], [14, 15], [15, 18], [15, 19],
  [16, 18], [17, 19], [18, 19], [1, 20], [2, 21], [20, 6], [21, 7],
  [22, 19], [4, 20], [5, 21],
];

export function createMap(scene) {
  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    groundDark: new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 }),
    wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.85 }),
    rustDark: new THREE.MeshStandardMaterial({ color: PALETTE.rustDark, roughness: 0.85 }),
    teal: new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.7, emissive: 0x0e3a3a }),
    amber: new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.6, emissive: 0x4a2c00 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9 }),
    container: new THREE.MeshStandardMaterial({ color: PALETTE.container, roughness: 0.8, metalness: 0.3 }),
    container2: new THREE.MeshStandardMaterial({ color: PALETTE.container2, roughness: 0.8, metalness: 0.3 }),
  };

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 38, 110);

  const hemi = new THREE.HemisphereLight(0xcfd8e6, 0x8a6f45, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
  sun.position.set(18, 30, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  scene.add(sun);
  // Cool fill from the west so west-facing walls are not black.
  const fill = new THREE.DirectionalLight(0xbcccdc, 0.9);
  fill.position.set(-20, 18, -12);
  scene.add(fill);

  // ground: big slab + darker lane strips so lanes read at a glance
  const ground = new THREE.Mesh(new THREE.BoxGeometry(68, 0.2, 48), mats.ground);
  ground.position.set(0, -0.1, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  const shootables = [ground];
  const laneGeo = new THREE.BoxGeometry(64, 0.06, 3.2);
  for (const z of [-14, 0, 14]) {
    const lane = new THREE.Mesh(laneGeo, mats.groundDark);
    lane.position.set(0, 0.03, z);
    lane.receiveShadow = true;
    scene.add(lane);
  }

  const colliders = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [x0, z0, x1, z1, h, key] of SOLIDS) {
    const w = x1 - x0, d = z1 - z0;
    const mesh = new THREE.Mesh(boxGeo, mats[key]);
    mesh.scale.set(w, h, d);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
    colliders.push({ x0, z0, x1, z1, h });
  }

  // site zones: glowing ground rings + marker poles + floating letter blocks
  const sites = {
    A: { x: 24, z: -14, r: 4.5 },
    B: { x: 24, z: 14, r: 4.5 },
  };
  for (const [name, s] of Object.entries(sites)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.35, s.r, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.06, s.z);
    scene.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(s.r, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(s.x, 0.05, s.z);
    scene.add(disc);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5, 0.25), mats.teal);
    pole.position.set(s.x + s.r + 0.6, 2.5, s.z);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.08), mats.amber);
    flag.position.set(s.x + s.r + 1.4, 4.4, s.z);
    scene.add(flag);
  }

  // scattered barrels (visual only, small colliders added)
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  const barrelSpots = [[-10, -16], [16, -10], [-16, 18], [28, 0], [0, -20], [-28, -18]];
  for (const [x, z] of barrelSpots) {
    const b = new THREE.Mesh(barrelGeo, mats.rustDark);
    b.position.set(x, 0.55, z);
    b.castShadow = true;
    scene.add(b);
    colliders.push({ x0: x - 0.45, z0: z - 0.45, x1: x + 0.45, z1: z + 0.45, h: 1.1 });
  }

  // waypoint graph (adjacency)
  const adj = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) { adj[a].push(b); adj[b].push(a); }

  function bfsPath(from, to) {
    if (from === to) return [from];
    const prev = new Array(WAYPOINTS.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const n of adj[cur]) {
        if (prev[n] === -1) { prev[n] = cur; if (n === to) { queue.length = 0; break; } queue.push(n); }
      }
    }
    if (prev[to] === -1) return [to];
    const path = [to];
    let c = to;
    while (c !== from) { c = prev[c]; path.unshift(c); }
    return path;
  }

  function nearestWaypoint(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i++) {
      const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Circle (player/bot) vs AABB push-out. Returns corrected [x, z].
  function resolveCircle(x, z, r) {
    for (const c of colliders) {
      const cx = Math.max(c.x0, Math.min(x, c.x1));
      const cz = Math.max(c.z0, Math.min(z, c.z1));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // centre inside the box: push out along the smallest penetration axis
          const pl = x - c.x0 + r, pr = c.x1 - x + r, pt = z - c.z0 + r, pb = c.z1 - z + r;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
          else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
        }
      }
    }
    x = Math.max(-31.5, Math.min(31.5, x));
    z = Math.max(-21.5, Math.min(21.5, z));
    return [x, z];
  }

  // 2D segment vs AABB test, only for walls taller than eye height.
  function segmentHitsBox(x1, z1, x2, z2, b) {
    const dx = x2 - x1, dz = z2 - z1;
    let tmin = 0, tmax = 1;
    for (const [p, d, lo, hi] of [[x1, dx, b.x0, b.x1], [z1, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
      else {
        let t1 = (lo - p) / d, t2 = (hi - p) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  function losBlocked(x1, z1, x2, z2) {
    for (const c of colliders) {
      if (c.h < 1.35) continue;
      if (segmentHitsBox(x1, z1, x2, z2, c)) return true;
    }
    return false;
  }

  return {
    colliders, sites, adj, shootables, waypoints: WAYPOINTS,
    spawns: {
      vultures: [[-29, -4], [-29, -1], [-29, 2], [-29, 5], [-27, 0]],
      jackals: [[29, -4], [29, -1], [29, 2], [29, 5], [27, 0]],
    },
    bfsPath, nearestWaypoint, resolveCircle, losBlocked,
  };
}
