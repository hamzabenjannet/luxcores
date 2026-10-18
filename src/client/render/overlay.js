// @ts-check
/**
 * Path overlay: polylines with a dot at every waypoint, for the selected group's
 * route, a barracks default path and the path being drawn. Positions are tiles.
 * The controls decide what to show; this module only draws it.
 */

import * as THREE from 'three';

const MAX_SEGMENTS = 128;
const MAX_DOTS = 128;
const HEIGHT = 0.15;

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

  const color = new THREE.Color();

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

  return { update };
}
