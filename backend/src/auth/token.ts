import { createHash, randomBytes } from 'node:crypto';

/** A new opaque session token: 32 random bytes, base64url (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 of the token. Only this is stored, so a leaked database can't be used
 * to log in. A fast hash is fine here because the token itself is random and
 * high-entropy (unlike a password, it can't be guessed from a dictionary).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
