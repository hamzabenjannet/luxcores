// @ts-check
/**
 * Placeholder shapes for every entity that has no model yet: a glowing box in
 * the team color. Buildings, creeps and heroes use it until Hama's models and
 * the instanced rendering of M7 arrive. Cores and blockers have their own shapes
 * in scene.js and are skipped here. Shapes follow the entity list, so a built
 * collector appears and a recycled one disappears.
 *
 * Combat reads (M3): a tower carries a colored cap for its attack type. A
 * tower or hero with a target draws an aim line to it. Projectiles show as small
 * bright spheres halfway between source and target. They live for one tick and
 * snapshots arrive every second tick, so the aim line shows every shot.
 */

import * as THREE from 'three';
import { KIND } from '../../sim/index.js';

/** Box height in tiles by kind; unlisted kinds use the default. Collectors sit low, towers stand tall. */
const HEIGHT = { [KIND.TOWER]: 1.4, [KIND.HERO]: 1.0, [KIND.CREEP]: 0.4 };
const DEFAULT_HEIGHT = 0.6;
/** Cap color by tower attack code: melee orange, ranged cyan, area purple. */
const ATTACK_COLORS = /** @type {Record<number, number>} */ ({ 1: 0xff9f43, 2: 0x2de2e6, 3: 0xb26bff });
const MAX_AIM_LINES = 256;
/** Room in each instanced mesh. 30 creeps per player is the cap, so creeps never come near it. */
const MAX_INSTANCES = 512;

/** Ground items and loot bags are neutral and drawn as small gems. @param {number} kind */
function isLootKind(kind) {
  return kind === KIND.GROUND_ITEM || kind === KIND.LOOT_BAG;
}

/**
 * @param {THREE.Scene} scene
 * @param {number[]} teamColors 0xRRGGBB per team
 */
