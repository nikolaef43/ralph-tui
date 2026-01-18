/**
 * ABOUTME: Tests for OpenCode JSONL output parser for subagent tracing.
 * Verifies parsing of OpenCode's Task tool invocations and conversion
 * to Claude-compatible message format.
 */

import { describe, test, expect } from 'bun:test';
import {
  parseOpenCodeJsonlLine,
  isOpenCodeTaskTool,
  openCodeTaskToClaudeMessages,
  createOpenCodeStreamingJsonlParser,
  isOpenCodeJsonlMessage,
  type OpenCodeJsonlMessage,
} from '../../../src/plugins/agents/opencode/outputParser.js';

describe('OpenCode Output Parser', () => {
  describe('parseOpenCodeJsonlLine', () => {
    test('parses valid tool_use event', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: 1768748987339,
        sessionID: 'ses_test',
        part: {
          id: 'prt_123',
          type: 'tool',
          callID: 'call_abc',
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Test task',
              prompt: 'Do something',
              subagent_type: 'explore',
            },
            output: 'Task completed successfully',
            time: {
              start: 1000,
              end: 2000,
            },
          },
        },
      });

      const result = parseOpenCodeJsonlLine(line);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe('tool_use');
        expect(result.message.source).toBe('opencode');
        expect(result.message.part?.tool).toBe('task');
        expect(result.message.part?.state?.input?.description).toBe('Test task');
      }
    });

    test('parses text event', () => {
      const line = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        part: {
          text: 'Hello, world!',
        },
      });

      const result = parseOpenCodeJsonlLine(line);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe('text');
        expect(result.message.part?.text).toBe('Hello, world!');
      }
    });

    test('handles empty line', () => {
      const result = parseOpenCodeJsonlLine('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Empty line');
      }
    });

    test('handles invalid JSON', () => {
      const result = parseOpenCodeJsonlLine('not valid json');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('');
      }
    });

    test('strips ANSI escape sequences', () => {
      const line = '\x1b[32m' + JSON.stringify({ type: 'text' }) + '\x1b[0m';

      const result = parseOpenCodeJsonlLine(line);

      expect(result.success).toBe(true);
    });

    test('extracts JSON from line with prefix garbage', () => {
      const line = 'garbage prefix ' + JSON.stringify({ type: 'text' });

      const result = parseOpenCodeJsonlLine(line);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.message.type).toBe('text');
      }
    });
  });

  describe('isOpenCodeTaskTool', () => {
    test('returns true for task tool_use event', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'task',
        },
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(true);
    });

    test('returns true for Task (uppercase) tool_use event', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'Task',
        },
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(true);
    });

    test('returns true for TASK (all caps) tool_use event', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'TASK',
        },
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(true);
    });

    test('returns false for non-task tool', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'bash',
        },
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(false);
    });

    test('returns false for text event', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'text',
        part: {
          text: 'Hello',
        },
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(false);
    });

    test('returns false for missing part', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        raw: {},
      };

      expect(isOpenCodeTaskTool(message)).toBe(false);
    });
  });

  describe('openCodeTaskToClaudeMessages', () => {
    test('converts task tool to spawn and complete messages', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 1234567890,
        part: {
          callID: 'call_test123',
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Explore codebase',
              prompt: 'Find all TypeScript files',
              subagent_type: 'explore',
            },
            output: 'Found 42 files',
          },
        },
        raw: {},
      };

      const results = openCodeTaskToClaudeMessages(message);

      expect(results.length).toBe(2);

      // First message should be spawn (tool_use)
      const spawnMsg = results[0];
      expect(spawnMsg.type).toBe('assistant');
      expect(spawnMsg.tool?.name).toBe('Task');
      expect(spawnMsg.tool?.input?.description).toBe('Explore codebase');
      expect(spawnMsg.tool?.input?.subagent_type).toBe('explore');

      // Second message should be complete (tool_result)
      const completeMsg = results[1];
      expect(completeMsg.type).toBe('result');
      expect(completeMsg.result).toBe('Found 42 files');
    });

    test('generates call ID from timestamp when missing', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 9999999999,
        part: {
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Test',
              prompt: 'Test prompt',
              subagent_type: 'general',
            },
            output: 'Done',
          },
        },
        raw: {},
      };

      const results = openCodeTaskToClaudeMessages(message);

      expect(results.length).toBe(2);
      expect(results[0].raw.tool_use_id).toContain('opencode_9999999999');
    });

    test('returns empty array for non-task tool', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'bash',
          state: {
            input: {},
          },
        },
        raw: {},
      };

      const results = openCodeTaskToClaudeMessages(message);

      expect(results).toEqual([]);
    });

    test('returns empty array when no input', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'task',
          state: {
            status: 'pending',
          },
        },
        raw: {},
      };

      const results = openCodeTaskToClaudeMessages(message);

      expect(results).toEqual([]);
    });

    test('only generates spawn message when not completed', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 1234567890,
        part: {
          callID: 'call_pending',
          tool: 'task',
          state: {
            status: 'running',
            input: {
              description: 'In progress task',
              prompt: 'Do work',
              subagent_type: 'general',
            },
            // No output - task still running
          },
        },
        raw: {},
      };

      const results = openCodeTaskToClaudeMessages(message);

      // Should only have spawn message
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('assistant');
    });
  });

  describe('createOpenCodeStreamingJsonlParser', () => {
    test('buffers and parses complete lines', () => {
      const parser = createOpenCodeStreamingJsonlParser();

      // Push partial line
      const results1 = parser.push('{"type":"text"');
      expect(results1).toEqual([]);

      // Complete the line
      const results2 = parser.push('}\n');
      expect(results2.length).toBe(1);
      expect(results2[0].success).toBe(true);
    });

    test('parses multiple lines in one chunk', () => {
      const parser = createOpenCodeStreamingJsonlParser();

      const chunk = '{"type":"text"}\n{"type":"tool_use"}\n';
      const results = parser.push(chunk);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    test('flushes remaining buffered content', () => {
      const parser = createOpenCodeStreamingJsonlParser();

      // Push without trailing newline
      parser.push('{"type":"text"}');
      const results = parser.flush();

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
    });

    test('getState returns accumulated messages', () => {
      const parser = createOpenCodeStreamingJsonlParser();

      parser.push('{"type":"text"}\n');
      parser.push('{"type":"tool_use"}\n');

      const state = parser.getState();
      expect(state.messages.length).toBe(2);
    });
  });

  describe('isOpenCodeJsonlMessage', () => {
    test('returns true for valid OpenCode message', () => {
      const message: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'text',
        raw: {},
      };

      expect(isOpenCodeJsonlMessage(message)).toBe(true);
    });

    test('returns false for Droid message', () => {
      const message = {
        source: 'droid',
        type: 'text',
        raw: {},
      };

      expect(isOpenCodeJsonlMessage(message)).toBe(false);
    });

    test('returns false for null', () => {
      expect(isOpenCodeJsonlMessage(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isOpenCodeJsonlMessage(undefined)).toBe(false);
    });

    test('returns false for object without source', () => {
      const message = {
        type: 'text',
        raw: {},
      };

      expect(isOpenCodeJsonlMessage(message)).toBe(false);
    });
  });
});

