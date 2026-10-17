/**
 * The proposal routes' one builder (`/v1/bridge`, `/v1/earn/deposit`, `/v1/earn/withdraw`), with R17, R16 and R15 from
 * @hako/networks and @hako/defi enforced here, server-side, before anything reaches the plugin:
 *   R17: the source chain must be executable (Base, Solana);
 *   R16: an ERC-20 whose allowance is short gets ONLY the exact-amount approve ("Step 1 of 2");
 *   R15: otherwise a fresh quote pinned to the reviewed tool is bound to the reviewed route (chains, sender, recipient,
 *        tokens, amount, tool, an allowlisted target) and its floor; a lower floor goes back for review.
 */
import { type proposalResponseSchema, solanaAddressSchema } from "@hako/cards/contract";
import { bindQuote, decodeBase64, planApproveSequence, r15RulesFor, r16RulesFor } from "@hako/defi/server";
import { sameAddress } from "@hako/money";
import { type EvmNetwork, isExecutableCaip2, isExecutableNetwork, type Network, NETWORK_KEYS, NETWORKS } from "@hako/networks";
import type { z } from "zod";

import { asAddress, readAllowance } from "./evm.js";
import { badRequest, unavailable } from "./http.js";
import { cardToken, freshQuote, knownNetwork, reviewedRoute, type RouteParams, routeData } from "./quotes.js";

export type ProposalResponse = z.output<typeof proposalResponseSchema>;

const EXECUTABLE_NAMES = NETWORK_KEYS.filter(isExecutableNetwork).map((key) => NETWORKS[key].name).join(" and ");

/** R17: only an executable network may be a source chain (everything else is read-only, with this reason). */
export function executableSource(caip2: string): Network {
  const network = knownNetwork(caip2);
  if (!isExecutableCaip2(network.caip2)) {
    throw badRequest("chain_not_executable", `${network.name} is read-only in Hako: money moves start on ${EXECUTABLE_NAMES}.`);
  }
  return network;
}

/** The sender must be a wallet of the source chain's family (the PayBox wallet passed as `use_plugin.wallet_id`). */
function requireEvmAddress(value: string, what: string) {
  const address = asAddress(value);
  if (!address) throw badRequest("invalid_address", `${what} must be a 0x address on an EVM chain.`);
  return address;
}

/** R16 on an EVM source: the exact approve when the allowance is short, else null (go on to the transfer). */
async function approveStep(network: EvmNetwork, params: RouteParams, spender: string | null, approvalReset: boolean | undefined) {
  const token = params.fromToken;
  const native = sameAddress(token, network.native.address);
  const owner = requireEvmAddress(params.fromAddress, "fromAddress");
  const tokenAddress = native ? null : requireEvmAddress(token, "The token being moved");
  const spenderAddress = spender ? asAddress(spender) : null;
  const allowanceAtomic = tokenAddress && spenderAddress ? await readAllowance(network, tokenAddress, owner, spenderAddress) : null;
  const rules = r16RulesFor(network.caip2);
  if (!rules) throw badRequest("chain_not_executable", `${network.name} has no approve rules.`);
  const plan = planApproveSequence(
    { chain: network.caip2, token, owner, spender, amountAtomic: params.fromAmountAtomic, allowanceAtomic, native, approvalReset },
    rules,
  );
  if (plan.step === "transfer") return null;
  if (plan.step === "refused") {
    if (plan.reason === "allowance_unknown") throw unavailable("allowance_unknown", `${plan.message} Try again in a moment.`);
    throw badRequest(`r16_${plan.reason}`, plan.message);
  }
  return { spender: plan.spender, amountAtomic: plan.amountAtomic, to: plan.proposal.to, data: plan.proposal.data };
}

/**
 * Builds the one proposal for a reviewed route: the exact approve, the R15-bound transfer, or the fresh quote for
 * review. `tool` pins the fresh quote (the race pick); without one, R15 binds the tool LI.FI picks now.
 */
export async function buildProposal(params: RouteParams, tool: string | undefined, reviewedMinAtomic: string): Promise<ProposalResponse> {
  const network = executableSource(params.fromChain);
  if (network.family === "solana" && !solanaAddressSchema.safeParse(params.fromAddress).success) {
    throw badRequest("invalid_address", "fromAddress must be the Solana wallet that signs.");
  }
  const fresh = await freshQuote(tool ? { ...params, tool } : params);
  const { quote, step } = fresh;

  if (network.family === "evm") {
    const approve = await approveStep(network, params, quote.approvalAddress, step.estimate.approvalReset);
    if (approve) {
      return {
        step: "approve",
        chain: network.caip2,
        token: cardToken(step.action.fromToken, network.caip2),
        spender: approve.spender,
        amountAtomic: approve.amountAtomic,
        tx: { chainId: network.chainId, to: approve.to, data: approve.data, value: "0" },
      };
    }
  }

  const rules = r15RulesFor(network.caip2);
  if (!rules) throw badRequest("chain_not_executable", `${network.name} has no binding rules.`);
  const bound = bindQuote(reviewedRoute(params, tool ?? quote.tool, reviewedMinAtomic), quote, rules);
  if (bound.status === "refused") throw badRequest(`r15_${bound.reason}`, bound.message);
  const route = routeData(fresh, null);
  if (bound.status === "review") return { step: "review", route, reason: bound.message };

  const proposal = bound.proposal;
  if (proposal.kind === "solana") {
    const bytes = decodeBase64(proposal.transactionBase64)?.length ?? 0;
    return { step: "transfer", route, tx: { transactionBase64: proposal.transactionBase64, signer: params.fromAddress, bytes } };
  }
  if (network.family !== "evm") throw badRequest("r15_tx_chain_mismatch", "The transaction is for a different chain family.");
  const gas = quote.transaction?.family === "evm" ? quote.transaction.gasLimit : null;
  return {
    step: "transfer",
    route,
    tx: { chainId: network.chainId, to: proposal.to, data: proposal.data, value: proposal.value, ...(gas ? { gas } : {}) },
  };
}

