import type { Queryable } from "./pool.ts";
import { newInvoiceId, pageLimit, type AtomicString, type PageOptions, type Surface } from "./shared.ts";

/** An invoice is open until a payment claims it (settling), then paid; a failed settlement releases it (plan B12). */
export const INVOICE_STATUSES = ["open", "settling", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceRow {
  id: string;
  payTo: string;
  chain: string;
  asset: string;
  amountAtomic: AtomicString;
  note: string | null;
  status: InvoiceStatus;
  txHash: string | null;
  payer: string | null;
  createdBy: string | null;
  createdVia: Surface;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewInvoice {
  payTo: string;
  chain: string;
  asset: string;
  amountAtomic: AtomicString;
  note?: string | null;
  /** The Hako user, or null when an agent created it through the plugin. */
  createdBy?: string | null;
  createdVia: Surface;
}

const COLUMNS = `id, pay_to as "payTo", chain, asset, amount_atomic::text as "amountAtomic", note, status,
  tx_hash as "txHash", payer, created_by as "createdBy", created_via as "createdVia", paid_at as "paidAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export async function createInvoice(q: Queryable, input: NewInvoice): Promise<InvoiceRow> {
  const { rows } = await q.query<InvoiceRow>(
    `insert into invoices (id, pay_to, chain, asset, amount_atomic, note, created_by, created_via)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
    [newInvoiceId(), input.payTo, input.chain, input.asset, input.amountAtomic, input.note ?? null, input.createdBy ?? null, input.createdVia],
  );
  return rows[0]!;
}

export async function getInvoice(q: Queryable, id: string): Promise<InvoiceRow | null> {
  const { rows } = await q.query<InvoiceRow>(`select ${COLUMNS} from invoices where id = $1`, [id]);
  return rows[0] ?? null;
}

/** open → settling, atomically: the one payment allowed to settle gets the row, every other caller gets null. */
export async function claimInvoice(q: Queryable, id: string): Promise<InvoiceRow | null> {
  const { rows } = await q.query<InvoiceRow>(
    `update invoices set status = 'settling', updated_at = now() where id = $1 and status = 'open' returning ${COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/** settling → open, when the claimed settlement failed: the invoice can be paid again. */
export async function releaseInvoice(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`update invoices set status = 'open', updated_at = now() where id = $1 and status = 'settling'`, [id]);
  return rowCount === 1;
}

/** → paid with the settlement's transaction and payer; null when it was already paid. */
export async function markInvoicePaid(q: Queryable, id: string, paid: { txHash: string; payer: string | null }): Promise<InvoiceRow | null> {
  const { rows } = await q.query<InvoiceRow>(
    `update invoices set status = 'paid', tx_hash = $2, payer = $3, paid_at = now(), updated_at = now()
     where id = $1 and status <> 'paid' returning ${COLUMNS}`,
    [id, paid.txHash, paid.payer],
  );
  return rows[0] ?? null;
}

/** Invoices paying any of these addresses (the connected user's PayBox wallets), newest first. */
export async function listInvoicesByPayTo(q: Queryable, addresses: readonly string[], page: PageOptions = {}): Promise<InvoiceRow[]> {
  if (addresses.length === 0) return [];
  const { rows } = await q.query<InvoiceRow>(
    `select ${COLUMNS} from invoices
     where lower(pay_to) = any($1::text[]) and ($2::timestamptz is null or created_at < $2)
     order by created_at desc, id desc limit $3`,
    [addresses.map((address) => address.toLowerCase()), page.before ?? null, pageLimit(page.limit)],
  );
  return rows;
}

export async function listInvoicesByCreator(q: Queryable, userId: string, page: PageOptions = {}): Promise<InvoiceRow[]> {
  const { rows } = await q.query<InvoiceRow>(
    `select ${COLUMNS} from invoices
     where created_by = $1 and ($2::timestamptz is null or created_at < $2)
     order by created_at desc, id desc limit $3`,
    [userId, page.before ?? null, pageLimit(page.limit)],
  );
  return rows;
}
