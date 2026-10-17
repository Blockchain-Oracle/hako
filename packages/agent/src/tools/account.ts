import {
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  activitySurfaceSchema,
  receiptKindSchema,
  receiptStatusSchema,
  structuredContentSchema,
  structuredContentUnion,
} from "@hako/cards/contract";
import { BASE } from "@hako/networks";
import { z } from "zod";

import { activityPage } from "../activity.ts";
import { ACCOUNT_CHANGE_NOTE_MAX_CHARS } from "../agent.config.ts";
import { card, defineTool, MODEL_AND_APP, READ } from "../define.ts";
import { chainInputSchema } from "../inputs.ts";
import { familyOf, requireAccount, requireUser, sumUsd, walletFor, walletRef } from "../resolve.ts";

/** The person's PayBox account in cards: balances, the activity ledger, funding and the limit. */

export const hakoPortfolio = defineTool({
  name: "hako_portfolio",
  title: "Balances",
  description:
    "What the connected PayBox wallets hold, every token with its exact amount and USD value where PayBox prices it. " +
    "Call it before saying anything about the person's money.",
  input: z.object({}),
  output: structuredContentSchema("portfolio"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["portfolio"],
  async execute(_input, deps) {
    const account = requireAccount(deps, "hako_portfolio");
    const { wallets } = await account.credentials();
    const reads = await Promise.all(wallets.map(async (wallet) => ({ wallet, ...(await account.portfolio(wallet.address)) })));
    const data = {
      wallets: wallets.map(walletRef),
      holdings: reads.flatMap((read) => read.holdings.map((amount) => ({ wallet: read.wallet.address, amount }))),
      // No wallet means nothing to add up: unknown, never a made-up $0.
      totalUsd: reads.length > 0 ? sumUsd(reads.map((read) => read.totalUsd)) : null,
      asOf: deps.now().toISOString(),
    };
    if (wallets.length > 0) return card("portfolio", data, { phase: "result" }, deps);
    const change = await account.accountChange("Share a wallet with Hako so it can show and move your money.");
    const blocked = {
      reason: "No wallet is shared with Hako in PayBox yet",
      fix: "raise_limit" as const,
      action: { type: "link" as const, label: "Share a wallet", url: change.manageUrl },
    };
    return card("portfolio", data, { phase: "result", blocked }, deps);
  },
});

export const hakoActivity = defineTool({
  name: "hako_activity",
  title: "Activity",
  description:
    "Everything Hako did with the person's PayBox, newest first: paid tools, sends, swaps, bridges, Earn moves and " +
    "invoices with their amount, status, time and explorer link, plus PayBox requests that stopped (declined, failed, " +
    "stopped at the limit) or still wait. Live rows are re-read from PayBox. Filter by kind, status, chain or surface; " +
    "pass the previous page's cursor for older rows.",
  input: z.object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(ACTIVITY_PAGE_MAX).default(ACTIVITY_PAGE_DEFAULT),
    kind: receiptKindSchema.optional().describe("Only this kind: run, batch, send, swap, bridge, earn_deposit, earn_withdraw, invoice, approve"),
    status: receiptStatusSchema.optional().describe("Only confirmed, reverted or pending rows"),
    chain: chainInputSchema.optional().describe("Only moves on this chain"),
    surface: activitySurfaceSchema.optional().describe("Only what was done from web, mcp, cli, plugin or voice"),
  }),
  output: structuredContentSchema("activity"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["activity"],
  async execute(input, deps) {
    requireUser(deps, "hako_activity");
    return card("activity", await activityPage(deps, input), { phase: "result" }, deps);
  },
});

export const hakoFund = defineTool({
  name: "hako_fund",
  title: "Add money or receive",
  description:
    "Ways to put money in the connected PayBox wallet: `buy` opens MoonPay's on-ramp (PayBox get_buy_link), `deposit` " +
    "PayBox's deposit page, `receive` shows the wallet's address and QR for someone to pay. Moves no money itself.",
  input: z.object({
    method: z.enum(["buy", "deposit", "receive"]).default("buy"),
    chain: chainInputSchema.optional().describe("Defaults to Base"),
    amountUsd: z.number().positive().optional().describe("Suggested amount in USD (buy and deposit)"),
  }),
  output: structuredContentUnion(["fund", "receive"]),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["fund", "receive"],
  async execute({ method, chain = BASE.caip2, amountUsd }, deps) {
    const account = requireAccount(deps, "hako_fund");
    const wallet = await walletFor(account, familyOf(chain));
    const ref = walletRef(wallet);
    if (method === "receive") {
      const usdc = chain === BASE.caip2 ? { chain, address: BASE.usdc.address, symbol: BASE.usdc.symbol, decimals: BASE.usdc.decimals } : null;
      return card("receive", { wallet: ref, chain, token: usdc, qrPayload: wallet.address }, { phase: "result" }, deps);
    }
    const amount = amountUsd === undefined ? {} : { amountUsd };
    if (method === "buy") {
      const link = await account.buyLink({ credentialId: wallet.credentialId, chain, ...amount });
      const buy = { url: link.url, currencyCode: link.currencyCode, network: link.chain };
      return card("fund", { wallet: ref, chain, buy, deposit: null, qrPayload: link.url }, { phase: "ready" }, deps);
    }
    const link = await account.depositLink({ credentialId: wallet.credentialId, ...amount });
    const deposit = { url: link.url, expiresAt: link.expiresAt, amountUsd: link.amountUsd };
    return card("fund", { wallet: ref, chain, buy: null, deposit, qrPayload: link.url }, { phase: "ready" }, deps);
  },
});

export const hakoLimit = defineTool({
  name: "hako_limit",
  title: "Raise my limit",
  description:
    "When PayBox stopped an action at the person's limit or a wallet isn't shared: returns PayBox's own page where the " +
    "person changes it themselves (request_account_change). Hako never changes limits.",
  input: z.object({ note: z.string().min(1).max(ACCOUNT_CHANGE_NOTE_MAX_CHARS).optional().describe("One short sentence shown to the person") }),
  output: structuredContentSchema("limit"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["limit"],
  async execute({ note }, deps) {
    const change = await requireAccount(deps, "hako_limit").accountChange(note);
    return card("limit", { manageUrl: change.manageUrl, note: change.note }, { phase: "ready" }, deps);
  },
});
