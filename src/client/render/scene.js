// @ts-check
/**
 * Scene setup: orthographic isometric camera, map ground, glow pipeline.
 * World units in Three.js are tiles (sim units / 1000).
 *
 * MVP placeholder art: flat planes and emissive boxes until Hama's .glb
 * models arrive (load them with GLTFLoader from three/addons).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { KIND } from '../../sim/index.js';

export const TEAM_COLORS = [0x3d8bff, 0xff4d4d]; // team 0 blue (player), team 1 red

/** Viewport width in tiles at default zoom (GDD 10.1). */
const VIEW_TILES_WIDE = 32;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {any} mapgen raw data/mapgen.json (tile units)
 * @param {import('../world-view.js').WorldView} view
 */
export function createScene(canvas, mapgen, view) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // scene.background (sRGB-aware Color) instead of setClearColor: the clear
  // color is linear and the OutputPass would brighten it to grey.
  scene.background = new THREE.Color(0x05060a);
  const W = mapgen.width;
  const H = mapgen.height;

  // Ground: one plane per row band, tinted by role.
  const ROW_TINT = { core: 0x0d1220, build: 0x0a0f1a, dmz: 0x07080d };
  let z0 = 0;
  for (const row of mapgen.rows) {
    const geo = new THREE.PlaneGeometry(W, row.height);
    const mat = new THREE.MeshBasicMaterial({ color: ROW_TINT[row.name] ?? 0x0a0f1a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(W / 2, 0, z0 + row.height / 2);
    scene.add(mesh);
    z0 += row.height;
  }

  // Grid lines: tile grid faint, column and row borders brighter.
  const tilePts = [];
  for (let x = 0; x <= W; x++) tilePts.push(x, 0.01, 0, x, 0.01, H);
  for (let z = 0; z <= H; z++) tilePts.push(0, 0.01, z, W, 0.01, z);
  const tileGeo = new THREE.BufferGeometry();
  tileGeo.setAttribute('position', new THREE.Float32BufferAttribute(tilePts, 3));
  scene.add(new THREE.LineSegments(tileGeo, new THREE.LineBasicMaterial({ color: 0x141a28 })));

  const borderPts = [];
  for (let x = 0; x <= W; x += mapgen.columnWidth) borderPts.push(x, 0.02, 0, x, 0.02, H);
  z0 = 0;
  for (const row of mapgen.rows) {
    borderPts.push(0, 0.02, z0, W, 0.02, z0);
    z0 += row.height;
  }
  borderPts.push(0, 0.02, H, W, 0.02, H);
  const borderGeo = new THREE.BufferGeometry();
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
  scene.add(new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0x2a3550 })));

  addGeneratedLayout(scene, view);

  // Lumen Cores: team 0 from mapgen.json, team 1 point-mirrored.
  const c0 = mapgen.cores[0];
  const corePos = [
    [c0.tileX + 0.5, c0.tileZ + 0.5],
    [W - 1 - c0.tileX + 0.5, H - 1 - c0.tileZ + 0.5],
  ];
  /** @type {THREE.Mesh[]} */
  const cores = corePos.map(([x, z], team) => {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.2),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: TEAM_COLORS[team], emissiveIntensity: 2.2 }),
    );
    mesh.position.set(x, 1.4, z);
    scene.add(mesh);
    return mesh;
  });

  // Black hole: decorative (GDD 10).
  const bh = mapgen.blackHole;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.12, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xc9a7ff, emissiveIntensity: 1.6 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(bh.centerMilliTilesX / 1000, 0.6, bh.centerMilliTilesZ / 1000);
  scene.add(ring);
  const hole = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.position.copy(ring.position);
  scene.add(hole);

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  // Camera: orthographic, isometric tilt, framing 32 tiles across.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  // Start framed on the viewer's 3 rows (Core row, build row, DMZ): z 48 to 112.
  const target = new THREE.Vector3(corePos[0][0], 0, 80);
  const OFFSET = new THREE.Vector3(0, 60, 42); // looking north, tilted

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.4, 0.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2); // half-res bloom for mobile
    const halfW = VIEW_TILES_WIDE / 2;
    const halfH = halfW * (h / w);
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH; camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** @param {number} dxTiles @param {number} dzTiles */
  function pan(dxTiles, dzTiles) {
    target.x = Math.min(W, Math.max(0, target.x + dxTiles));
    target.z = Math.min(H, Math.max(0, target.z + dzTiles));
  }

  /** @param {number} timeSec */
  function render(timeSec) {
    for (const c of cores) c.rotation.y = timeSec * 0.6;
    ring.rotation.z = timeSec * 0.2;
    camera.position.copy(target).add(OFFSET);
    camera.lookAt(target);
    composer.render();
  }

  return { render, pan, camera, renderer, viewTilesWide: VIEW_TILES_WIDE };
}

/**
 * Placeholder shapes for the generated layout so the generator can be eyeballed
 * on a phone: lane tiles as a faint strip, vents as cyan discs, item spawns as
 * amber rings, blockers as grey boxes. Blockers are read once, so a destroyed
 * blocker stays on screen until M7 replaces this with instanced entity rendering.
 * @param {THREE.Scene} scene
 * @param {import('../world-view.js').WorldView} view
 */
function addGeneratedLayout(scene, view) {
  const map = view.map();
  const flat = (/** @type {THREE.BufferGeometry} */ g) => g.rotateX(-Math.PI / 2);

  const tiles = [...new Set(map.lanes.flatMap((l) => l.tiles))];
  const strip = new THREE.InstancedMesh(
    flat(new THREE.PlaneGeometry(1, 1)),
    new THREE.MeshBasicMaterial({ color: 0x1a2744 }),
    tiles.length,
  );
  const m = new THREE.Matrix4();
  tiles.forEach((i, n) => {
    strip.setMatrixAt(n, m.makeTranslation((i % map.width) + 0.5, 0.005, Math.floor(i / map.width) + 0.5));
  });
  scene.add(strip);

  const disc = flat(new THREE.CircleGeometry(0.4, 16));
  const ventMat = new THREE.MeshBasicMaterial({ color: 0x2de2e6 });
  for (const v of map.vents) {
    const mesh = new THREE.Mesh(disc, ventMat);
    mesh.position.set(v.tileX + 0.5, 0.03, v.tileZ + 0.5);
    scene.add(mesh);
  }

  const ring = flat(new THREE.RingGeometry(0.3, 0.45, 16));
  const spawnMat = new THREE.MeshBasicMaterial({ color: 0xffc24d });
  for (const s of map.itemSpawns) {
    const mesh = new THREE.Mesh(ring, spawnMat);
    mesh.position.set(s.tileX + 0.5, 0.03, s.tileZ + 0.5);
    scene.add(mesh);
  }

  const box = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const blockerMat = new THREE.MeshBasicMaterial({ color: 0x4a5060 });
  for (const e of view.entities()) {
    if (e.kind !== KIND.BLOCKER) continue;
    const mesh = new THREE.Mesh(box, blockerMat);
    mesh.position.set(e.x / 1000, 0.4, e.z / 1000);
    scene.add(mesh);
  }
}
