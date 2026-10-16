/**
 * Command types the sim understands (`t` in the `Command` typedef of
 * `src/sim/commands.js`). `test/command-types.spec.ts` fails when this list and
 * the sim drift apart.
 */
export const COMMAND_TYPES = [
  'build',
  'upgrade',
  'recycle',
  'cancelRecycle',
  'orderCreeps',
  'orderItem',
  'cancelQueue',
  'setBarracksPath',
  'setGroupPath',
  'mergeGroups',
  'splitGroup',
  'pickHero',
  'heroMove',
  'heroAttack',
  'castAbility',
  'useItem',
  'pickUp',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];
