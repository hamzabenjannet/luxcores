// @ts-check
/**
 * Physics interface. Game logic talks to physics only through this shape,
 * so the MVP's Grid2DPhysics can later be swapped (for example for Rapier's
 * deterministic build) without touching systems.
 *
 * All values are integers in units (1 tile = 1000). Simulation happens on
 * the ground plane (x, z); height exists only in rendering.
 *
 * Physics state that affects gameplay must live in SimState (positions,
 * velocities, impulses) so snapshots and hashes cover it. The spatial hash
 * is a derived cache and can be rebuilt from state.
 *
 * @typedef {Object} PhysicsWorld
 * @property {(id:number, x:number, z:number, radius:number, mass:number, isStatic:boolean, shape?:'circle'|'square') => void} addBody
 * @property {(id:number) => void} removeBody
 * @property {(id:number, vx:number, vz:number) => void} setDesiredVelocity  units per tick
 * @property {(id:number, ix:number, iz:number) => void} applyImpulse         knockback
 * @property {() => void} step                                                one sim tick
 * @property {(id:number) => {x:number, z:number}} getPosition
 * @property {(x:number, z:number, r:number) => number[]} queryRadius         ids, ascending
 */

export {};
