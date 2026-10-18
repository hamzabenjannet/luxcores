// @ts-check
/**
 * Name labels under every entity and map marker. A label is a camera-facing
 * sprite that draws its text on a canvas. World units are tiles, like the
 * rest of the scene.
 *
 * Entities get their name and lux count (GDD 13.1 replaces glow-as-health with
 * a small lux count). A short tail marks tower types, upgrades, stuns and
 * recycling, and entity-text.js builds the text. Labels follow their entity and
 * appear or vanish as entities are created or destroyed.
 */

import * as THREE from 'three';
import { KIND } from '../../sim/index.js';
import { entityText } from '../entity-text.js';

/** Tiles between an entity's center and the center of its label, along z. */
const OFFSET_Z = { [KIND.CORE]: 1.9 };
const DEFAULT_OFFSET_Z = 1.2;

const CANVAS_W = 512;
const CANVAS_H = 128;
const SPRITE_W = 7.5; // tiles
const SPRITE_H = (SPRITE_W * CANVAS_H) / CANVAS_W;

/**
 * @param {string} text
 * @param {number} color CSS-independent 0xRRGGBB text color
 */
function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(SPRITE_W, SPRITE_H, 1);
  sprite.renderOrder = 10;

  let current = '';
  /** @param {string} next */
  function setText(next) {
    if (next === current) return;
    current = next;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = '600 64px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(5, 6, 10, 0.9)';
    ctx.strokeText(next, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillText(next, CANVAS_W / 2, CANVAS_H / 2);
    texture.needsUpdate = true;
  }
  setText(text);
  return { sprite, setText };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ core: number, default: number }} hpFactor
 * @param {number[]} teamColors 0xRRGGBB per team
 * @param {readonly string[]} [heroNames] roster names in roster order
 */
export function createLabels(scene, hpFactor, teamColors, heroNames = []) {
  /** @type {Map<number, ReturnType<typeof makeLabel>>} */
  const byEntity = new Map();

  /**
   * Static marker with a fixed name, such as a vent.
   * @param {string} name @param {number} tileX @param {number} tileZ @param {number} color
   */
  function addMarker(name, tileX, tileZ, color) {
    const label = makeLabel(name, color);
    label.sprite.position.set(tileX + 0.5, 0.3, tileZ + 0.5 + DEFAULT_OFFSET_Z);
    scene.add(label.sprite);
  }

  /** Sync labels with the entity list. Call once per rendered frame.
   * @param {readonly import('../../sim/state.js').Entity[]} entities */
  function update(entities) {
    const alive = new Set();
    for (const e of entities) {
      const text = entityText(e, hpFactor, heroNames);
      if (text === null) continue; // projectiles and other nameless kinds
      alive.add(e.id);
      let label = byEntity.get(e.id);
      if (!label) {
        const color = e.team >= 0 ? teamColors[e.team] ?? 0xb8c0d4 : 0xb8c0d4;
        label = makeLabel(text, color);
        scene.add(label.sprite);
        byEntity.set(e.id, label);
      }
      label.setText(text);
      label.sprite.position.set(e.x / 1000, 0.3, e.z / 1000 + (OFFSET_Z[e.kind] ?? DEFAULT_OFFSET_Z));
    }
    for (const [id, label] of byEntity) {
      if (alive.has(id)) continue;
      scene.remove(label.sprite);
      label.sprite.material.map?.dispose();
      label.sprite.material.dispose();
      byEntity.delete(id);
    }
  }

  return { addMarker, update };
}
