import { HAKO_GATEWAY_URL, PAYBOX_CONFIG_DIR_ENV } from "@hako/config";
import { z } from "zod";

import { envLoader, optionalText, urlOr } from "./shared.js";

/**
 * apps/cli (`hako`, `hako mcp`). The CLI holds no Hako secret: PayBox's own config directory keeps the user's tokens
 * and paired key on the machine.
 */
export const cliEnvSchema = z.object({
  /** The gateway the CLI calls. Named HAKO_API_URL in the CLI since its first release; it is the gateway here. */
  HAKO_API_URL: urlOr(HAKO_GATEWAY_URL),
  /** Overrides where PayBox's CLI keeps its config (default ~/.config/hako/paybox). */
  [PAYBOX_CONFIG_DIR_ENV]: optionalText,
});
export type CliEnv = z.output<typeof cliEnvSchema>;

export const loadCliEnv = envLoader(cliEnvSchema, "cli");
