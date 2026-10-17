// @hako/paybox/node: the entry for plain Node processes (the gateway, the CLI), which run outside React's server
// environment where the `server-only` guard would throw. Next code imports the package root instead.
export type * from "./intents/types.ts";
