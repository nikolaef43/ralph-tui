/**
 * ABOUTME: Tests for the AuditLogger class.
 * Covers logging operations, log rotation, and reading recent entries.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogger } from './audit.js';

describe('AuditLogger', () => {
  let tempDir: string;
  let logPath: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'audit-test-'));
    logPath = join(tempDir, 'audit.log');
    logger = new AuditLogger(logPath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('log', () => {
    test('creates log file and writes entry', async () => {
      await logger.log({
        clientId: 'test-client',
        action: 'test_action',
        success: true,
      });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('test-client');
      expect(entry.action).toBe('test_action');
      expect(entry.success).toBe(true);
      expect(entry.timestamp).toBeDefined();
    });

    test('appends multiple entries as JSONL', async () => {
      await logger.log({ clientId: 'client1', action: 'action1', success: true });
      await logger.log({ clientId: 'client2', action: 'action2', success: false, error: 'test error' });

      const content = await readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);

      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);

      expect(entry1.clientId).toBe('client1');
      expect(entry2.clientId).toBe('client2');
      expect(entry2.error).toBe('test error');
    });
  });

  describe('logSuccess', () => {
    test('logs success entry with details', async () => {
      await logger.logSuccess('client-id', 'my_action', { key: 'value' });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('client-id');
      expect(entry.action).toBe('my_action');
      expect(entry.success).toBe(true);
      expect(entry.details).toEqual({ key: 'value' });
      expect(entry.error).toBeUndefined();
    });
  });

  describe('logFailure', () => {
    test('logs failure entry with error message', async () => {
      await logger.logFailure('client-id', 'failed_action', 'Something went wrong', { context: 'test' });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('client-id');
      expect(entry.action).toBe('failed_action');
      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Something went wrong');
      expect(entry.details).toEqual({ context: 'test' });
    });
  });

  describe('logAuth', () => {
    test('logs successful auth', async () => {
      await logger.logAuth('auth-client', true, undefined, { ip: '127.0.0.1' });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('auth-client');
      expect(entry.action).toBe('auth');
      expect(entry.success).toBe(true);
      expect(entry.details.type).toBe('token_auth');
      expect(entry.details.ip).toBe('127.0.0.1');
    });

    test('logs failed auth with error', async () => {
      await logger.logAuth('auth-client', false, 'Invalid token');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('auth-client');
      expect(entry.action).toBe('auth');
      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Invalid token');
    });

    test('logs failed auth with default error message', async () => {
      await logger.logAuth('auth-client', false);

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.error).toBe('Authentication failed');
    });
  });

  describe('logAction', () => {
    test('logs successful action', async () => {
      await logger.logAction('client', 'custom_action', true, undefined, { data: 123 });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.action).toBe('custom_action');
      expect(entry.success).toBe(true);
      expect(entry.details).toEqual({ data: 123 });
    });

    test('logs failed action with error', async () => {
      await logger.logAction('client', 'custom_action', false, 'Action failed');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Action failed');
    });

    test('logs failed action with default error message', async () => {
      await logger.logAction('client', 'custom_action', false);

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.error).toBe('Action failed');
    });
  });

  describe('logConnection', () => {
    test('logs connect event', async () => {
      await logger.logConnection('conn-client', 'connect');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('conn-client');
      expect(entry.action).toBe('connection_connect');
      expect(entry.success).toBe(true);
    });

    test('logs disconnect event', async () => {
      await logger.logConnection('conn-client', 'disconnect');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.action).toBe('connection_disconnect');
    });
  });

  describe('logServerEvent', () => {
    test('logs server start event', async () => {
      await logger.logServerEvent('start', { port: 7890 });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.clientId).toBe('server');
      expect(entry.action).toBe('server_start');
      expect(entry.success).toBe(true);
      expect(entry.details.port).toBe(7890);
    });

    test('logs server stop event', async () => {
      await logger.logServerEvent('stop');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.action).toBe('server_stop');
      expect(entry.success).toBe(true);
    });

    test('logs server error event', async () => {
      await logger.logServerEvent('error', { error: 'Port in use' });

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.action).toBe('server_error');
      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Port in use');
    });

    test('logs server error with default message', async () => {
      await logger.logServerEvent('error');

      const content = await readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.error).toBe('Unknown error');
    });
  });

  describe('readRecent', () => {
    test('returns empty array when no log file', async () => {
      const entries = await logger.readRecent();
      expect(entries).toEqual([]);
    });

    test('reads entries in reverse chronological order', async () => {
      await logger.logSuccess('client', 'action1');
      await logger.logSuccess('client', 'action2');
      await logger.logSuccess('client', 'action3');

      const entries = await logger.readRecent();

      expect(entries.length).toBe(3);
      expect(entries[0].action).toBe('action3'); // Most recent first
      expect(entries[1].action).toBe('action2');
      expect(entries[2].action).toBe('action1');
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.logSuccess('client', `action${i}`);
      }

      const entries = await logger.readRecent(3);

      expect(entries.length).toBe(3);
      expect(entries[0].action).toBe('action9');
      expect(entries[1].action).toBe('action8');
      expect(entries[2].action).toBe('action7');
    });

    test('handles malformed lines gracefully', async () => {
      // Write valid entry
      await logger.logSuccess('client', 'valid_action');

      // Manually append malformed line
      const { appendFile } = await import('node:fs/promises');
      await appendFile(logPath, 'not valid json\n', 'utf-8');

      // Write another valid entry
      await logger.logSuccess('client', 'another_valid');

      const entries = await logger.readRecent();

      // Should have 2 valid entries, skipping the malformed one
      expect(entries.length).toBe(2);
    });
  });
});
