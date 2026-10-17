"""Human-readable ABI signatures ("balanceOf(address owner) view returns (uint256)"): parse, encode, decode.

Encoding and decoding are eth-abi's; this module only turns a signature an agent can write into its canonical types
and turns decoded values into JSON (integers as base-10 strings, bytes as 0x hex), so no precision is lost.
"""

from dataclasses import dataclass
from typing import Any

from eth_abi.abi import decode, encode
from eth_utils.crypto import keccak

_MODIFIERS = frozenset({"indexed", "memory", "calldata", "storage", "payable"})
_FUNCTION_WORDS = frozenset({"view", "pure", "external", "public", "nonpayable", "payable", "constant"})
_ALIASES = {"uint": "uint256", "int": "int256", "byte": "bytes1"}
SELECTOR_BYTES = 4
SIGNATURE_MAX_CHARS = 500


class SignatureError(ValueError):
    """The signature text could not be read."""


@dataclass(frozen=True, slots=True)
class Param:
    type: str  # canonical, e.g. "uint256", "(address,uint256)[]"
    name: str | None = None
    indexed: bool = False


@dataclass(frozen=True, slots=True)
class Signature:
    name: str
    inputs: tuple[Param, ...]
    outputs: tuple[Param, ...]

    @property
    def canonical(self) -> str:
        return f"{self.name}({','.join(p.type for p in self.inputs)})"

    @property
    def selector(self) -> bytes:
        return keccak(text=self.canonical)[:SELECTOR_BYTES]

    @property
    def topic(self) -> str:
        return "0x" + keccak(text=self.canonical).hex()

    @property
    def text(self) -> str:
        out = f" returns ({','.join(p.type for p in self.outputs)})" if self.outputs else ""
        return f"{self.canonical}{out}"


def _close(text: str, start: int) -> int:
    """Index of the parenthesis that closes the one at `start`."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    raise SignatureError(f"unbalanced parentheses in {text!r}")


def _split(text: str) -> list[str]:
    """Split a parameter list at its top-level commas."""
    parts, depth, current = [], 0, []
    for ch in text:
        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
            continue
        depth += (ch == "(") - (ch == ")")
        current.append(ch)
    tail = "".join(current).strip()
    if tail or parts:
        parts.append(tail)
    if any(not p for p in parts):
        raise SignatureError(f"empty parameter in ({text})")
    return parts


def _base_type(word: str) -> str:
    root, bracket, rest = word.partition("[")
    root = _ALIASES.get(root, root)
    return f"{root}{bracket}{rest}"


def _param(text: str) -> Param:
    if text.startswith("("):
        end = _close(text, 0)
        inner = ",".join(p.type for p in _params(text[1:end]))
        suffix_end = end + 1
        while suffix_end < len(text) and text[suffix_end] in "[]0123456789":
            suffix_end += 1
        type_ = f"({inner}){text[end + 1:suffix_end]}"
        words = text[suffix_end:].split()
    else:
        first, *words = text.split()
        if first == "tuple":
            raise SignatureError("write tuples as (type,type), not tuple")
        type_ = _base_type(first)
    indexed = "indexed" in words
    names = [w for w in words if w not in _MODIFIERS]
    return Param(type=type_, name=names[0] if names else None, indexed=indexed)


def _params(text: str) -> tuple[Param, ...]:
    return tuple(_param(p) for p in _split(text)) if text.strip() else ()


def parse(signature: str) -> Signature:
    """Read "name(type a, type b) [view] [returns (type)]" (a leading "function " or "event " is fine)."""
    text = " ".join(signature.strip().rstrip(";").split())
    for word in ("function ", "event "):
        text = text.removeprefix(word)
    start = text.find("(")
    name = text[:start].strip()
    if start <= 0 or not name.isidentifier():
        raise SignatureError(f"expected name(types…), got {signature!r}")
    end = _close(text, start)
    inputs = _params(text[start + 1:end])
    rest = text[end + 1:]
    outputs: tuple[Param, ...] = ()
    if "returns" in rest:
        after = rest.split("returns", 1)[1].strip()
        if not after.startswith("("):
            raise SignatureError("returns must be followed by (types…)")
        outputs = _params(after[1:_close(after, 0)])
    elif rest.split() and not set(rest.split()) <= _FUNCTION_WORDS | {"anonymous"}:
        raise SignatureError(f"unexpected {rest.strip()!r} after the parameters")
    return Signature(name=name, inputs=inputs, outputs=outputs)


def _coerce(type_: str, value: Any) -> Any:
    """A JSON value as eth-abi wants it for `type_` (integers may be strings, bytes are 0x hex)."""
    if type_.endswith("]"):
        inner = type_[:type_.rindex("[")]
        if not isinstance(value, list):
            raise SignatureError(f"{type_} needs a list")
        return [_coerce(inner, v) for v in value]
    if type_.startswith("("):
        types = [p.type for p in _params(type_[1:-1])]
        items = list(value.values()) if isinstance(value, dict) else value
        if not isinstance(items, list) or len(items) != len(types):
            raise SignatureError(f"{type_} needs {len(types)} values")
        return tuple(_coerce(t, v) for t, v in zip(types, items, strict=True))
    if type_.startswith(("uint", "int")):
        return value if isinstance(value, int) else int(str(value), 0)
    if type_ == "bool":
        return value if isinstance(value, bool) else str(value).lower() == "true"
    if type_.startswith("bytes"):
        return bytes.fromhex(str(value).removeprefix("0x"))
    return value


def encode_call(sig: Signature, args: list[Any]) -> str:
    if len(args) != len(sig.inputs):
        raise SignatureError(f"{sig.canonical} takes {len(sig.inputs)} arguments, got {len(args)}")
    types = [p.type for p in sig.inputs]
    values = [_coerce(t, a) for t, a in zip(types, args, strict=True)]
    return "0x" + (sig.selector + encode(types, values)).hex()


def to_json(value: Any) -> Any:
    """Decoded ABI values as JSON: integers as base-10 strings, bytes as 0x hex, tuples as lists."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, list | tuple):
        return [to_json(v) for v in value]
    return value


def decode_values(types: list[str], data: bytes) -> list[Any]:
    return [to_json(v) for v in decode(types, data)]
