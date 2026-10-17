"""pubchem/compound: properties and a few synonyms for one compound, fetched in parallel."""

import asyncio
from typing import Any
from urllib.parse import quote

from pydantic import Field

from hako_tools.connectors.pubchem.provider import PUBCHEM
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

SYNONYMS_SHOWN = 8
# ConnectivitySMILES is PubChem's renamed "canonical" SMILES; SMILES is the full (isomeric) one.
PROPERTIES = "Title,IUPACName,MolecularFormula,MolecularWeight,ConnectivitySMILES,SMILES,InChIKey,XLogP"


class CompoundInput(ToolInput):
    name: str = Field(min_length=1, max_length=200,
                      description="A common, IUPAC or brand name ('aspirin'), a CAS number ('50-78-2') or a PubChem "
                      "CID ('2244').")


class CompoundOutput(ToolOutput):
    cid: int
    title: str | None = None
    iupac_name: str | None = None
    molecular_formula: str | None = None
    molecular_weight: float | None = None  # g/mol
    canonical_smiles: str | None = None
    isomeric_smiles: str | None = None
    inchikey: str | None = None
    xlogp: float | None = None
    synonyms: list[str] = Field(default_factory=list)
    url: str


def _namespace(name: str) -> str:
    kind = "cid" if name.isdigit() else "name"
    return f"/rest/pug/compound/{kind}/{quote(name, safe='')}"


async def _gather(*calls: Any) -> list[Any]:
    """Run calls together but surface the first failure as itself (a TaskGroup would wrap a not-found answer)."""
    results = await asyncio.gather(*calls, return_exceptions=True)
    for result in results:
        if isinstance(result, BaseException):
            raise result
    return results


@tool(
    provider=PUBCHEM,
    slug="compound",
    name="PubChem Compound",
    summary="Look a chemical up by name, CAS number or CID: formula, molecular weight, IUPAC name, SMILES, InChIKey.",
    description="Resolves a compound name (common, IUPAC or brand), CAS registry number or PubChem CID to its "
    "PubChem record: CID, IUPAC name, molecular formula, molecular weight, canonical and isomeric SMILES, InChIKey, "
    "XLogP and a few synonyms. When a name matches several records the first (best) is returned. It gives no "
    "safety, toxicity or dosing advice and does not search by structure; for prose about a substance use "
    "wikipedia/summary.",
    categories=(Category.science,),
    render=Render.json,
    price=LOCAL,
    example={"name": "aspirin"},
    see_also=("wikipedia/summary", "wikidata/search"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def compound(inp: CompoundInput, ctx: RunContext) -> CompoundOutput:
    base = _namespace(inp.name)
    props, synonyms = await _gather(ctx.get_json(PUBCHEM, f"{base}/property/{PROPERTIES}/JSON"),
                                    ctx.get_json(PUBCHEM, f"{base}/synonyms/JSON"))
    rows: list[dict[str, Any]] = (props.get("PropertyTable") or {}).get("Properties") or []
    if not rows:
        raise ToolNotFoundResult(f"PubChem has no compound named {inp.name!r}")
    row = rows[0]
    if len(rows) > 1:
        ctx.note(f"{len(rows)} PubChem records match this name; showing CID {row.get('CID')}.")
    info = ((synonyms.get("InformationList") or {}).get("Information") or [{}])[0]
    weight = row.get("MolecularWeight")
    return CompoundOutput(
        cid=row["CID"],
        title=row.get("Title"),
        iupac_name=row.get("IUPACName"),
        molecular_formula=row.get("MolecularFormula"),
        molecular_weight=float(weight) if weight else None,
        canonical_smiles=row.get("ConnectivitySMILES"),
        isomeric_smiles=row.get("SMILES"),
        inchikey=row.get("InChIKey"),
        xlogp=row.get("XLogP"),
        synonyms=(info.get("Synonym") or [])[:SYNONYMS_SHOWN],
        url=f"https://pubchem.ncbi.nlm.nih.gov/compound/{row['CID']}",
    )
