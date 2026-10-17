/**
 * Wire-format constants of the two transaction encodings R15 reads (protocol facts, not product settings: Hako's own
 * limits — 1,232 bytes, one signer — come from @hako/config through `R15Rules`).
 */

/** Solana: an ed25519 signature slot and a public key. */
export const SOLANA_SIGNATURE_BYTES = 64;
export const SOLANA_PUBKEY_BYTES = 32;
/** A versioned message's first byte has the top bit set; the low bits are the version. */
export const SOLANA_VERSIONED_FLAG = 0x80;
export const SOLANA_VERSION_MASK = 0x7f;
/** Versions PayBox accepts besides legacy (PayBox: "Legacy or v0 only"). */
export const SOLANA_SUPPORTED_VERSIONS: readonly number[] = [0];
/** Message header: required signatures, read-only signed, read-only unsigned. */
export const SOLANA_MESSAGE_HEADER_BYTES = 3;
/** compact-u16 ("shortvec"): 7 data bits per byte, top bit = more bytes follow, at most 3 bytes. */
export const COMPACT_U16_DATA_BITS = 7;
export const COMPACT_U16_DATA_MASK = 0x7f;
export const COMPACT_U16_CONTINUATION = 0x80;
export const COMPACT_U16_MAX_BYTES = 3;

/** Bitcoin's base58 alphabet, which Solana addresses use. */
export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const BITS_PER_BYTE = 8;
export const BYTE_MASK = 0xff;

/** EVM: `approve(address,uint256)` selector, ABI words, addresses. */
export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
export const ABI_WORD_HEX_CHARS = 64;
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const HEX_RADIX = 16;
/** The largest uint256 (an approve amount must fit one ABI word). */
export const UINT256_MAX = 2n ** 256n - 1n;
/** Zero token units (bigint), for comparisons. */
export const ZERO_UNITS = 0n;
