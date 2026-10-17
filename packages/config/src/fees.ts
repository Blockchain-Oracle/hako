/**
 * `/v1/broadcast` prices a wallet-sign request at creation: `maxFeePerGas` = BASE_FEE_MULTIPLIER × latest base fee +
 * priority fee (plan B13), so the signed transaction survives the base fee doubling before PayBox signs it.
 * A bigint, because gas math runs in wei.
 */
export const BASE_FEE_MULTIPLIER = 2n;
