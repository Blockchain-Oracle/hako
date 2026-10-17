"""Check the L2 catalog tools against the card and gateway contracts, live.

  uv run python packages/tools/scripts/check_samples.py [<tool id> …]

For every free chain / market / Earn tool (or the ids given) it:
1. runs the tool's published example through the real engine (live upstreams, no cache) and validates `data` against
   packages/cards/schemas/<render>.schema.json (JSON Schema 2020-12, written by `pnpm --filter @hako/cards schemas`);
2. checks the tool is free and that READ_ALIAS_CONNECTORS (packages/cards/src/contract/gateway/read-schemas.ts) names
   only registered free tools, and that each alias's zod body schema, applied to the example, gives a body the
   tool's input model accepts (the gateway forwards the parsed body unchanged);
3. compares chain_evm/networks.py and chain_solana/provider.py with @hako/networks (registry.ts) and fails on drift.
Tools whose provider key is not set are reported unavailable (never faked). Exit status 1 on any failure. Needs Node
(type stripping) and the pnpm workspace installed for steps 2 and 3.
"""

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from jsonschema import Draft202012Validator

from hako_core.cache.store import cache
from hako_tools.connectors import load
from hako_tools.connectors.chain_evm import networks as evm
from hako_tools.connectors.chain_solana import provider as sol
from hako_tools.framework.context import close_clients
from hako_tools.framework.endpoint import REGISTRY
from hako_tools.framework.engine import run
from hako_tools.framework.errors import ToolError

ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = ROOT / "packages" / "cards" / "schemas"
L2_PROVIDERS = frozenset({"chain-evm", "chain-solana", "polymarket", "jupiter", "lifi-earn"})
L2_EXTRA_IDS = frozenset({"hako/markets"})
NODE_TIMEOUT_S = 60

# Prints READ_ALIAS_CONNECTORS, each alias body parsed by its zod schema, and @hako/networks' registry.
NODE_SCRIPT = """
const read = await import('./packages/cards/src/contract/gateway/read-schemas.ts');
const nets = await import('./packages/networks/src/registry.ts');
const examples = JSON.parse(process.argv[1]);
const bodies = {};
for (const [keyFamily, example] of Object.entries(examples)) {
  const schema = read[`${keyFamily.split('|')[0]}RequestSchema`];
  const parsed = schema ? schema.safeParse(example) : { success: false, error: 'no schema' };
  bodies[keyFamily] = parsed.success ? { ok: true, body: parsed.data } : { ok: false, error: String(parsed.error) };
}
console.log(JSON.stringify({ aliases: read.READ_ALIAS_CONNECTORS, bodies, networks: nets.NETWORKS }));
"""


def _is_free_read(endpoint_id: str) -> bool:
    return endpoint_id.split("/", 1)[0] in L2_PROVIDERS or endpoint_id in L2_EXTRA_IDS


def _l2_ids() -> list[str]:
    """The free reads. Paid media (elevenlabs/*) spends credits: pass those ids explicitly."""
    return sorted(e.id for e in REGISTRY.values() if _is_free_read(e.id))


async def _samples(ids: list[str]) -> list[str]:
    failures: list[str] = []
    for endpoint_id in ids:
        endpoint = REGISTRY[endpoint_id]
        if _is_free_read(endpoint_id) and not endpoint.price.free:
            failures.append(f"{endpoint_id}: priced {endpoint.price.usd}, must be free")
        if not endpoint.available:
            print(f"UNAVAILABLE {endpoint_id:24} (key not set: reports tool_unavailable)")
            continue
        try:
            env = await run(endpoint_id, endpoint.example, fresh=True)
        except ToolError as exc:
            failures.append(f"{endpoint_id}: {exc.code}: {exc.message}")
            print(f"FAIL  {endpoint_id:24} {exc.code}: {exc.message}")
            continue
        if not env["found"]:
            failures.append(f"{endpoint_id}: example found nothing ({env['data'].get('message')})")
            continue
        schema = json.loads((SCHEMAS / f"{endpoint.render.value}.schema.json").read_text())
        errors = sorted(Draft202012Validator(schema).iter_errors(env["data"]), key=lambda e: list(e.path))
        for err in errors:
            failures.append(f"{endpoint_id}: {'/'.join(map(str, err.path)) or 'data'}: {err.message}")
        mark = "OK  " if not errors else "BAD "
        print(f"{mark}  {endpoint_id:24} {endpoint.render.value:14} {env['elapsed_ms']:5d} ms  {len(errors)} errors")
    await close_clients()
    return failures


