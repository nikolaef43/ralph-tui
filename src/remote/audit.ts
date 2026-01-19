/**
 * ABOUTME: Audit logging for remote listener actions.
 * All remote actions are logged with timestamp, client identifier, and action details.
 * Logs are stored in ~/.config/ralph-tui/audit.log as JSONL (one JSON object per line).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import type { AuditLogEntry } from './types.js';

/**
 * Path to the audit log file
 */
const AUDIT_LOG_DIR = join(homedir(), '.config', 'ralph-tui');
const AUDIT_LOG_PATH = join(AUDIT_LOG_DIR, 'audit.log');

/**
 * Maximum audit log size in bytes (10MB)
 */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * AuditLogger class for logging remote actions.
 */
export class AuditLogger {
  private logPath: string;
  private logDir: string;

  constructor(logPath: string = AUDIT_LOG_PATH) {
    this.logPath = logPath;
    this.logDir = join(logPath, '..');
  }

  /**
   * Log an action to the audit log.
   */
  async log(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Ensure directory exists
    await mkdir(this.logDir, { recursive: true });

    // Rotate if needed
    await this.rotateIfNeeded();

    // Append entry as JSONL
    const line = JSON.stringify(fullEntry) + '\n';
    await appendFile(this.logPath, line, 'utf-8');
  }

  /**
   * Log a successful action.
   */
  async logSuccess(
    clientId: string,
    action: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      clientId,
      action,
      details,
      success: true,
    });
  }

  /**
   * Log a failed action.
   */
  async logFailure(
    clientId: string,
    action: string,
    error: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      clientId,
      action,
      details,
      success: false,
      error,
    });
  }

  /**
   * Log an authentication attempt.
   */
  async logAuth(clientId: string, success: boolean, error?: string): Promise<void> {
    if (success) {
      await this.logSuccess(clientId, 'auth', { type: 'token_auth' });
    } else {
      await this.logFailure(clientId, 'auth', error ?? 'Authentication failed', {
        type: 'token_auth',
      });
    }
  }

  /**
   * Log a connection event.
   */
  async logConnection(clientId: string, event: 'connect' | 'disconnect'): Promise<void> {
    await this.logSuccess(clientId, `connection_${event}`);
  }

  /**
   * Log a server event.
   */
  async logServerEvent(
    event: 'start' | 'stop' | 'error',
    details?: Record<string, unknown>
  ): Promise<void> {
    if (event === 'error') {
      await this.logFailure('server', `server_${event}`, details?.error as string ?? 'Unknown error', details);
    } else {
      await this.logSuccess('server', `server_${event}`, details);
    }
  }

  /**
   * Check if log rotation is needed and perform it.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await stat(this.logPath);
      if (stats.size > MAX_LOG_SIZE) {
        // Rename current log to .old
        const { rename, unlink } = await import('node:fs/promises');
        const oldPath = this.logPath + '.old';

        // Remove existing .old file if present
        try {
          await unlink(oldPath);
        } catch {
          // Ignore if doesn't exist
        }

        // Rename current to .old
        await rename(this.logPath, oldPath);
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  /**
   * Read recent log entries.
   * @param limit Maximum number of entries to return (most recent first)
   */
  async readRecent(limit: number = 100): Promise<AuditLogEntry[]> {
    try {
      const content = await readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Take last N lines and parse
      const recentLines = lines.slice(-limit);
      const entries: AuditLogEntry[] = [];

      for (const line of recentLines) {
        try {
          entries.push(JSON.parse(line) as AuditLogEntry);
        } catch {
          // Skip malformed lines
        }
      }

      // Return in reverse chronological order
      return entries.reverse();
    } catch {
      return [];
    }
  }
}

/**
 * Create an audit logger with default configuration.
 */
export function createAuditLogger(): AuditLogger {
  return new AuditLogger();
}

// Export paths for testing
export const AUDIT_PATHS = {
  dir: AUDIT_LOG_DIR,
  file: AUDIT_LOG_PATH,
} as const;
