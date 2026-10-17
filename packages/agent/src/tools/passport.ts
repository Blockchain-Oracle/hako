import { type CardAction, type CardFix, type PassportData, structuredContentSchema, type TokenAmount } from "@hako/cards/contract";
import { HAKO_MCP_SERVER_NAME } from "@hako/config";
import { sameAddress } from "@hako/money";
import { BASE, EVM_NATIVE_ADDRESS, SOLANA, SOLANA_NATIVE_ADDRESS } from "@hako/networks";
import { z } from "zod";

import { GAS_TOP_UP_SLIPPAGE_BPS, GAS_TOP_UP_USDC, GAS_TOP_UP_VALUE_CENTS } from "../agent.config.ts";
import { card, defineTool, MODEL_AND_APP, READ } from "../define.ts";
import type { PayboxAccount, PayboxWallet } from "../deps.ts";
import { atomicAmount, isPositiveAtomic, requireAccount } from "../resolve.ts";

/**
 * The agent passport (plan add-ons): the first card after Connect PayBox. Each granted wallet with its approval mode,
 * balances and gas readiness on the chains Hako executes on (R17: Base, Solana), the enabled plugins, and every red
 * item with its one fix. "Top up gas" is never a LI.FI proposal (its approve and swap need the gas it would buy): it is
 * offered as PayBox's own `request_swap` only when `check_operation_readiness` says it can run without native gas,
 * otherwise as "Add ETH" through MoonPay.
 */

type Issue = PassportData["issues"][number];

const issue = (text: string, fix: CardFix, action: CardAction): Issue => ({ text, fix, action });

/** Whether a wallet holds the native coin of its executable chain (gas for approve, transfer, deposit). */
function hasGas(wallet: PayboxWallet, holdings: readonly TokenAmount[]): boolean {
  const [chain, native] = wallet.family === "evm" ? [BASE.caip2, EVM_NATIVE_ADDRESS] : [SOLANA.caip2, SOLANA_NATIVE_ADDRESS];
  return holdings.some((held) => held.token.chain === chain && sameAddress(held.token.address, native) && isPositiveAtomic(held.amountAtomic));
}

async function gasIssue(account: PayboxAccount, wallet: PayboxWallet): Promise<Issue> {
  if (wallet.family === "solana") {
    const link = await account.buyLink({ credentialId: wallet.credentialId, chain: SOLANA.caip2 });
    return issue("No SOL for fees on Solana", "add_money", { type: "link", label: "Add SOL", url: link.url });
  }
  const usdc = { chain: BASE.caip2, address: BASE.usdc.address, symbol: BASE.usdc.symbol, decimals: BASE.usdc.decimals };
  const readiness = await account.readiness({
    type: "swap",
    credential_id: wallet.credentialId,
    src_chain: BASE.caip2,
    dst_chain: BASE.caip2,
    src_token: BASE.usdc.address,
    dst_token: "native",
    amount: atomicAmount(GAS_TOP_UP_USDC, usdc),
    swap_direction: "exact_in",
    slippage_bps: GAS_TOP_UP_SLIPPAGE_BPS,
    value_cents: GAS_TOP_UP_VALUE_CENTS,
  });
  if (readiness.canAttempt) {
    const prompt = `Swap ${GAS_TOP_UP_USDC} USDC to ETH on Base with PayBox (request_swap) so my wallet can pay gas`;
    return issue("No ETH on Base for gas", "top_up_gas", { type: "prompt", label: "Top up gas", prompt });
  }
  const link = await account.buyLink({ credentialId: wallet.credentialId, chain: BASE.caip2 });
  return issue("No ETH on Base for gas", "add_money", { type: "link", label: "Add ETH", url: link.url });
}

const MODE_WORDS: Record<PayboxWallet["approvalMode"], string> = {
  always_approve: "you approve each payment with your passkey",
  iframe: "you confirm each payment in PayBox's window",
  autonomous: "payments inside your grant run without asking",
  paybox: "PayBox decides per payment",
};

export const hakoPassport = defineTool({
  name: "hako_passport",
  title: "Agent passport",
  description:
    "What Hako can do with the connected PayBox right now: each shared wallet with its approval mode, balances and gas " +
    "readiness, the enabled PayBox plugins, and every problem with its one fix (raise a limit, top up gas, add funds). " +
    "Show it right after the person connects PayBox, or when a payment was blocked.",
  input: z.object({}),
  output: structuredContentSchema("passport"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["passport"],
  async execute(_input, deps) {
    const account = requireAccount(deps, "hako_passport");
    const [credentials, plugins] = await Promise.all([account.credentials(), account.enabledPlugins()]);
    const wallets = await Promise.all(
      credentials.wallets.map(async (wallet) => {
        const { holdings } = await account.portfolio(wallet.address);
        const gasReady = hasGas(wallet, holdings);
        return {
          credentialId: wallet.credentialId,
          name: wallet.name,
          family: wallet.family,
          address: wallet.address,
          mode: wallet.approvalMode,
          balances: [...holdings],
          gasReady,
          issues: gasReady ? [] : [await gasIssue(account, wallet)],
        };
      }),
    );
    const issues: Issue[] = [];
    if (wallets.length === 0) {
      const change = await account.accountChange("Share a wallet with Hako so it can pay for tools and move money.");
      issues.push(issue("No wallet is shared with Hako yet", "raise_limit", { type: "link", label: "Share a wallet", url: change.manageUrl }));
    }
    const hakoEnabled = plugins.some((plugin) => plugin.enabled && plugin.name?.toLowerCase() === HAKO_MCP_SERVER_NAME);
    const canDo = ["Find and inspect 80+ tools for free"];
    for (const wallet of wallets) canDo.push(`Pay for tools from ${wallet.name}: ${MODE_WORDS[wallet.mode]}`);
    if (wallets.some((wallet) => wallet.family === "evm" && wallet.gasReady)) canDo.push("Send, swap, bridge and earn from Base");
    if (wallets.some((wallet) => wallet.family === "solana" && wallet.gasReady)) canDo.push("Send and bridge from Solana");
    if (hakoEnabled) canDo.push("Run Hako's PayBox plugin in any PayBox host");
    const data: PassportData = {
      wallets,
      ungranted: [...credentials.ungranted],
      agentSignerRecorded: credentials.agentSignerRecorded,
      plugins: plugins.map((plugin) => ({ id: plugin.id, name: plugin.name, type: plugin.type, enabled: plugin.enabled })),
      hakoEnabled,
      canDo,
      issues,
    };
    return card("passport", data, { phase: "result" }, deps);
  },
});
