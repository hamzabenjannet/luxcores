// @ts-check
/**
 * Placeholder shapes for every entity that has no model yet: a glowing box in
 * the team color. Buildings, creeps and heroes use it until Hama's models and
 * the instanced rendering of M7 arrive. Cores and blockers have their own shapes
 * in scene.js and are skipped here. Shapes follow the entity list, so a built
 * collector appears and a recycled one disappears.
 */

import * as THREE from 'three';
import { KIND } from '../../sim/index.js';

/** Box height in tiles by kind; unlisted kinds use the default. Collectors sit low, towers stand tall. */
const HEIGHT = { [KIND.TOWER]: 1.4, [KIND.HERO]: 1.0, [KIND.CREEP]: 0.4 };
const DEFAULT_HEIGHT = 0.6;

/**
 * @param {THREE.Scene} scene
 * @param {number[]} teamColors 0xRRGGBB per team
 */
export function createEntityMeshes(scene, teamColors) {
  const box = new THREE.BoxGeometry(0.8, 1, 0.8);
  /** @type {THREE.MeshStandardMaterial[]} */
  const materials = teamColors.map((color) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1.4 }));
  /** @type {Map<number, THREE.Mesh>} */
  const byEntity = new Map();

  /** @param {readonly import('../../sim/state.js').Entity[]} entities */
  function update(entities) {
    const alive = new Set();
    for (const e of entities) {
      if (e.kind === KIND.CORE || e.kind === KIND.BLOCKER || e.team < 0) continue;
      alive.add(e.id);
      let mesh = byEntity.get(e.id);
      if (!mesh) {
        const height = HEIGHT[e.kind] ?? DEFAULT_HEIGHT;
        mesh = new THREE.Mesh(box, materials[e.team] ?? materials[0]);
        mesh.scale.y = height;
        scene.add(mesh);
        byEntity.set(e.id, mesh);
      }
      mesh.position.set(e.x / 1000, mesh.scale.y / 2, e.z / 1000);
    }
    for (const [id, mesh] of byEntity) {
      if (alive.has(id)) continue;
      scene.remove(mesh);
      byEntity.delete(id);
    }
  }

  return { update };
}
