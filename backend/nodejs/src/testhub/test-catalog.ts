/**
 * What the test hub lists: the pages of the game that take URL parameters, ready-made links for the usual
 * checks, and the API and file links around them. One list serves `GET /api/dev/links` (and so Swagger)
 * and the page at `/tests`. A unit test keeps every preset to parameters that its page documents.
 */

export type ParamKind = 'text' | 'number' | 'flag';

export interface ParamDoc {
  name: string;
  label: string;
  kind: ParamKind;
  help: string;
  /** What the page uses when the parameter is absent, or a suggestion to start from. */
  default?: string;
}

export interface PageDoc {
  id: string;
  title: string;
  description: string;
  /** Path of the page, without the query. */
  path: string;
  params: ParamDoc[];
}

export interface PresetDoc {
  id: string;
  group: string;
  title: string;
  description: string;
  /** The page's id in `PAGES`, so the link can be checked against its parameters. */
  page: string;
  /** Path and query, starting at `/`. */
  path: string;
}

export interface LinkDoc {
  group: string;
  title: string;
  description: string;
  path: string;
}

export const PAGES: PageDoc[] = [
  {
    id: 'game',
    title: 'The game',
    description: 'The web client. Any of match, vsBot, botVsBot or autostart skips the start menu.',
    path: '/',
    params: [
      { name: 'name', label: 'Name', kind: 'text', default: 'Tester', help: 'Guest name, used for a new guest only' },
      { name: 'match', label: 'Match', kind: 'text', default: 'new', help: 'new, or the id of a lobby to join' },
      { name: 'vsBot', label: 'Play against a bot', kind: 'flag', help: 'With match=new: fill the second slot with a bot' },
      { name: 'botVsBot', label: 'Watch two bots', kind: 'flag', help: 'With match=new: two bots play and the page only watches' },
      { name: 'seed', label: 'Map seed', kind: 'number', help: 'With match=new: the map and RNG seed' },
      { name: 'maxTicks', label: 'Tick limit', kind: 'number', help: '0 for unlimited; a number caps the match at that tick (20 ticks per second)' },
      { name: 'entropy', label: 'Entropy % per second', kind: 'text', help: 'With match=new: 0 to 100 with one decimal, such as 0.5' },
      { name: 'autostart', label: 'Start at once', kind: 'flag', help: 'Start the match as soon as the lobby exists' },
      { name: 'perf', label: 'Frame meter', kind: 'flag', help: 'Show fps, frame times, draw calls and entities in a corner' },
      { name: 'test', label: 'Test hooks', kind: 'flag', help: 'Expose window.__luxTest, which the browser tests use' },
      { name: 'showcode', label: 'Show recovery code', kind: 'flag', help: 'Print a new recovery code in the debug text' },
      { name: 'recover', label: 'Recovery code', kind: 'text', help: 'Move a profile to this device' },
      { name: 'server', label: 'Server', kind: 'text', help: 'Backend origin to play on; the page\'s own origin by default' },
    ],
  },
  {
    id: 'determinism',
    title: 'Determinism',
    description: 'Plays the sim in this browser and prints the state hash, to compare with Node (milestone M10).',
    path: '/determinism.html',
    params: [
      { name: 'suite', label: 'Golden replays', kind: 'flag', help: 'Play every golden replay and compare each hash: one PASS or FAIL for a phone' },
      { name: 'seed', label: 'Seed', kind: 'number', default: '1234567', help: 'Single run: the map seed' },
      { name: 'ticks', label: 'Ticks', kind: 'number', default: '2400', help: 'Single run: how long to play' },
      { name: 'bots', label: 'Two bots play', kind: 'flag', help: 'Single run: without it nobody sends commands' },
    ],
  },
];

export const PRESETS: PresetDoc[] = [
  { id: 'play-bot', group: 'Play', page: 'game', title: 'Play against the bot', description: 'An unlimited match that starts at once', path: '/?name=Tester&match=new&vsBot=1&maxTicks=0&autostart=1' },
  { id: 'play-bot-perf', group: 'Play', page: 'game', title: 'Play against the bot with the frame meter', description: 'The same match with the performance numbers on screen', path: '/?name=Tester&match=new&vsBot=1&maxTicks=0&autostart=1&perf=1' },
  { id: 'play-short', group: 'Play', page: 'game', title: 'A 30 second match', description: 'Capped at 600 ticks, so it ends in a draw quickly', path: '/?name=Tester&match=new&vsBot=1&maxTicks=600&autostart=1' },
  { id: 'play-entropy', group: 'Play', page: 'game', title: 'Fast entropy', description: 'Buildings and units lose 5 percent of their HP every second', path: '/?name=Tester&match=new&vsBot=1&maxTicks=0&entropy=5&autostart=1' },
  { id: 'host', group: 'Play', page: 'game', title: 'Host a match for two', description: 'Opens a lobby; send the match id to the second player', path: '/?name=Host&match=new' },
  { id: 'watch-bots', group: 'Watch', page: 'game', title: 'Watch two bots (seed 777)', description: 'A bot-versus-bot match with no tapping', path: '/?name=Watcher&match=new&botVsBot=1&seed=777&maxTicks=0&autostart=1' },
  { id: 'watch-stress', group: 'Watch', page: 'game', title: 'Stress: two bots with the frame meter', description: 'Seed 4 runs long and fields many creeps (the performance check)', path: '/?name=Watcher&match=new&botVsBot=1&seed=4&maxTicks=0&autostart=1&perf=1' },
  { id: 'determinism-suite', group: 'Determinism', page: 'determinism', title: 'Determinism suite (for phones)', description: 'Plays all golden replays and shows PASS or the first tick that differs', path: '/determinism.html?suite=1' },
  { id: 'determinism-idle', group: 'Determinism', page: 'determinism', title: 'Idle sim, 120 ticks', description: 'The hash Node prints for seed 1234567 at tick 120', path: '/determinism.html?seed=1234567&ticks=120' },
  { id: 'determinism-bots', group: 'Determinism', page: 'determinism', title: 'Two bots, seed 777, 1200 ticks', description: 'The hash Node prints for the bot run', path: '/determinism.html?seed=777&ticks=1200&bots=1' },
];

/** Links that are not pages with parameters. The golden replays are added from the directory. */
export const LINKS: LinkDoc[] = [
  { group: 'API', title: 'API docs (Swagger)', description: 'Every route, with the try-it-out buttons', path: '/api/docs' },
  { group: 'API', title: 'OpenAPI document', description: 'The raw JSON of the docs', path: '/api/docs-json' },
  { group: 'API', title: 'Health', description: 'Liveness, database state and event bus mode', path: '/api/health' },
  { group: 'API', title: 'Game spec', description: 'Spec version, data hash, entity kinds and the socket reference', path: '/api/game/spec' },
  { group: 'API', title: 'Map of seed 1234567', description: 'The generated map layout as JSON', path: '/api/game/maps/1234567' },
];
