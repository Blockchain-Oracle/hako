/**
 * LI.FI Earn (plan §1 A8): where a token earns most, an address's positions, and deposits and withdrawals as PayBox
 * proposals with the same approve-then-bound-transfer sequence as hako_bridge (R16, then R15). EVM only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { guarded, HakoError } from "../errors.js";
import { callAlias, callGateway } from "../gateway.js";
import { evmMoveOutputSchema, executableChain, proposeMove, reviewError } from "../proposals.js";
import { canonicalCaip2, networkByCaip2, type ReviewedRoute } from "../shared.js";
import { resolveToken } from "../tokens.js";
import { earnMoveRequestSchema, type EarnMoveRequest, type ProposalResponse } from "../wire/money.js";
import { earnPositionsRequestSchema, earnVaultsRequestSchema, runEnvelopeSchema } from "../wire/reads.js";
import { PROPOSES, READ_ONLY } from "./annotations.js";
import { envelopeResult, isRecord, rows } from "./envelope.js";

const moveInput = z
  .object({
    chain: earnMoveRequestSchema.shape.chain.describe("The vault's chain, CAIP-2 (eip155:8453 for Base)."),
    vault: earnMoveRequestSchema.shape.vault.describe("The vault address from hako_earn_vaults."),
    token: earnMoveRequestSchema.shape.token.describe('The underlying token: contract address or "USDC" / the native symbol.'),
    amountAtomic: earnMoveRequestSchema.shape.amountAtomic.describe("Deposit: underlying token units (1 USDC = 1000000). Withdraw: vault share units."),
    fromAddress: earnMoveRequestSchema.shape.fromAddress.describe("The PayBox wallet that signs (from list_credentials; the same wallet as use_plugin.wallet_id)."),
    minReceivedAtomic: earnMoveRequestSchema.shape.minReceivedAtomic.describe(
      'The least the person accepts (shares on deposit, tokens on withdraw). Pass "0" first to get the quote to review; nothing is proposed until a minimum is reviewed.',
    ),
    tool: earnMoveRequestSchema.shape.tool.describe(
      "The LI.FI tool of the reviewed quote. Leave it out the first time: the quote comes back for review with its tool.",
    ),
  })
  .strict();
type MoveInput = z.output<typeof moveInput>;

type Direction = "deposit" | "withdraw";

const percent = (value: unknown) => (typeof value === "number" ? `${value.toFixed(2)}%` : "?");

/** The reviewed Earn move as R15 binds it: a deposit swaps token → vault, a withdraw vault → token, back to the sender. */
function reviewedEarn(body: EarnMoveRequest, direction: Direction, tool: string): ReviewedRoute {
  const [fromToken, toToken] = direction === "deposit" ? [body.token, body.vault] : [body.vault, body.token];
  return {
    fromChain: body.chain,
    toChain: body.chain,
    fromToken,
    toToken,
    fromAmountAtomic: body.amountAtomic,
    fromAddress: body.fromAddress,
    toAddress: body.fromAddress,
    tool,
    toAmountMinAtomic: body.minReceivedAtomic,
  };
}

/**
 * The gateway's answer for an Earn move, checked like hako_bridge's (R16, then R15). R15 binds the tool the person
 * reviewed (`body.tool`, the input's); with none reviewed yet the quote goes back to the person with its tool and
 * minimum, the same way an unreviewed "0" minimum does, so a gateway-picked tool is never compared with itself.
 */
export function proposeEarnMove(body: EarnMoveRequest, direction: Direction, response: ProposalResponse) {
  const toolName = direction === "deposit" ? "hako_earn_deposit" : "hako_earn_withdraw";
  if (body.tool === undefined && response.step !== "approve") {
    throw reviewError(
      reviewedEarn(body, direction, response.route.tool),
      response.route,
      toolName,
      "No LI.FI tool was reviewed yet, so this quote goes to the person first.",
    );
  }
  // The approve step (R16) binds no tool; a transfer reaches here only with a reviewed one.
  return proposeMove(reviewedEarn(body, direction, body.tool ?? ""), response, toolName, direction === "deposit" ? "Deposit" : "Withdraw");
}

