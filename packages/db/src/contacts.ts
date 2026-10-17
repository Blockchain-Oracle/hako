import type { Queryable } from "./pool.ts";
import { isUniqueViolation, newId } from "./shared.ts";

/** The chain family a saved address receives on (an EVM address receives on every EVM chain). */
export const ADDRESS_FAMILIES = ["evm", "solana"] as const;
export type AddressFamily = (typeof ADDRESS_FAMILIES)[number];

/** A saved recipient (plan D25): an address, a PayBox username (resolved with `resolve_username`), or both. */
export interface ContactRow {
  id: string;
  ownerUserId: string;
  label: string;
  address: string | null;
  family: AddressFamily | null;
  payboxUsername: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewContact =
  | { ownerUserId: string; label: string; address: string; family: AddressFamily; payboxUsername?: string | null }
  | { ownerUserId: string; label: string; address?: null; family?: null; payboxUsername: string };

const COLUMNS = `id, owner_user_id as "ownerUserId", label, address, family, paybox_username as "payboxUsername",
  verified, verified_at as "verifiedAt", created_at as "createdAt", updated_at as "updatedAt"`;

/** Adds a contact; null when the owner already has one with this label (labels are unique per owner, any case). */
export async function addContact(q: Queryable, input: NewContact): Promise<ContactRow | null> {
  const { rows } = await q.query<ContactRow>(
    `insert into contacts (id, owner_user_id, label, address, family, paybox_username)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning ${COLUMNS}`,
    [newId(), input.ownerUserId, input.label.trim(), input.address ?? null, input.family ?? null, input.payboxUsername ?? null],
  );
  return rows[0] ?? null;
}

export async function listContacts(q: Queryable, ownerUserId: string): Promise<ContactRow[]> {
  const { rows } = await q.query<ContactRow>(`select ${COLUMNS} from contacts where owner_user_id = $1 order by lower(label)`, [ownerUserId]);
  return rows;
}

export async function getContact(q: Queryable, ownerUserId: string, id: string): Promise<ContactRow | null> {
  const { rows } = await q.query<ContactRow>(`select ${COLUMNS} from contacts where owner_user_id = $1 and id = $2`, [ownerUserId, id]);
  return rows[0] ?? null;
}

/** "send Tobi 0.10 USDC": the owner's contact with this label, any case. */
export async function findContactByLabel(q: Queryable, ownerUserId: string, label: string): Promise<ContactRow | null> {
  const { rows } = await q.query<ContactRow>(
    `select ${COLUMNS} from contacts where owner_user_id = $1 and lower(label) = lower($2)`,
    [ownerUserId, label.trim()],
  );
  return rows[0] ?? null;
}

/** Renames a contact; null when it doesn't exist or the new label is taken. */
export async function renameContact(q: Queryable, ownerUserId: string, id: string, label: string): Promise<ContactRow | null> {
  try {
    const { rows } = await q.query<ContactRow>(
      `update contacts set label = $3, updated_at = now() where owner_user_id = $1 and id = $2 returning ${COLUMNS}`,
      [ownerUserId, id, label.trim()],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Marks the contact's address verified (scanned from the person's own QR). */
export async function markContactVerified(q: Queryable, ownerUserId: string, id: string): Promise<ContactRow | null> {
  const { rows } = await q.query<ContactRow>(
    `update contacts set verified = true, verified_at = now(), updated_at = now() where owner_user_id = $1 and id = $2 returning ${COLUMNS}`,
    [ownerUserId, id],
  );
  return rows[0] ?? null;
}

export async function deleteContact(q: Queryable, ownerUserId: string, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from contacts where owner_user_id = $1 and id = $2`, [ownerUserId, id]);
  return rowCount === 1;
}
