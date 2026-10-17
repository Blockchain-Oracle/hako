/** Characters kept at each end of a shortened address: `0x92a3…bf0a`, `4UsEm6…VR5r`. */
export const ADDRESS_HEAD_CHARS = 6;
export const ADDRESS_TAIL_CHARS = 4;
export const ELLIPSIS = "…";

/** An EVM address or Solana account shortened for display; short strings come back unchanged. */
export function shortenAddress(address: string, head = ADDRESS_HEAD_CHARS, tail = ADDRESS_TAIL_CHARS): string {
  const value = address.trim();
  if (value.length <= head + tail + ELLIPSIS.length) return value;
  return `${value.slice(0, head)}${ELLIPSIS}${value.slice(value.length - tail)}`;
}

/** A transaction hash or signature shortened the same way. */
export const shortenHash = shortenAddress;

/** Two addresses are the same account (EVM addresses compare case-insensitively; Solana base58 is case-sensitive). */
export function sameAddress(a: string, b: string): boolean {
  const isEvm = (value: string) => value.startsWith("0x");
  return isEvm(a) && isEvm(b) ? a.toLowerCase() === b.toLowerCase() : a === b;
}
