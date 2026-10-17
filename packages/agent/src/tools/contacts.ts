import { CONTACT_NAME_MAX_CHARS, type Contact, PAYBOX_USERNAME_MAX_CHARS, structuredContentSchema } from "@hako/cards/contract";
import { sameAddress } from "@hako/money";
import { BASE, type Caip2 } from "@hako/networks";
import { z } from "zod";

import { card, defineTool, MODEL_AND_APP } from "../define.ts";
import type { AgentDeps, ContactBook, NewContact } from "../deps.ts";
import { AgentToolError, authRequired, invalidInput } from "../errors.ts";
import { chainInputSchema } from "../inputs.ts";
import { familyOf, isAddressOf, requireUser } from "../resolve.ts";

/**
 * Contacts (plan D25, J9: "save tobi.paybox as Tobi" → "send Tobi 0.10 USDC"): a saved name for an address or a
 * PayBox username, so a send can name a person. A new contact starts unverified; it is verified when the address read
 * from the recipient's own receive QR equals the saved one.
 */

const CONTACT_ACTIONS = ["list", "add", "rename", "delete", "resolve", "verify"] as const;
type ContactAction = (typeof CONTACT_ACTIONS)[number];

/** One object for every action (model tool schemas need `type: "object"` at the root); each action's fields are checked. */
const contactsFields = z.object({
  action: z.enum(CONTACT_ACTIONS).describe("list, add, rename, delete, resolve (a name to its address) or verify (after scanning their QR)"),
  id: z.string().min(1).optional().describe("rename, delete, verify: the contact's id"),
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX_CHARS).optional().describe("add, rename: what the person calls them, e.g. Tobi"),
  address: z.string().min(1).optional().describe("add: their wallet address"),
  username: z.string().min(1).max(PAYBOX_USERNAME_MAX_CHARS).optional().describe("add: their PayBox username, e.g. tobi.paybox"),
  chain: chainInputSchema.optional().describe("add: which family the address is for when a username has both; Base (EVM) by default"),
  query: z.string().min(1).optional().describe("resolve: a saved name or PayBox username"),
  qrPayload: z.string().min(1).optional().describe("verify: the text read from the recipient's receive QR code"),
});
type ContactsInput = z.output<typeof contactsFields>;

const REQUIRED: Record<ContactAction, readonly (keyof ContactsInput)[]> = {
  list: [],
  add: ["name"],
  rename: ["id", "name"],
  delete: ["id"],
  resolve: ["query"],
  verify: ["id", "qrPayload"],
};

const contactsInput = contactsFields.superRefine((input, ctx) => {
  for (const field of REQUIRED[input.action]) {
    if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `action ${input.action} needs ${field}` });
  }
  if (input.action === "add" && input.address === undefined && input.username === undefined) {
    ctx.addIssue({ code: "custom", path: ["address"], message: "action add needs their address or their PayBox username" });
  }
});

function need<K extends keyof ContactsInput>(input: ContactsInput, field: K): NonNullable<ContactsInput[K]> {
  const value = input[field];
  if (value === undefined || value === null) throw invalidInput(`action ${input.action} needs ${String(field)}`);
  return value;
}

function contactBook(deps: AgentDeps): ContactBook {
  requireUser(deps, "hako_contacts");
  if (!deps.contacts) throw authRequired("hako_contacts");
  return deps.contacts;
}

/** A new contact from an address, or from a PayBox username resolved to the address for the chosen family. */
async function newContact(deps: AgentDeps, input: { name: string; address?: string; username?: string; chain?: Caip2 }): Promise<NewContact> {
  if (input.address) {
    const family = isAddressOf("evm", input.address) ? "evm" : isAddressOf("solana", input.address) ? "solana" : null;
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

/** The address a receive QR carries: a bare address, or a payment URI (`ethereum:0x…@8453?…`, `solana:<address>?…`). */
function qrAddress(payload: string): string {
  const text = payload.trim();
  const uri = /^[a-z][a-z0-9+.-]*:(?:\/\/)?([^@?/#]+)/i.exec(text);
  return uri?.[1] ?? text;
}

/** Verifies a contact only when the address scanned from their QR is the one saved: never on a name alone. */
async function verifyContact(book: ContactBook, id: string, qrPayload: string): Promise<Contact> {
  const contact = (await book.list()).find((saved) => saved.id === id);
  if (!contact) throw new AgentToolError("not_found", `No saved contact with id ${id}.`);
  const scanned = qrAddress(qrPayload);
  if (!isAddressOf(contact.family, scanned) || !sameAddress(scanned, contact.address)) {
    throw invalidInput(`The scanned code doesn't match ${contact.name}'s saved address: check it with them before sending.`);
  }
  return book.verify(id);
}

export const hakoContacts = defineTool({
  name: "hako_contacts",
  title: "Contacts",
  description:
    "The person's saved recipients: list them, add one (a name for an address or a PayBox username), rename, delete, " +
    "resolve a name to its address, or verify one after the person scanned that contact's receive QR (pass what the " +
    "scan read). Sends can then name the contact ('send Tobi 0.10 USDC').",
  input: contactsInput,
  output: structuredContentSchema("contact"),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["contact"],
  async execute(input, deps) {
    const book = contactBook(deps);
    let changedId: string | null = null;
    let action: "list" | "added" | "renamed" | "deleted" | "verified" = "list";
    if (input.action === "add") {
      const name = need(input, "name");
      changedId = (await book.add(await newContact(deps, { name, address: input.address, username: input.username, chain: input.chain }))).id;
      action = "added";
    } else if (input.action === "rename") {
      changedId = (await book.rename(need(input, "id"), need(input, "name"))).id;
      action = "renamed";
    } else if (input.action === "delete") {
      changedId = need(input, "id");
      await book.remove(changedId);
      action = "deleted";
    } else if (input.action === "verify") {
      changedId = (await verifyContact(book, need(input, "id"), need(input, "qrPayload"))).id;
      action = "verified";
    } else if (input.action === "resolve") {
      const query = need(input, "query");
      const found = await book.find(query);
      if (!found) throw new AgentToolError("not_found", `No saved contact called ${query}.`);
      return card("contact", { contacts: [found], action: "resolved", changedId: found.id }, { phase: "result" }, deps);
    }
    const contacts = [...(await book.list())];
    return card("contact", { contacts, action, changedId }, { phase: "result" }, deps);
  },
});