def _node(examples: dict[str, Any]) -> dict[str, Any] | None:
    try:
        out = subprocess.run(["node", "--input-type=module", "-e", NODE_SCRIPT, json.dumps(examples)], cwd=ROOT,
                             capture_output=True, text=True, timeout=NODE_TIMEOUT_S, check=True)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(f"SKIP  contract checks: node could not read the TypeScript contracts ({exc})")
        return None
    return json.loads(out.stdout)


def _alias_examples(aliases: dict[str, dict[str, str | None]]) -> dict[str, Any]:
    """Each alias body as an agent would send it, per chain family: that family's connector example."""
    return {f"{key}|{family}": REGISTRY[target].example for key, targets in aliases.items()
            for family, target in targets.items() if target and target in REGISTRY}


def _aliases(contract: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for key, targets in contract["aliases"].items():
        for family, target in targets.items():
            if target is None:
                continue
            endpoint = REGISTRY.get(target)
            if endpoint is None or not endpoint.price.free:
                failures.append(f"alias {key}.{family} → {target}: {'missing' if endpoint is None else 'not free'}")
                continue
            parsed = contract["bodies"].get(f"{key}|{family}")
            if parsed:
                if not parsed["ok"]:
                    failures.append(f"alias {key}: the zod schema rejects {target}'s example: {parsed['error'][:200]}")
                    continue
                try:
                    endpoint.input_model.model_validate(parsed["body"])
                except ValueError as exc:
                    failures.append(f"alias {key}: {target} rejects the gateway's body: {str(exc)[:200]}")
    print(f"{'OK  ' if not failures else 'BAD '}  read aliases: {len(contract['aliases'])} checked")
    return failures


def _networks(registry: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for net in evm.NETWORKS:
        ts = registry.get(net.key) or {}
        mine = {"caip2": net.caip2, "chainId": net.chain_id, "rpcUrls": list(net.rpc_urls),
                "explorer": net.explorer, "native": [net.native.symbol, net.native.decimals],
                "usdc": net.usdc.address}
        theirs = {"caip2": ts.get("caip2"), "chainId": ts.get("chainId"), "rpcUrls": ts.get("rpcUrls"),
                  "explorer": (ts.get("explorer") or {}).get("url"),
                  "native": [(ts.get("native") or {}).get("symbol"), (ts.get("native") or {}).get("decimals")],
                  "usdc": (ts.get("usdc") or {}).get("address")}
        failures += [f"networks {net.key}.{k}: {mine[k]} ≠ @hako/networks {theirs[k]}" for k in mine
                     if mine[k] != theirs[k]]
    s = registry.get("solana") or {}
    for field, mine_v, theirs_v in (("caip2", sol.CAIP2, s.get("caip2")),
                                    ("rpcUrls", list(sol.PUBLIC_RPC_URLS), s.get("rpcUrls")),
                                    ("usdc", sol.USDC_MINT, (s.get("usdc") or {}).get("address")),
                                    ("lifiChainId", sol.LIFI_CHAIN_ID, s.get("lifiChainId"))):
        if mine_v != theirs_v:
            failures.append(f"networks solana.{field}: {mine_v} ≠ @hako/networks {theirs_v}")
    print(f"{'OK  ' if not failures else 'BAD '}  networks mirror @hako/networks")
    return failures


def main() -> None:
    load_dotenv(override=False)
    load()
    cache.setup(None)
    ids = sys.argv[1:] or _l2_ids()
    failures = asyncio.run(_samples(ids))
    aliases_ts = _node({})
    if aliases_ts is not None:
        contract = _node(_alias_examples(aliases_ts["aliases"]))
        if contract is not None:
            failures += _aliases(contract) + _networks(contract["networks"])
    for failure in failures:
        print(f"  ✗ {failure}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
