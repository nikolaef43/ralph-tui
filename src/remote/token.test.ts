/**
 * ABOUTME: Tests for token management utilities.
 * Covers token generation, expiration checking, and server token operations.
 */

import { describe, expect, test } from 'bun:test';

// ============================================================================
// Pure Function Tests (no I/O mocking needed)
// ============================================================================

describe('Token Utilities', () => {
  describe('generateToken', () => {
    test('generates a token string', async () => {
      const { generateToken } = await import('./token.js');
      const token = generateToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    test('generates unique tokens', async () => {
      const { generateToken } = await import('./token.js');
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });

    test('generates URL-safe base64 tokens', async () => {
      const { generateToken } = await import('./token.js');
      const token = generateToken();
      // URL-safe base64 should not contain +, /, or =
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      // Base64url may have padding removed, so = might not be present
    });

    test('generates tokens of consistent length', async () => {
      const { generateToken } = await import('./token.js');
      const tokens = Array.from({ length: 10 }, () => generateToken());
      const lengths = new Set(tokens.map(t => t.length));
      // All tokens should be roughly the same length (32 bytes = ~43 chars base64)
      expect(lengths.size).toBe(1);
    });
  });

  describe('createServerToken', () => {
    test('creates a valid server token object', async () => {
      const { createServerToken } = await import('./token.js');
      const token = createServerToken();

      expect(token).toHaveProperty('value');
      expect(token).toHaveProperty('createdAt');
      expect(token).toHaveProperty('expiresAt');
      expect(token).toHaveProperty('version');
      expect(token.version).toBe(1);
    });

    test('sets correct expiration with default lifetime', async () => {
      const { createServerToken } = await import('./token.js');
      const before = Date.now();
      const token = createServerToken();
      const after = Date.now();

      const expiresAt = new Date(token.expiresAt).getTime();
      const createdAt = new Date(token.createdAt).getTime();

      // Created at should be close to now
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);

      // Default is 90 days
      const expectedExpiry = createdAt + 90 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });

    test('respects custom lifetime', async () => {
      const { createServerToken } = await import('./token.js');
      const token = createServerToken(7); // 7 days

      const expiresAt = new Date(token.expiresAt).getTime();
      const createdAt = new Date(token.createdAt).getTime();

      const expectedExpiry = createdAt + 7 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });
  });

  describe('createConnectionToken', () => {
    test('creates a valid connection token object', async () => {
      const { createConnectionToken } = await import('./token.js');
      const token = createConnectionToken('test-client-id');

      expect(token).toHaveProperty('value');
      expect(token).toHaveProperty('createdAt');
      expect(token).toHaveProperty('expiresAt');
      expect(token).toHaveProperty('clientId');
      expect(token.clientId).toBe('test-client-id');
    });

    test('sets correct expiration with default lifetime', async () => {
      const { createConnectionToken } = await import('./token.js');
      const token = createConnectionToken('client');

      const expiresAt = new Date(token.expiresAt).getTime();
      const createdAt = new Date(token.createdAt).getTime();

      // Default is 24 hours
      const expectedExpiry = createdAt + 24 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });

    test('respects custom lifetime', async () => {
      const { createConnectionToken } = await import('./token.js');
      const token = createConnectionToken('client', 2); // 2 hours

      const expiresAt = new Date(token.expiresAt).getTime();
      const createdAt = new Date(token.createdAt).getTime();

      const expectedExpiry = createdAt + 2 * 60 * 60 * 1000;
      expect(expiresAt).toBe(expectedExpiry);
    });
  });

  describe('isTokenExpired', () => {
    test('returns false for future expiration', async () => {
      const { isTokenExpired } = await import('./token.js');
      const future = new Date(Date.now() + 60000).toISOString();
      expect(isTokenExpired(future)).toBe(false);
    });

    test('returns true for past expiration', async () => {
      const { isTokenExpired } = await import('./token.js');
      const past = new Date(Date.now() - 60000).toISOString();
      expect(isTokenExpired(past)).toBe(true);
    });

    test('returns true for expired at now', async () => {
      const { isTokenExpired } = await import('./token.js');
      // Use a time slightly in the past to avoid race conditions
      const now = new Date(Date.now() - 1).toISOString();
      expect(isTokenExpired(now)).toBe(true);
    });
  });

  describe('needsRefresh', () => {
    test('returns false when well before threshold', async () => {
      const { needsRefresh } = await import('./token.js');
      // Expires in 24 hours, threshold is 1 hour
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      expect(needsRefresh(expiresAt)).toBe(false);
    });

    test('returns true when within threshold', async () => {
      const { needsRefresh } = await import('./token.js');
      // Expires in 30 minutes, default threshold is 1 hour
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      expect(needsRefresh(expiresAt)).toBe(true);
    });

    test('returns true when expired', async () => {
      const { needsRefresh } = await import('./token.js');
      const past = new Date(Date.now() - 60000).toISOString();
      expect(needsRefresh(past)).toBe(true);
    });

    test('respects custom threshold', async () => {
      const { needsRefresh } = await import('./token.js');
      // Expires in 3 hours
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

      // With 2 hour threshold, should not need refresh
      expect(needsRefresh(expiresAt, 2)).toBe(false);

      // With 4 hour threshold, should need refresh
      expect(needsRefresh(expiresAt, 4)).toBe(true);
    });
  });
});

// ============================================================================
// File-based Token Operations (with temp directory)
// ============================================================================

describe('Token File Operations', () => {
  describe('validateServerToken with invalid token', () => {
    test('returns invalid for wrong token value', async () => {
      const { validateServerToken, getOrCreateServerToken } = await import('./token.js');

      // Ensure a token exists first
      await getOrCreateServerToken();

      // Validate with wrong token
      const result = await validateServerToken('wrong-token-value');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    test('returns valid for correct token', async () => {
      const { validateServerToken, getOrCreateServerToken } = await import('./token.js');

      // Get the actual token
      const { token } = await getOrCreateServerToken();

      // Validate with correct token
      const result = await validateServerToken(token.value);
      expect(result.valid).toBe(true);
      expect(result.expired).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });
});
