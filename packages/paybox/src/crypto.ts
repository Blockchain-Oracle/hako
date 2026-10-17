/**
 * The one cipher for stored PayBox tokens (plan §1: "Tokens are encrypted server-side"): AES-256-GCM with
 * HAKO_TOKEN_ENCRYPTION_KEY (64 hex characters). Each ciphertext is bound to its user and column through the
 * additional authenticated data, so a token copied into another row or column fails to decrypt.
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { TOKEN_CIPHER_VERSION, TOKEN_IV_BYTES, TOKEN_KEY_BYTES, TOKEN_TAG_BYTES } from "./paybox.config.ts";

const ALGORITHM = "aes-256-gcm";
const HEX_KEY = /^[0-9a-fA-F]+$/;

export interface TokenCipher {
  encrypt(plaintext: string, context: string): string;
  decrypt(ciphertext: string, context: string): string;
}

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

/** Throws (naming the variable, never the value) unless the key is 32 bytes of hex. */
export function createTokenCipher(hexKey: string | undefined): TokenCipher {
  const key = hexKey && HEX_KEY.test(hexKey) ? Buffer.from(hexKey, "hex") : null;
  if (!key || key.length !== TOKEN_KEY_BYTES) {
    throw new TokenCipherError("HAKO_TOKEN_ENCRYPTION_KEY must be 64 hex characters: PayBox tokens are never stored in plain text.");
  }
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(TOKEN_IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TOKEN_TAG_BYTES });
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [TOKEN_CIPHER_VERSION, iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
    },
    decrypt(ciphertext, context) {
      const [version, iv, tag, body, ...rest] = ciphertext.split(".");
      if (version !== TOKEN_CIPHER_VERSION || !iv || !tag || body === undefined || rest.length > 0) {
        throw new TokenCipherError("A stored PayBox token is not in the expected format.");
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"), { authTagLength: TOKEN_TAG_BYTES });
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw new TokenCipherError("A stored PayBox token could not be decrypted (wrong key, or it belongs to another user).");
      }
    },
  };
}
