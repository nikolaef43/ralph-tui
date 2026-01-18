/**
 * ABOUTME: Integration tests for subagent tracing across different agent formats.
 * Tests that OpenCode and Claude Task tool invocations are correctly parsed
 * and converted to subagent events by the SubagentTraceParser.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SubagentTraceParser } from '../../../src/plugins/agents/tracing/parser.js';
import type { ClaudeJsonlMessage } from '../../../src/plugins/agents/builtin/claude.js';
import {
  isOpenCodeTaskTool,
  openCodeTaskToClaudeMessages,
  type OpenCodeJsonlMessage,
} from '../../../src/plugins/agents/opencode/outputParser.js';

describe('Subagent Tracing Integration', () => {
  let parser: SubagentTraceParser;

  beforeEach(() => {
    parser = new SubagentTraceParser();
  });

  describe('Claude format Task tool', () => {
    test('detects Task tool invocation from assistant message', () => {
      const message: ClaudeJsonlMessage = {
        type: 'assistant',
        tool: {
          name: 'Task',
          input: {
            description: 'Explore codebase',
            prompt: 'Find TypeScript files',
            subagent_type: 'Explore',
          },
        },
        raw: {
          type: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'Task',
              input: {
                description: 'Explore codebase',
                prompt: 'Find TypeScript files',
                subagent_type: 'Explore',
              },
            },
          ],
        },
      };

      const events = parser.processMessage(message);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('spawn');
      if (events[0].type === 'spawn') {
        expect(events[0].agentType).toBe('Explore');
        expect(events[0].description).toBe('Explore codebase');
      }
    });

    test('detects Task tool completion from tool_result', () => {
      // First spawn the subagent
      const spawnMessage: ClaudeJsonlMessage = {
        type: 'assistant',
        tool: {
          name: 'Task',
          input: {
            description: 'Test task',
            prompt: 'Do something',
            subagent_type: 'general',
          },
        },
        raw: {
          type: 'assistant',
          tool_use_id: 'call_abc',
          content: [
            {
              type: 'tool_use',
              id: 'call_abc',
              name: 'Task',
              input: {
                description: 'Test task',
                prompt: 'Do something',
                subagent_type: 'general',
              },
            },
          ],
        },
      };

      parser.processMessage(spawnMessage);
      expect(parser.getActiveSubagents().length).toBe(1);

      // Now complete it
      const completeMessage: ClaudeJsonlMessage = {
        type: 'result',
        result: 'Task completed successfully',
        raw: {
          type: 'tool_result',
          tool_use_id: 'call_abc',
          content: 'Task completed successfully',
        },
      };

      const events = parser.processMessage(completeMessage);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('complete');
      expect(parser.getActiveSubagents().length).toBe(0);
    });

    test('handles case-insensitive tool name', () => {
      const message: ClaudeJsonlMessage = {
        type: 'assistant',
        tool: {
          name: 'task', // lowercase
          input: {
            description: 'Test',
            prompt: 'Test prompt',
            subagent_type: 'explore',
          },
        },
        raw: {
          type: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_lower',
              name: 'task',
              input: {
                description: 'Test',
                prompt: 'Test prompt',
                subagent_type: 'explore',
              },
            },
          ],
        },
      };

      const events = parser.processMessage(message);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('spawn');
    });
  });

  describe('OpenCode format Task tool', () => {
    test('isOpenCodeTaskTool detects task tool correctly', () => {
      const taskMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'task',
          state: {
            input: { description: 'Test', prompt: 'Test', subagent_type: 'explore' },
          },
        },
        raw: {},
      };

      const nonTaskMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        part: {
          tool: 'bash',
          state: { input: {} },
        },
        raw: {},
      };

      const textMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'text',
        part: { text: 'Hello' },
        raw: {},
      };

      expect(isOpenCodeTaskTool(taskMessage)).toBe(true);
      expect(isOpenCodeTaskTool(nonTaskMessage)).toBe(false);
      expect(isOpenCodeTaskTool(textMessage)).toBe(false);
    });

    test('converts OpenCode Task to Claude format for parser', () => {
      const openCodeMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 1234567890,
        part: {
          callID: 'call_oc_123',
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Explore files',
              prompt: 'List all TypeScript files',
              subagent_type: 'explore',
            },
            output: 'Found 42 TypeScript files',
          },
        },
        raw: {},
      };

      const claudeMessages = openCodeTaskToClaudeMessages(openCodeMessage);

      // Should produce spawn + complete messages
      expect(claudeMessages.length).toBe(2);

      // Spawn message
      expect(claudeMessages[0].type).toBe('assistant');
      expect(claudeMessages[0].tool?.name).toBe('Task');
      expect(claudeMessages[0].tool?.input?.description).toBe('Explore files');
      expect(claudeMessages[0].tool?.input?.subagent_type).toBe('explore');

      // Complete message
      expect(claudeMessages[1].type).toBe('result');
      expect(claudeMessages[1].result).toBe('Found 42 TypeScript files');
    });

    test('OpenCode converted messages work with SubagentTraceParser', () => {
      const openCodeMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 1234567890,
        part: {
          callID: 'call_oc_456',
          tool: 'task',
          state: {
            status: 'completed',
            input: {
              description: 'Build feature',
              prompt: 'Implement the login page',
              subagent_type: 'general',
            },
            output: 'Login page implemented',
          },
        },
        raw: {},
      };

      // Convert and process
      const claudeMessages = openCodeTaskToClaudeMessages(openCodeMessage);

      let spawnCount = 0;
      let completeCount = 0;
      for (const msg of claudeMessages) {
        const events = parser.processMessage(msg);
        for (const event of events) {
          if (event.type === 'spawn') spawnCount++;
          if (event.type === 'complete') completeCount++;
        }
      }

      // Should have spawn and complete events
      expect(spawnCount).toBe(1);
      expect(completeCount).toBe(1);

      // Verify state
      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.running).toBe(0);
    });

    test('handles OpenCode Task without output (still running)', () => {
      const openCodeMessage: OpenCodeJsonlMessage = {
        source: 'opencode',
        type: 'tool_use',
        timestamp: 1234567890,
        part: {
          callID: 'call_running',
          tool: 'task',
          state: {
            status: 'running',
            input: {
              description: 'Long task',
              prompt: 'Do something complex',
              subagent_type: 'general',
            },
            // No output yet
          },
        },
        raw: {},
      };

      const claudeMessages = openCodeTaskToClaudeMessages(openCodeMessage);

      // Should only produce spawn message (no complete)
      expect(claudeMessages.length).toBe(1);
      expect(claudeMessages[0].type).toBe('assistant');

      // Process through parser
      const events = parser.processMessage(claudeMessages[0]);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('spawn');
      expect(parser.getActiveSubagents().length).toBe(1);
    });
  });

  describe('Engine onJsonlMessage format detection', () => {
    /**
     * Simulates the engine's onJsonlMessage handler logic for detecting
     * and processing different message formats.
     */
    function processJsonlMessage(
      message: Record<string, unknown>,
      parser: SubagentTraceParser
    ): void {
      // Check if this is OpenCode format (has 'part' with 'tool' property)
      const part = message.part as Record<string, unknown> | undefined;
      if (message.type === 'tool_use' && part?.tool) {
        // OpenCode format - convert using OpenCode parser
        const openCodeMessage: OpenCodeJsonlMessage = {
          source: 'opencode',
          type: message.type as string,
          timestamp: message.timestamp as number | undefined,
          sessionID: message.sessionID as string | undefined,
          part: part as OpenCodeJsonlMessage['part'],
          raw: message,
        };
        // Check if it's a Task tool and convert to Claude format
        if (isOpenCodeTaskTool(openCodeMessage)) {
          for (const claudeMessage of openCodeTaskToClaudeMessages(openCodeMessage)) {
            parser.processMessage(claudeMessage);
          }
        }
        return;
      }

      // Claude format - convert raw JSON to ClaudeJsonlMessage format
      const claudeMessage: ClaudeJsonlMessage = {
        type: message.type as string | undefined,
        message: message.message as string | undefined,
        tool: message.tool as { name?: string; input?: Record<string, unknown> } | undefined,
        result: message.result,
        raw: message,
      };
      parser.processMessage(claudeMessage);
    }

    test('detects and processes OpenCode format', () => {
      const openCodeRaw = {
        type: 'tool_use',
        timestamp: 1234567890,
        sessionID: 'ses_test',
        part: {
          tool: 'task',
          callID: 'call_test',
          state: {
            status: 'completed',
            input: {
              description: 'OpenCode task',
              prompt: 'Do something',
              subagent_type: 'explore',
            },
            output: 'Done',
          },
        },
      };

      processJsonlMessage(openCodeRaw, parser);

      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(1);
      expect(summary.completed).toBe(1);
    });

    test('detects and processes Claude format', () => {
      const claudeRaw = {
        type: 'assistant',
        tool: {
          name: 'Task',
          input: {
            description: 'Claude task',
            prompt: 'Do something',
            subagent_type: 'Explore',
          },
        },
        content: [
          {
            type: 'tool_use',
            id: 'call_claude',
            name: 'Task',
            input: {
              description: 'Claude task',
              prompt: 'Do something',
              subagent_type: 'Explore',
            },
          },
        ],
      };

      processJsonlMessage(claudeRaw, parser);

      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(1);
      expect(summary.running).toBe(1);
    });

    test('ignores non-Task tool_use events', () => {
      const bashToolRaw = {
        type: 'tool_use',
        part: {
          tool: 'bash',
          state: {
            input: { command: 'ls -la' },
          },
        },
      };

      processJsonlMessage(bashToolRaw, parser);

      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(0);
    });

    test('processes multiple messages correctly', () => {
      // OpenCode task
      processJsonlMessage({
        type: 'tool_use',
        part: {
          tool: 'task',
          callID: 'oc_1',
          state: {
            status: 'completed',
            input: { description: 'Task 1', prompt: 'P1', subagent_type: 'explore' },
            output: 'Done 1',
          },
        },
      }, parser);

      // Claude task (spawn only)
      processJsonlMessage({
        type: 'assistant',
        tool: {
          name: 'Task',
          input: { description: 'Task 2', prompt: 'P2', subagent_type: 'general' },
        },
        content: [
          {
            type: 'tool_use',
            id: 'claude_1',
            name: 'Task',
            input: { description: 'Task 2', prompt: 'P2', subagent_type: 'general' },
          },
        ],
      }, parser);

      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(2);
      expect(summary.completed).toBe(1); // OpenCode task completed
      expect(summary.running).toBe(1);   // Claude task still running
    });
  });

  describe('Subagent hierarchy tracking', () => {
    test('tracks parent-child relationships', () => {
      // Spawn parent
      parser.processMessage({
        type: 'assistant',
        tool: {
          name: 'Task',
          input: { description: 'Parent', prompt: 'P', subagent_type: 'general' },
        },
        raw: {
          type: 'assistant',
          content: [{ type: 'tool_use', id: 'parent', name: 'Task', input: {} }],
        },
      });

      // Spawn child while parent is active
      parser.processMessage({
        type: 'assistant',
        tool: {
          name: 'Task',
          input: { description: 'Child', prompt: 'C', subagent_type: 'explore' },
        },
        raw: {
          type: 'assistant',
          content: [{ type: 'tool_use', id: 'child', name: 'Task', input: {} }],
        },
      });

      const subagents = parser.getAllSubagents();
      expect(subagents.length).toBe(2);

      // Find child and verify it has parent
      const child = subagents.find(s => s.description === 'Child');
      expect(child).toBeDefined();
      expect(child?.parentId).toBeDefined();

      // Find parent and verify it has child
      const parent = subagents.find(s => s.description === 'Parent');
      expect(parent).toBeDefined();
      expect(parent?.childIds.length).toBe(1);
    });

    test('tracks maximum depth', () => {
      // Create 3 levels of nesting
      for (let i = 0; i < 3; i++) {
        parser.processMessage({
          type: 'assistant',
          tool: {
            name: 'Task',
            input: { description: `Level ${i}`, prompt: 'P', subagent_type: 'general' },
          },
          raw: {
            type: 'assistant',
            content: [{ type: 'tool_use', id: `level_${i}`, name: 'Task', input: {} }],
          },
        });
      }

      const summary = parser.getSummary();
      expect(summary.maxDepth).toBe(3);
    });
  });

  describe('Summary and statistics', () => {
    test('tracks agent type distribution', () => {
      // Spawn different agent types
      const types = ['explore', 'general', 'explore', 'build'];

      for (let i = 0; i < types.length; i++) {
        const claudeMessages = openCodeTaskToClaudeMessages({
          source: 'opencode',
          type: 'tool_use',
          part: {
            tool: 'task',
            callID: `call_${i}`,
            state: {
              status: 'completed',
              input: { description: `Task ${i}`, prompt: 'P', subagent_type: types[i] },
              output: 'Done',
            },
          },
          raw: {},
        });

        for (const msg of claudeMessages) {
          parser.processMessage(msg);
        }
      }

      const summary = parser.getSummary();
      expect(summary.byAgentType['explore']).toBe(2);
      expect(summary.byAgentType['general']).toBe(1);
      expect(summary.byAgentType['build']).toBe(1);
    });

    test('tracks total duration', () => {
      // Process a completed task
      const claudeMessages = openCodeTaskToClaudeMessages({
        source: 'opencode',
        type: 'tool_use',
        timestamp: Date.now(),
        part: {
          tool: 'task',
          callID: 'call_timed',
          state: {
            status: 'completed',
            input: { description: 'Timed task', prompt: 'P', subagent_type: 'general' },
            output: 'Done',
          },
        },
        raw: {},
      });

      for (const msg of claudeMessages) {
        parser.processMessage(msg);
      }

      const summary = parser.getSummary();
      expect(summary.totalSpawned).toBe(1);
      expect(summary.completed).toBe(1);
      // Duration should be tracked (though it might be 0 or very small in tests)
      expect(typeof summary.totalDurationMs).toBe('number');
    });
  });
});
