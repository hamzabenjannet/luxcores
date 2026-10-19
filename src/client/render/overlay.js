// @ts-check
/**
 * Overlay: polylines with a dot at every waypoint (the selected group's route, a barracks
 * default path and the path being drawn), the build ghost and the ring of an ability aim.
 * Positions are tiles. The controls decide what to show; this module only draws it.
 */

import * as THREE from 'three';

const MAX_SEGMENTS = 128;
const MAX_DOTS = 128;
const HEIGHT = 0.15;
const GHOST_OK = 0x4cf3a0;
const GHOST_BAD = 0xff5a5a;

/** @param {THREE.Scene} scene */
export function createOverlay(scene) {
  const linePositions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  const lineColors = new Float32Array(MAX_SEGMENTS * 2 * 3);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  lineGeometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  scene.add(lines);

  const dotPositions = new Float32Array(MAX_DOTS * 3);
  const dotColors = new Float32Array(MAX_DOTS * 3);
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
  dotGeometry.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));
  dotGeometry.setDrawRange(0, 0);
  const dots = new THREE.Points(dotGeometry, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  dots.frustumCulled = false;
  dots.renderOrder = 6;
  scene.add(dots);

  // The build ghost: a translucent box on the chosen tile, green when the building can go there and red when not.
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.55, depthTest: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), ghostMaterial);
  ghost.visible = false;
  ghost.renderOrder = 4;
  scene.add(ghost);

  // The aim ring of a held ability: a flat ring on the ground under the finger.
  const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.visible = false;
  aimRing.renderOrder = 4;
  scene.add(aimRing);

  const color = new THREE.Color();

  /** @param {{ tileX: number, tileZ: number, valid: boolean } | null} g */
  function setGhost(g) {
    ghost.visible = g !== null;
    if (!g) return;
    ghost.position.set(g.tileX + 0.5, 0.3, g.tileZ + 0.5);
    ghostMaterial.color.setHex(g.valid ? GHOST_OK : GHOST_BAD);
  }

  /** @param {{ x: number, z: number } | null} point  tiles, or null for no ring */
  function setAim(point) {
    aimRing.visible = point !== null;
    if (point) aimRing.position.set(point.x, HEIGHT, point.z);
  }

  /** @param {{ points: number[][], color: number }[]} paths */
  function update(paths) {
    let segments = 0;
    let dotCount = 0;
    for (const path of paths) {
      color.set(path.color);
      path.points.forEach((p, i) => {
        if (dotCount < MAX_DOTS && i > 0) {
          dotPositions.set([p[0], HEIGHT, p[1]], dotCount * 3);
          dotColors.set([color.r, color.g, color.b], dotCount * 3);
          dotCount++;
        }
        if (i === 0 || segments >= MAX_SEGMENTS) return;
        const q = path.points[i - 1];
        linePositions.set([q[0], HEIGHT, q[1], p[0], HEIGHT, p[1]], segments * 6);
        lineColors.set([color.r, color.g, color.b, color.r, color.g, color.b], segments * 6);
        segments++;
      });
    }
    lineGeometry.setDrawRange(0, segments * 2);
    dotGeometry.setDrawRange(0, dotCount);
    for (const g of [lineGeometry, dotGeometry]) {
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
  }

  return { update, setGhost, setAim };
}
