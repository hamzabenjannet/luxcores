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
import { createLabels } from './labels.js';
import { pixelRatioFor } from './pixel-ratio.js';
import { createEntityMeshes } from './entity-meshes.js';
import { createOverlay } from './overlay.js';
import { clampZoom } from '../input/gestures.js';

export const TEAM_COLORS = [0x3d8bff, 0xff4d4d]; // team 0 blue (player), team 1 red

/** Viewport width in tiles at default zoom (GDD 10.1). */
const VIEW_TILES_WIDE = 32;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {any} mapgen raw data/mapgen.json (tile units)
 * @param {import('../../shared/world-view.js').WorldView} view
 * @param {{ core: number, default: number }} hpFactor raw data/balance.json hpFactor
 * @param {number} [viewerTeam] the camera starts at this team's Core
 * @param {readonly string[]} [heroNames] roster names in roster order, for the hero labels
 * @param {readonly string[]} [itemNames] item names by item id, for the item labels
 */
export function createScene(canvas, mapgen, view, hpFactor, viewerTeam = 0, heroNames = [], itemNames = []) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // The composer draws in several passes; counting over the whole frame needs a reset of our own.
  renderer.info.autoReset = false;
  const coarse = window.matchMedia('(pointer: coarse)');
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

  const labels = createLabels(scene, hpFactor, TEAM_COLORS, heroNames, itemNames);
  const entityMeshes = createEntityMeshes(scene, TEAM_COLORS);
  const overlay = createOverlay(scene);
  addGeneratedLayout(scene, view, labels);

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

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  // Camera: orthographic, isometric tilt, framing 32 tiles across.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  // Start framed on the viewer's 3 rows (Core row, build row, DMZ): z 48 to 112 for team 0, z 0 to 64 for team 1.
  // Team 0's base is at the bottom, team 1's at the top; the camera stays north-up for both.
  const target = new THREE.Vector3(corePos[viewerTeam][0], 0, viewerTeam === 0 ? 80 : 32);
  const OFFSET = new THREE.Vector3(0, 60, 42); // looking north, tilted
  let zoom = 1;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.4, 0.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /** Follows the window and the screen: a resize, or a move to a screen with another pixel density. */
  function resize() {
    const ratio = pixelRatioFor(window.devicePixelRatio, coarse.matches);
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2); // half-res bloom for mobile
    frameCamera();
  }

  /** Sizes the view from the canvas shape and the zoom: zoom 1 shows 32 tiles across. */
  function frameCamera() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const halfW = VIEW_TILES_WIDE / 2 / zoom;
    const halfH = halfW * (h / w);
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH; camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** @param {number} dxTiles @param {number} dzTiles */
  function pan(dxTiles, dzTiles) {
    following = false; // a drag takes the camera back from the hero
    target.x = Math.min(W, Math.max(0, target.x + dxTiles));
    target.z = Math.min(H, Math.max(0, target.z + dzTiles));
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let following = false;
  let lastTime = 0;

  function placeCamera() {
    camera.position.copy(target).add(OFFSET);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  /**
   * The ground point in tiles under a screen point. It aims from the camera's
   * current target, so a drag that pans between two frames stays exact.
   * @param {number} clientX @param {number} clientY
   * @returns {{ x: number, z: number } | null}
   */
  function groundAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    placeCamera();
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(groundPlane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  /**
   * Where a ground point (tiles) appears on screen, in client pixels. The e2e tests tap with it.
   * @param {number} x @param {number} z
   */
  function screenOf(x, z) {
    placeCamera();
    const p = new THREE.Vector3(x, 0, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /**
   * Draws one frame. `entities` is what to draw: the newest snapshot, or the interpolated one.
   * @param {number} timeSec
   * @param {readonly import('../../sim/state.js').Entity[]} [entities]
   */
  function render(timeSec, entities = view.entities()) {
    for (const c of cores) c.rotation.y = timeSec * 0.6;
    labels.update(entities);
    entityMeshes.update(entities);
    if (following) {
      const hero = entities.find((e) => e.kind === KIND.HERO && e.owner === viewerTeam && e.hp > 0);
      if (hero) {
        // Ease toward the hero, a little faster than it walks. The easing depends on the frame time, not on the frame count.
        const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, timeSec - lastTime)) * 8);
        target.x += (hero.x / 1000 - target.x) * k;
        target.z += (hero.z / 1000 - target.z) * k;
      }
    }
    lastTime = timeSec;
    placeCamera();
    renderer.info.reset();
    composer.render();
  }

  return {
    render, pan, groundAt, screenOf, setPaths: overlay.update, setGhost: overlay.setGhost, setAim: overlay.setAim, camera, renderer,
    /** The zoom factor; 1 shows 32 tiles across. */
    getZoom: () => zoom,
    /** Sets the zoom within the limits of `clampZoom`. @param {number} value */
    setZoom(value) {
      zoom = clampZoom(value);
      frameCamera();
    },
    /** Whether the camera follows the viewer's hero. Dragging the map turns it off. @param {boolean} on */
    setFollow(on) { following = on; },
    isFollowing: () => following,
    /** What the renderer drew in the last frame. */
    renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    /** Counts of drawn things, for the tests. */
    stats: () => entityMeshes.stats(),
  };
}

/**
 * Placeholder shapes for the generated layout, so the generator can be checked
 * by eye on a phone. Lane tiles form a faint strip, vents are cyan discs and item
 * spawns are amber rings. Blockers are entities and are drawn with the others, so
 * a destroyed blocker leaves the screen.
 * @param {THREE.Scene} scene
 * @param {import('../../shared/world-view.js').WorldView} view
 * @param {ReturnType<typeof createLabels>} labels
 */
function addGeneratedLayout(scene, view, labels) {
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
    labels.addMarker('Vent', v.tileX, v.tileZ, 0x2de2e6);
  }

  const ring = flat(new THREE.RingGeometry(0.3, 0.45, 16));
  const spawnMat = new THREE.MeshBasicMaterial({ color: 0xffc24d });
  for (const s of map.itemSpawns) {
    const mesh = new THREE.Mesh(ring, spawnMat);
    mesh.position.set(s.tileX + 0.5, 0.03, s.tileZ + 0.5);
    scene.add(mesh);
    labels.addMarker('Item Spawn', s.tileX, s.tileZ, 0xffc24d);
  }

}
