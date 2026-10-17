/**
 * The free read aliases (plan B13 "Reads"): `/v1/chain/*`, `/v1/markets`, `/v1/earn/vaults` and `/v1/earn/positions`
 * forward their body, checked against the endpoint table's schema, to the free catalog connector that answers it —
 * hako-api's `/v1/run/<provider>/<slug>` through `forwardRead`, the same path a catalog read takes. The one alias
 * table is the contract's `READ_ALIAS_CONNECTORS` (@hako/cards): ids are `<provider>/<slug>`, picked by the request's
 * chain family where a read differs between EVM and Solana. Only those fixed ids are ever forwarded.
 */
import { GATEWAY_ENDPOINTS, READ_ALIAS_CONNECTORS, type ReadAliasKey } from "@hako/cards/contract";
import type { Hono } from "hono";

import type { GatewayConfig } from "../config.js";
import { HTTP_BAD_GATEWAY, RUN_PREFIX } from "../constants.js";
import { forwardRead } from "../forward.js";
import { answer, badRequest, MoneyRouteError, readBody } from "./money/http.js";
import { knownNetwork } from "./money/quotes.js";

const ALIAS_KEYS = Object.keys(READ_ALIAS_CONNECTORS) as ReadAliasKey[];

/** The connector a read goes to: the only one, or the one for the chain's family (null: that family has no such read). */
function connectorFor(key: ReadAliasKey, body: { chain?: string }): string {
  const entry: { any?: string; evm?: string | null; solana?: string | null } = READ_ALIAS_CONNECTORS[key];
  if (entry.any) return entry.any;
  const network = knownNetwork(body.chain ?? "");
  const connector = entry[network.family];
  if (!connector) throw badRequest("unsupported_read", `${GATEWAY_ENDPOINTS[key].summary} isn't available on ${network.name}.`);
  return connector;
}

export function registerReadAliases(app: Hono, config: GatewayConfig): void {
  for (const key of ALIAS_KEYS) {
    const endpoint = GATEWAY_ENDPOINTS[key];
    app.post(endpoint.path, (c) =>
      answer(c, async () => {
        const body = (await readBody(c, endpoint.body)) as { chain?: string };
        const connector = connectorFor(key, body);
        let forwarded;
        try {
          forwarded = await forwardRead(config, "POST", `${RUN_PREFIX}/${connector}`, JSON.stringify(body));
        } catch (error) {
          console.error(JSON.stringify({ event: "read_alias_forward_failed", connector, error: String(error) }));
          throw new MoneyRouteError(HTTP_BAD_GATEWAY, "api_unreachable", "The tool router could not be reached.");
        }
        return new Response(forwarded.body, { status: forwarded.status, headers: { "content-type": forwarded.contentType } });
      }),
    );
  }
}
