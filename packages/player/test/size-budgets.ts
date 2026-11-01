/**
 * The most that a file may take after gzip, in bytes, for each file that a browser loads: the entry points of the browser
 * side as a bundler makes them, the runtime's engine that a client loads for practice on a device, and the static files that
 * `pnpm build` writes. Each is 1.25 times the size measured, rounded up to the next 500 bytes; docs/player/size.md lists
 * the sizes. A budget changes only with the reason in the commit that changes it.
 */
export const SIZE_BUDGETS = {
  /** `@assesskit/player`: the errors and the messages in both languages. */
  root: 14_500,
  /** `@assesskit/player/protocol`. */
  protocol: 7_500,
  /** `@assesskit/player/client`, without the engine that `createLocalSession` loads on demand. */
  client: 25_000,
  /** `@assesskit/player/player`. */
  player: 140_500,
  /** `mountItem` of `@assesskit/player/player`, with the code that it shares with `mountDelivery` and none of the chrome. */
  item: 107_500,
  /** `@assesskit/runtime/delivery`, which `createLocalSession` loads for practice on a device. */
  engine: 152_000,
  /** The script of the frame of a portable custom interaction. */
  bridge: 5_000,
  /** RequireJS, which the frame loads. */
  requirejs: 9_000,
  /** The script of the audio worklet. */
  worklet: 500,
  /** `player.css`. */
  stylesheet: 16_000,
} as const;
