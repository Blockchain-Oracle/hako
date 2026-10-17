import { CONTACT_NAME_MAX_CHARS, evmAddressSchema, PAYBOX_USERNAME_MAX_CHARS, solanaAddressSchema, structuredContentSchema } from "@hako/cards/contract";
import { BASE } from "@hako/networks";
import { z } from "zod";

import { card, defineTool, MODEL_AND_APP } from "../define.ts";
import type { AgentDeps, ContactBook, NewContact } from "../deps.ts";
import { AgentToolError, authRequired, invalidInput } from "../errors.ts";
import { chainInputSchema } from "../inputs.ts";
import { familyOf, requireUser } from "../resolve.ts";

/**
 * Contacts (plan D25, J9: "save tobi.paybox as Tobi" → "send Tobi 0.10 USDC"): a saved name for an address or a
 * PayBox username, so a send can name a person. Verified by QR on the card; a new contact starts unverified.
 */

const nameSchema = z.string().trim().min(1).max(CONTACT_NAME_MAX_CHARS);

const contactsInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("add"),
    name: nameSchema.describe("What the person calls them, e.g. Tobi"),
    address: z.string().min(1).optional().describe("Their wallet address"),
    username: z.string().min(1).max(PAYBOX_USERNAME_MAX_CHARS).optional().describe("Their PayBox username, e.g. tobi.paybox"),
    chain: chainInputSchema.optional().describe("Which family the address is for when a username has both; Base (EVM) by default"),
  }),
  z.object({ action: z.literal("rename"), id: z.string().min(1), name: nameSchema }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
  z.object({ action: z.literal("resolve"), query: z.string().min(1).describe("A saved name or PayBox username") }),
]);

function contactBook(deps: AgentDeps): ContactBook {
  requireUser(deps, "hako_contacts");
  if (!deps.contacts) throw authRequired("hako_contacts");
  return deps.contacts;
}

/** A new contact from an address, or from a PayBox username resolved to the address for the chosen family. */
async function newContact(deps: AgentDeps, input: { name: string; address?: string; username?: string; chain?: `${string}:${string}` }): Promise<NewContact> {
  if (input.address) {
    const family = evmAddressSchema.safeParse(input.address).success ? "evm" : solanaAddressSchema.safeParse(input.address).success ? "solana" : null;
    if (!family) throw invalidInput(`${input.address} is not an EVM or Solana address.`);
    return { name: input.name, address: input.address, family, payboxUsername: input.username ?? null, verified: false };
  }
  if (!input.username) throw invalidInput("Give their address or their PayBox username.");
  if (!deps.account) throw new AgentToolError("paybox_not_connected", "Connect PayBox to look up a PayBox username.", "connect_paybox");
  const resolved = await deps.account.resolveUsername(input.username);
  const family = familyOf(input.chain ?? BASE.caip2);
  const address = resolved?.[family] ?? null;
  if (!address) throw invalidInput(`No ${family === "evm" ? "EVM" : "Solana"} wallet found for PayBox user ${input.username}.`);
  return { name: input.name, address, family, payboxUsername: resolved?.username ?? input.username, verified: false };
}

export const hakoContacts = defineTool({
  name: "hako_contacts",
  title: "Contacts",
  description:
    "The person's saved recipients: list them, add one (a name for an address or a PayBox username), rename, delete, " +
    "or resolve a name to its address. Sends can then name the contact ('send Tobi 0.10 USDC').",
  input: contactsInput,
  output: structuredContentSchema("contact"),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["contact"],
  async execute(input, deps) {
    const book = contactBook(deps);
    let changedId: string | null = null;
    let action: "list" | "added" | "renamed" | "deleted" | "resolved" = "list";
    if (input.action === "add") {
      changedId = (await book.add(await newContact(deps, input))).id;
      action = "added";
    } else if (input.action === "rename") {
      changedId = (await book.rename(input.id, input.name)).id;
      action = "renamed";
    } else if (input.action === "delete") {
      await book.remove(input.id);
      changedId = input.id;
      action = "deleted";
    } else if (input.action === "resolve") {
      const found = await book.find(input.query);
      if (!found) throw new AgentToolError("not_found", `No saved contact called ${input.query}.`);
      return card("contact", { contacts: [found], action: "resolved", changedId: found.id }, { phase: "result" }, deps);
    }
    const contacts = [...(await book.list())];
    return card("contact", { contacts, action, changedId }, { phase: "result" }, deps);
  },
});
