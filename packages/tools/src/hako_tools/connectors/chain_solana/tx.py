"""chain-solana/tx: a transaction signature's status, slot, time, fee, signer and SOL / SPL transfers."""

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import Field

from hako_tools.connectors.chain_evm.tx import Transfer, TxOutput
from hako_tools.connectors.chain_solana.provider import (
    CAIP2,
    CHAIN_SOLANA,
    NATIVE_ADDRESS,
    NATIVE_DECIMALS,
    NATIVE_SYMBOL,
    SIGNATURE_PATTERN,
    SolanaChain,
    tx_url,
)
from hako_tools.connectors.chain_solana.rpc import batch
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, tool
from hako_tools.framework.jsonrpc import RpcError

TRANSFERS_MAX = 20
# Version 1 transactions are live on mainnet (2026-10-17: a v1 USDC transfer refused a client asking for 0 only).
MAX_TX_VERSION = 1
TX_OPTIONS = {"encoding": "jsonParsed", "maxSupportedTransactionVersion": MAX_TX_VERSION, "commitment": "confirmed"}
SPL_PROGRAMS = frozenset({"spl-token", "spl-token-2022"})
TRANSFER_TYPES = frozenset({"transfer", "transferChecked"})
FINALIZED = "finalized"
Signature = Annotated[str, Field(pattern=SIGNATURE_PATTERN, description="The transaction signature (base58).")]


class SolTxInput(ToolInput):
    chain: SolanaChain = CAIP2
    hash: Signature


def _instructions(tx: dict[str, Any]) -> list[dict[str, Any]]:
    outer = ((tx.get("transaction") or {}).get("message") or {}).get("instructions") or []
    groups = (tx.get("meta") or {}).get("innerInstructions") or []
    inner = [i for group in groups for i in group.get("instructions", [])]
    return [i for i in [*outer, *inner] if isinstance(i, dict) and isinstance(i.get("parsed"), dict)]


def _token_accounts(tx: dict[str, Any]) -> dict[str, tuple[str, str | None, int | None]]:
    """Token account → (mint, owner, decimals), from the balances the transaction touched."""
    keys = [k.get("pubkey") if isinstance(k, dict) else k
            for k in ((tx.get("transaction") or {}).get("message") or {}).get("accountKeys") or []]
    meta = tx.get("meta") or {}
    out: dict[str, tuple[str, str | None, int | None]] = {}
    for bal in [*(meta.get("preTokenBalances") or []), *(meta.get("postTokenBalances") or [])]:
        idx = bal.get("accountIndex")
        if isinstance(idx, int) and idx < len(keys):
            decimals = (bal.get("uiTokenAmount") or {}).get("decimals")
            out[str(keys[idx])] = (str(bal.get("mint")), bal.get("owner"), decimals)
    return out


def _transfers(tx: dict[str, Any]) -> list[Transfer]:
    accounts = _token_accounts(tx)
    out: list[Transfer] = []
    for ins in _instructions(tx):
        parsed, program = ins["parsed"], ins.get("program")
        info = parsed.get("info") or {}
        if parsed.get("type") not in TRANSFER_TYPES:
            continue
        if program == "system" and "lamports" in info:
            out.append(Transfer.model_validate({
                "token": NATIVE_ADDRESS, "from": info.get("source"), "to": info.get("destination"),
                "amount_atomic": str(info["lamports"]), "symbol": NATIVE_SYMBOL, "decimals": NATIVE_DECIMALS}))
        elif program in SPL_PROGRAMS:
            src, dst = accounts.get(str(info.get("source"))), accounts.get(str(info.get("destination")))
            mint = info.get("mint") or (src or dst or (None, None, None))[0]
            amount = info.get("amount") or (info.get("tokenAmount") or {}).get("amount")
            if not mint or amount is None:
                continue
            decimals = (info.get("tokenAmount") or {}).get("decimals") or (src or dst or (None, None, None))[2]
            out.append(Transfer.model_validate({
                "token": mint, "from": (src[1] if src and src[1] else info.get("authority") or info.get("source")),
                "to": (dst[1] if dst and dst[1] else info.get("destination")), "amount_atomic": str(amount),
                "decimals": decimals}))
    return out[:TRANSFERS_MAX]


@tool(
    provider=CHAIN_SOLANA,
    slug="tx",
    name="Solana Transaction Status",
    summary="Whether a Solana transaction landed, with slot, time, fee, signer, confirmations and SOL/SPL transfers.",
    description="Looks up one transaction signature (Helius, else public RPCs): success, reverted (failed on chain), "
    "pending (seen but not yet confirmed) or not_found; the slot and its time, the fee in lamports, the fee payer, "
    "confirmations until finalized, the Solscan link, and every SOL and SPL token transfer it made (owners, not "
    "token accounts, where the chain says them). Use it to confirm a Solana payment or a bridge's source leg. For "
    "EVM chains use chain-evm/tx.",
    categories=(Category.crypto,),
    render=Render.tx_receipt,
    price=FREE,
    example={"chain": CAIP2,
             "hash": "5jQeDse7ee62aNzHsxaroxwEvigSsLawr1w4e7jZpBK4TLNKDsyFNYZGbdFH1p1KJxSZHSYmucUyQRPg23ErS6Kd"},
    see_also=("chain-solana/balance", "chain-evm/tx"),
)
async def tx(inp: SolTxInput, ctx: RunContext) -> TxOutput:
    found, statuses = await batch(ctx, [("getTransaction", [inp.hash, TX_OPTIONS]),
                                        ("getSignatureStatuses", [[inp.hash], {"searchTransactionHistory": True}])])
    if isinstance(found, RpcError):
        raise ProviderError(f"Solana RPC could not look the transaction up: {found.message}")
    status = None if isinstance(statuses, RpcError) else ((statuses or {}).get("value") or [None])[0]
    out = TxOutput(chain=CAIP2, hash=inp.hash, status="not_found", explorer_url=tx_url(inp.hash))
    if not found:
        if status:
            out.status, out.block_number = "pending", status.get("slot")
        else:
            ctx.note("No transaction with this signature on Solana mainnet; it may not have propagated yet.")
        return out
    meta = found.get("meta") or {}
    out.status = "success" if meta.get("err") is None else "reverted"
    out.block_number = found.get("slot")
    if found.get("blockTime"):
        out.timestamp = datetime.fromtimestamp(int(found["blockTime"]), UTC).isoformat(timespec="seconds")
    out.fee_atomic = str(meta.get("fee") or 0)
    keys = ((found.get("transaction") or {}).get("message") or {}).get("accountKeys") or []
    if keys:
        out.from_ = keys[0].get("pubkey") if isinstance(keys[0], dict) else str(keys[0])
    if status and status.get("confirmationStatus") != FINALIZED and status.get("confirmations") is not None:
        out.confirmations = int(status["confirmations"])
    out.transfers = _transfers(found) or None
    return out