export function createEntityMeshes(scene, teamColors) {
  const box = new THREE.BoxGeometry(0.8, 1, 0.8);
  const capGeometry = new THREE.SphereGeometry(0.3, 10, 8);
  const shotGeometry = new THREE.SphereGeometry(0.22, 8, 6);
  const shotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const gemGeometry = new THREE.OctahedronGeometry(0.3);
  const groundItemMaterial = new THREE.MeshBasicMaterial({ color: 0xffc24d });
  const lootBagMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  const blockerMaterial = new THREE.MeshBasicMaterial({ color: 0x4a5060 });

  /** @type {THREE.MeshStandardMaterial[]} */
  const materials = teamColors.map((color) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1.4 }));
  /** @type {Map<number, THREE.Object3D>} */
  const byEntity = new Map();

  /**
   * Crowds are drawn in one call per kind and team: every creep of a team, every shot and every blocker
   * is an instance of one mesh, so 60 creeps cost two draw calls and not sixty.
   * @param {THREE.BufferGeometry} geometry @param {THREE.Material} material
   */
  const instancedMesh = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.count = 0;
    mesh.frustumCulled = false; // the bounding sphere of an instanced mesh would be that of its first instance
    scene.add(mesh);
    return mesh;
  };
  const creepMeshes = materials.map((material) => instancedMesh(box, material));
  const shotMesh = instancedMesh(shotGeometry, shotMaterial);
  const blockerMesh = instancedMesh(box, blockerMaterial);
  const matrix = new THREE.Matrix4();
  /** How many instances of each mesh this frame uses. */
  const used = new Map([...creepMeshes, shotMesh, blockerMesh].map((mesh) => [mesh, 0]));

  /**
   * Adds one instance at a position with a scale.
   * @param {THREE.InstancedMesh} mesh @param {number} x @param {number} y @param {number} z @param {number} sx @param {number} sy @param {number} sz
   */
  function addInstance(mesh, x, y, z, sx, sy, sz) {
    const n = used.get(mesh) ?? 0;
    if (n >= MAX_INSTANCES) return;
    mesh.setMatrixAt(n, matrix.makeScale(sx, sy, sz).setPosition(x, y, z));
    used.set(mesh, n + 1);
  }

  // One line buffer for every aim line, two vertices per line, colored per vertex.
  const aimPositions = new Float32Array(MAX_AIM_LINES * 2 * 3);
  const aimColors = new Float32Array(MAX_AIM_LINES * 2 * 3);
  const aimGeometry = new THREE.BufferGeometry();
  aimGeometry.setAttribute('position', new THREE.BufferAttribute(aimPositions, 3));
  aimGeometry.setAttribute('color', new THREE.BufferAttribute(aimColors, 3));
  aimGeometry.setDrawRange(0, 0);
  const aimLines = new THREE.LineSegments(aimGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
  aimLines.frustumCulled = false;
  scene.add(aimLines);
  const teamRgb = teamColors.map((c) => new THREE.Color(c));

  /** @param {import('../../sim/state.js').Entity} e */
  function createMesh(e) {
    if (isLootKind(e.kind)) return new THREE.Mesh(gemGeometry, e.kind === KIND.LOOT_BAG ? lootBagMaterial : groundItemMaterial);
    const height = HEIGHT[e.kind] ?? DEFAULT_HEIGHT;
    const mesh = new THREE.Mesh(box, materials[e.team] ?? materials[0]);
    mesh.scale.y = height;
    if (e.kind !== KIND.TOWER) return mesh;
    // The cap is a child, so it would stretch with the box. Wrap both in a group instead.
    const group = new THREE.Group();
    group.add(mesh);
    mesh.position.y = height / 2;
    const cap = new THREE.Mesh(capGeometry, new THREE.MeshBasicMaterial({ color: ATTACK_COLORS[e.attack] ?? 0xffffff }));
    cap.position.y = height + 0.25;
    group.add(cap);
    return group;
  }

  /** @param {readonly import('../../sim/state.js').Entity[]} entities */
  function update(entities) {
    const alive = new Set();
    /** @type {Map<number, import('../../sim/state.js').Entity>} */
    const byId = new Map();
    for (const e of entities) byId.set(e.id, e);

    for (const mesh of used.keys()) used.set(mesh, 0);
    for (const e of entities) {
      if (e.kind === KIND.CORE || (e.team < 0 && e.kind !== KIND.BLOCKER && !isLootKind(e.kind))) continue;
      if (e.kind === KIND.BLOCKER) {
        addInstance(blockerMesh, e.x / 1000, 0.4, e.z / 1000, 1, 0.8, 1);
        continue;
      }
      if (e.kind === KIND.CREEP) {
        addInstance(creepMeshes[e.team] ?? creepMeshes[0], e.x / 1000, HEIGHT[KIND.CREEP] / 2, e.z / 1000, 1, HEIGHT[KIND.CREEP], 1);
        continue;
      }
      if (e.kind === KIND.PROJECTILE) {
        const target = byId.get(e.targetId);
        addInstance(shotMesh, (target ? (e.x + target.x) / 2 : e.x) / 1000, 0.8, (target ? (e.z + target.z) / 2 : e.z) / 1000, 1, 1, 1);
        continue;
      }
      alive.add(e.id);
      let object = byEntity.get(e.id);
      if (!object) {
        object = createMesh(e);
        scene.add(object);
        byEntity.set(e.id, object);
      }
      if (e.kind === KIND.TOWER) {
        object.position.set(e.x / 1000, 0, e.z / 1000);
      } else if (isLootKind(e.kind)) {
        object.position.set(e.x / 1000, 0.5, e.z / 1000);
        object.rotation.y += 0.03;
      } else {
        object.position.set(e.x / 1000, object.scale.y / 2, e.z / 1000);
      }
    }
    for (const [id, object] of byEntity) {
      if (alive.has(id)) continue;
      scene.remove(object);
      byEntity.delete(id);
    }
    for (const [mesh, n] of used) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    updateAimLines(entities, byId);
  }

  /** How many things are drawn, for the tests: instances by kind, and the single meshes of other entities. */
  function stats() {
    return {
      creeps: creepMeshes.reduce((n, mesh) => n + mesh.count, 0),
      projectiles: shotMesh.count,
      blockers: blockerMesh.count,
      single: byEntity.size,
    };
  }

  /**
   * @param {readonly import('../../sim/state.js').Entity[]} entities
   * @param {Map<number, import('../../sim/state.js').Entity>} byId
   */
  function updateAimLines(entities, byId) {
    let n = 0;
    for (const e of entities) {
      if (e.targetId === 0 || (e.kind !== KIND.TOWER && e.kind !== KIND.HERO)) continue;
      const target = byId.get(e.targetId);
      if (!target || n >= MAX_AIM_LINES) continue;
      const color = teamRgb[e.team] ?? teamRgb[0];
      const i = n * 6;
      aimPositions.set([e.x / 1000, 0.9, e.z / 1000, target.x / 1000, 0.9, target.z / 1000], i);
      aimColors.set([color.r, color.g, color.b, color.r, color.g, color.b], i);
      n++;
    }
    aimGeometry.setDrawRange(0, n * 2);
    aimGeometry.attributes.position.needsUpdate = true;
    aimGeometry.attributes.color.needsUpdate = true;
  }

  return { update, stats };
}
