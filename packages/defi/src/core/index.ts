// @hako/defi/core: R15 binding, the R16 approve sequence and proposal shapes over plain objects (plan §2, §5b).
// No runtime imports at all: the PayBox plugin bundles this folder by relative path, and values it needs from
// @hako/config, @hako/networks and @hako/money arrive as parameters (`R15Rules`, `R16Rules`).
export * from "./types.ts";
export * from "./wire.config.ts";
export * from "./solana.ts";
export * from "./r15.ts";
export * from "./r16.ts";