describe('OpenCode real-world JSONL parsing', () => {
  test('parses actual OpenCode Task tool output', () => {
    // This is a real example from OpenCode output
    const realOutput = `{"type":"tool_use","timestamp":1768748987339,"sessionID":"ses_42e590b1fffekYAKSGX2iPrFhp","part":{"id":"prt_bd1a706fa001Sh4ta6mW1mbvrj","sessionID":"ses_42e590b1fffekYAKSGX2iPrFhp","messageID":"msg_bd1a6f521001pIQbldfrij7p11","type":"tool","callID":"call_LGGlb3mkL4VDUj0LMSE3Lpbf","tool":"task","state":{"status":"completed","input":{"description":"Explore repo structure","prompt":"Briefly inspect current directory structure.","subagent_type":"explore","tools":{"background_task":false,"call_omo_agent":false}},"output":"Found 30 files","title":"Explore repo structure","metadata":{"summary":[],"sessionId":"ses_42e58f5bbffeiOzOYP7HoJBHaT","truncated":false},"time":{"start":1768748943936,"end":1768748987338}},"metadata":{"openai":{"itemId":"fc_0f1909ab"}}}}`;

    const result = parseOpenCodeJsonlLine(realOutput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message.type).toBe('tool_use');
      expect(result.message.part?.tool).toBe('task');
      expect(result.message.part?.state?.input?.subagent_type).toBe('explore');
      expect(result.message.part?.state?.output).toBe('Found 30 files');

      // Now convert to Claude format
      const claudeMessages = openCodeTaskToClaudeMessages(result.message);

      expect(claudeMessages.length).toBe(2);

      // Spawn message
      expect(claudeMessages[0].tool?.name).toBe('Task');
      expect(claudeMessages[0].tool?.input?.description).toBe('Explore repo structure');
      expect(claudeMessages[0].tool?.input?.subagent_type).toBe('explore');

      // Complete message
      expect(claudeMessages[1].type).toBe('result');
      expect(claudeMessages[1].result).toBe('Found 30 files');
    }
  });
});
