// @hako/env: typed environment, the only process.env reader for Hako's JS servers (plan §5b). Server-only: one zod
// schema per consumer (web server, gateway, CLI), each parsed lazily on first use. Next code imports this root; the
// gateway and the CLI import `@hako/env/node` (the same exports without the `server-only` guard).
import "server-only";

export * from "./node.js";
export * from "./web.js";
