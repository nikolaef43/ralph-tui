/**
 * ABOUTME: Token management for remote listener authentication.
 * Handles secure token generation, storage, and rotation.
 * Tokens are stored in ~/.config/ralph-tui/remote.json
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, access, constants } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { RemoteConfig } from './types.js';

/**
 * Path to the remote config file
 */
const REMOTE_CONFIG_DIR = join(homedir(), '.config', 'ralph-tui');
const REMOTE_CONFIG_PATH = join(REMOTE_CONFIG_DIR, 'remote.json');

/**
 * Token length in bytes (32 bytes = 256 bits)
 */
const TOKEN_BYTES = 32;

/**
 * Generate a cryptographically secure token.
 * Returns a URL-safe base64 string.
 */
export function generateToken(): string {
  const bytes = randomBytes(TOKEN_BYTES);
  // Use base64url encoding (URL-safe variant)
  return bytes.toString('base64url');
}

/**
 * Load the remote configuration from disk.
 * Returns null if no config exists.
 */
export async function loadRemoteConfig(): Promise<RemoteConfig | null> {
  try {
    await access(REMOTE_CONFIG_PATH, constants.R_OK);
    const content = await readFile(REMOTE_CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as RemoteConfig;
  } catch {
    return null;
  }
}

/**
 * Save the remote configuration to disk.
 * Creates the directory if it doesn't exist.
 */
export async function saveRemoteConfig(config: RemoteConfig): Promise<void> {
  await mkdir(REMOTE_CONFIG_DIR, { recursive: true });
  await writeFile(REMOTE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get or create the authentication token.
 * On first run, generates a new token and saves it.
 * Returns the token and whether it was newly created.
 */
export async function getOrCreateToken(): Promise<{ token: string; isNew: boolean }> {
  const config = await loadRemoteConfig();

  if (config?.token) {
    return { token: config.token, isNew: false };
  }

  // Generate new token
  const token = generateToken();
  const newConfig: RemoteConfig = {
    token,
    tokenCreatedAt: new Date().toISOString(),
    tokenVersion: 1,
  };

  await saveRemoteConfig(newConfig);
  return { token, isNew: true };
}

/**
 * Rotate the authentication token.
 * Generates a new token and invalidates the old one.
 * Returns the new token.
 */
export async function rotateToken(): Promise<string> {
  const existingConfig = await loadRemoteConfig();
  const newToken = generateToken();

  const newConfig: RemoteConfig = {
    token: newToken,
    tokenCreatedAt: new Date().toISOString(),
    tokenVersion: (existingConfig?.tokenVersion ?? 0) + 1,
  };

  await saveRemoteConfig(newConfig);
  return newToken;
}

/**
 * Validate a token against the stored token.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function validateToken(providedToken: string): Promise<boolean> {
  const config = await loadRemoteConfig();
  if (!config?.token) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const storedToken = config.token;

  // If lengths differ, still do a comparison to maintain constant time
  if (providedToken.length !== storedToken.length) {
    // Compare with stored token anyway to maintain constant time
    let result = 0;
    for (let i = 0; i < storedToken.length; i++) {
      result |= storedToken.charCodeAt(i) ^ (providedToken.charCodeAt(i % providedToken.length) || 0);
    }
    return false;
  }

  // Constant-time comparison
  let result = 0;
  for (let i = 0; i < storedToken.length; i++) {
    result |= storedToken.charCodeAt(i) ^ providedToken.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Get information about the current token (without exposing the full token).
 */
export async function getTokenInfo(): Promise<{
  exists: boolean;
  createdAt?: string;
  version?: number;
  preview?: string;
}> {
  const config = await loadRemoteConfig();

  if (!config?.token) {
    return { exists: false };
  }

  return {
    exists: true,
    createdAt: config.tokenCreatedAt,
    version: config.tokenVersion,
    // Show only first 8 characters for identification
    preview: config.token.slice(0, 8) + '...',
  };
}

// Export paths for testing
export const CONFIG_PATHS = {
  dir: REMOTE_CONFIG_DIR,
  file: REMOTE_CONFIG_PATH,
} as const;