async function earnMove(input: MoveInput, direction: Direction) {
  const chain = executableChain(input.chain);
  if (networkByCaip2(chain)?.family !== "evm") throw new HakoError("chain_not_executable", "LI.FI Earn moves are EVM only (Base).");
  const body: EarnMoveRequest = { ...input, chain, token: resolveToken(chain, input.token) };
  const response = await callGateway(direction === "deposit" ? "earnDeposit" : "earnWithdraw", { body });
  return proposeEarnMove(body, direction, response);
}

export function registerEarnTools(server: McpServer) {
  server.registerTool(
    "hako_earn_vaults",
    {
      title: "Where a token earns most",
      description: "Free. LI.FI Earn vaults by APY or TVL, filtered by chain and underlying token (e.g. USDC on Base).",
      inputSchema: z
        .object({
          chain: earnVaultsRequestSchema.shape.chain,
          token: earnVaultsRequestSchema.shape.token.describe('Underlying token by symbol or address, e.g. "USDC".'),
          sort: earnVaultsRequestSchema.shape.sort.unwrap().optional(),
          limit: earnVaultsRequestSchema.shape.limit.unwrap().optional(),
        })
        .strict(),
      outputSchema: runEnvelopeSchema,
      annotations: READ_ONLY,
    },
    guarded(async (input) => {
      const body = { ...input, chain: input.chain ? (canonicalCaip2(input.chain) ?? input.chain) : undefined };
      const envelope = await callAlias("earnVaults", body);
      return envelopeResult(envelope, (data) =>
        rows(data, "vaults", (v) => {
          const token = isRecord(v.token) ? String(v.token.symbol) : "?";
          return `${String(v.name)} (${String(v.protocol)}, ${token}) ${percent(v.apy)} APY${typeof v.tvl_usd === "number" ? `, TVL $${Math.round(v.tvl_usd)}` : ""}: vault ${String(v.address)} on ${String(v.chain)}`;
        }),
      );
    }),
  );

  server.registerTool(
    "hako_earn_positions",
    {
      title: "Earn positions",
      description: "Free. An address's LI.FI Earn positions (vault, balance, value), optionally on one chain.",
      inputSchema: z
        .object({ address: earnPositionsRequestSchema.shape.address.describe("The wallet address (from list_credentials)."), chain: earnPositionsRequestSchema.shape.chain })
        .strict(),
      outputSchema: runEnvelopeSchema,
      annotations: READ_ONLY,
    },
    guarded(async (input) => {
      const body = { ...input, chain: input.chain ? (canonicalCaip2(input.chain) ?? input.chain) : undefined };
      return envelopeResult(await callAlias("earnPositions", body));
    }),
  );

  const moveDescription = (verb: string, what: string) =>
    `${verb} through LI.FI Earn as one PayBox proposal (one EVM call). ${what} When the allowance is short it returns ` +
    `only the exact-amount approve ("Step 1 of 2"): when that request reaches success, call again with the same input. ` +
    "Otherwise it returns the transaction from a fresh quote, refused unless chain, sender, tokens, amount and tool " +
    "match and the minimum received is at least the reviewed one; a lower or unreviewed minimum, or no reviewed tool, comes back for review.";

  server.registerTool(
    "hako_earn_deposit",
    {
      title: "Deposit into a vault with PayBox",
      description: moveDescription("Deposits a token into a vault", "Pick the vault with hako_earn_vaults."),
      inputSchema: moveInput,
      outputSchema: evmMoveOutputSchema,
      annotations: PROPOSES,
    },
    guarded(async (input) => earnMove(input, "deposit")),
  );

  server.registerTool(
    "hako_earn_withdraw",
    {
      title: "Withdraw from a vault with PayBox",
      description: moveDescription("Withdraws from a vault back to the underlying token", "See hako_earn_positions for the share balance."),
      inputSchema: moveInput,
      outputSchema: evmMoveOutputSchema,
      annotations: PROPOSES,
    },
    guarded(async (input) => earnMove(input, "withdraw")),
  );
}
