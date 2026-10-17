-- Keyset paging that never skips a row, and one spelling per EVM transaction hash (W0.4 review).

-- Lists page newest first by (created_at, id), continuing from the last row a caller read back. A JS Date holds
-- milliseconds, so the paged tables store created_at to the millisecond: a cursor taken from a row then compares
-- equal to that row, and rows sharing a timestamp (everything one transaction records shares now()) are told apart
-- by id instead of being skipped at a page boundary.
alter table receipts alter column created_at type timestamptz(3);
alter table invoices alter column created_at type timestamptz(3);

-- Every list orders by created_at desc, id desc: its index carries both.
drop index if exists receipts_payer_idx;
create index receipts_payer_idx on receipts (lower(payer), created_at desc, id desc);
drop index if exists receipts_pay_to_idx;
create index receipts_pay_to_idx on receipts (lower(pay_to), created_at desc, id desc);
drop index if exists receipts_public_idx;
create index receipts_public_idx on receipts (created_at desc, id desc) where is_public;
drop index if exists invoices_pay_to_idx;
create index invoices_pay_to_idx on invoices (lower(pay_to), created_at desc, id desc);
drop index if exists invoices_created_by_idx;
create index invoices_created_by_idx on invoices (created_by, created_at desc, id desc);

-- EVM transaction hashes are hex, so 0xAB.. and 0xab.. are one transaction: whichever process records a receipt
-- stores the hash lowercase (@hako/db does it for its callers), and receipts_tx_uidx (kind, chain, tx_hash) then
-- keeps one receipt per settlement. Solana signatures are base58, where case is part of the value. NOT VALID: rows
-- written before this migration are left as they are; every new or updated row is checked.
alter table receipts add constraint receipts_evm_tx_hash_lowercase
  check (tx_hash is null or chain not like 'eip155:%' or tx_hash = lower(tx_hash)) not valid;
alter table receipts add constraint receipts_evm_dest_tx_hash_lowercase
  check (dest_tx_hash is null or coalesce(to_chain, chain) not like 'eip155:%' or dest_tx_hash = lower(dest_tx_hash)) not valid;
