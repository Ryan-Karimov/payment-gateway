import { createHmac, createHash, randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

export function generateHmacSignature(
  payload: string,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateHmacSignature(payload, secret);
  return timingSafeEqual(expected, signature);
}

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Hash an API key for secure storage
 * Uses SHA-256 with a prefix to identify the hashing algorithm
 */
export function hashApiKey(apiKey: string): string {
  // Use a consistent prefix to identify hashing method for future migrations
  const hash = createHash('sha256').update(apiKey).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Verify an API key against a stored hash
 */
export function verifyApiKey(apiKey: string, storedHash: string): boolean {
  const computedHash = hashApiKey(apiKey);
  return timingSafeEqual(computedHash, storedHash);
}

export function generateApiKey(): string {
  const prefix = 'sk_live_';
  const key = randomBytes(24).toString('base64url');
  return `${prefix}${key}`;
}

export function generateIdempotencyKey(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * SECURITY: Uses Node's native crypto.timingSafeEqual with constant-time length comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Convert to buffers for native timing-safe comparison
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // SECURITY: To prevent length-based timing attacks, we always compare
  // against a buffer of the expected length. If lengths differ, we compare
  // the expected against itself (always true) but return false.
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison to maintain constant time
    cryptoTimingSafeEqual(bufA, bufA);
    return false;
  }

  return cryptoTimingSafeEqual(bufA, bufB);
}
