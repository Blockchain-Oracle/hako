/**
 * The `PayboxCaller` the money intents use on the server (src/intents/types.ts): PayBox core tools for one Hako user,
 * minted under that user's per-user client. `executeDraft` stores `clientId` on every execution row.
 */
import { sameAddress } from "@hako/money";
import { networkByCaip2 } from "@hako/networks";

import type { PayboxCaller } from "./intents/types.ts";
import type { PayboxTools } from "./tools.ts";

export interface ServerPayboxCaller extends PayboxCaller {
  /** Every typed PayBox tool for the same user and session (portfolio, links, plugins, readiness…). */
  readonly tools: PayboxTools;
}

export function createPayboxCaller(tools: PayboxTools, clientId: string): ServerPayboxCaller {
  return {
    clientId,
    tools,
    requestTransfer(args) {
      // `request_transfer` takes no token for the chain's native coin; the draft names it by its LI.FI address.
      const native = networkByCaip2(args.chain)?.native.address;
      return tools.requestTransfer({ ...args, token: native && sameAddress(args.token, native) ? null : args.token });
    },
    requestWalletSign: (args) => tools.requestWalletSign(args),
    useService: (args) => tools.useService(args),
    getRequest: (requestId) => tools.getRequest(requestId),
    listRequests: (filter) => tools.listRequests(filter),
  };
}
