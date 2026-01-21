/**
 * ABOUTME: Codex CLI agent plugin for OpenAI's codex command.
 * Integrates with Codex CLI for AI-assisted coding.
 * Supports: non-interactive exec mode, JSONL streaming, full-auto mode, sandbox modes.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath } from '../base.js';
import { processAgentEvents, processAgentEventsToSegments, type AgentDisplayEvent } from '../output-formatting.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
  AgentExecutionHandle,
} from '../types.js';

/**
 * Extract a string error message from various error formats.
 * Handles: string, { message: string }, or other objects.
 */
function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    // Fallback: stringify the object
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

/**
 * Parse Codex JSON line into standardized display events.
 * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
 *
 * Codex event types (when using --json flag):
 * - "message": Text output from the LLM (contains content array)
 * - "function_call": Tool/function being called
 * - "function_call_output": Tool execution result
 * - "error": Error from Codex
 */
function parseCodexJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    // Codex uses different event structures - handle common patterns
    if (event.type === 'message' || event.message) {
      // IMPORTANT: Skip user messages - they echo the input prompt
      if (event.role === 'user') {
        return [];
      }
      // Message event with content array (assistant responses)
      const content = event.content || event.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            events.push({ type: 'text', content: part.text });
          } else if (part.type === 'tool_use' || part.type === 'function_call') {
            const toolName = part.name || part.function?.name || 'unknown';
            const toolInput = part.input || part.function?.arguments;
            events.push({ type: 'tool_use', name: toolName, input: toolInput });
          }
        }
      } else if (typeof content === 'string') {
        events.push({ type: 'text', content });
      }
    } else if (event.type === 'function_call' || event.function_call) {
      // Function call event
      const call = event.function_call || event;
      const toolName = call.name || call.function?.name || 'unknown';
      const toolInput = call.arguments || call.input;
      events.push({ type: 'tool_use', name: toolName, input: toolInput });
    } else if (event.type === 'function_call_output' || event.type === 'tool_result') {
      // Function result
      const isError = event.is_error === true || event.error !== undefined;
      if (isError) {
        const errMsg = extractErrorMessage(event.error);
        events.push({ type: 'error', message: errMsg || 'tool execution failed' });
      }
      events.push({ type: 'tool_result' });
    } else if (event.type === 'text' && event.text) {
      // Simple text event
      events.push({ type: 'text', content: event.text });
    } else if (event.type === 'error' || event.error) {
      // Error event
      const errorMsg = extractErrorMessage(event.error) || extractErrorMessage(event.message) || 'Unknown error';
      events.push({ type: 'error', message: errorMsg });
    }

    return events;
  } catch {
    // Not valid JSON - skip silently
    return [];
  }
}

/**
 * Parse Codex JSON stream output into display events.
 */
function parseCodexOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseCodexJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Codex CLI agent plugin implementation.
 * Uses the `codex exec` command for non-interactive AI coding tasks.
 */
export class CodexAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'OpenAI',
    defaultCommand: 'codex',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.codex/skills',
      repo: '.codex/skills',
    },
  };

  private model?: string;
  private fullAuto = true;
  private sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write';
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.fullAuto === 'boolean') {
      this.fullAuto = config.fullAuto;
    }

    if (typeof config.sandbox === 'string' &&
        ['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandbox)) {
      this.sandbox = config.sandbox as typeof this.sandbox;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Codex CLI not found in PATH. Install from: https://github.com/openai/codex`,
      };
    }

    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

    // Store the detected path for use in execute()
    this.commandPath = findResult.path;

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      // Only use shell on Windows where direct spawn may not work
      const useShell = process.platform === 'win32';
      const proc = spawn(command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: `Failed to execute: ${error.message}` });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          if (!versionMatch?.[1]) {
            resolve({
              success: false,
              error: `Unable to parse codex version output: ${stdout}`,
            });
            return;
          }
          resolve({ success: true, version: versionMatch[1] });
        } else {
          resolve({ success: false, error: stderr || `Exited with code ${code}` });
        }
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'text',
        default: '',
        required: false,
        help: 'OpenAI model to use (leave empty for default)',
      },
      {
        id: 'fullAuto',
        prompt: 'Enable full-auto mode?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Auto-approve all actions for autonomous operation',
      },
      {
        id: 'sandbox',
        prompt: 'Sandbox mode:',
        type: 'select',
        choices: [
          { value: 'read-only', label: 'Read Only', description: 'No file modifications' },
          { value: 'workspace-write', label: 'Workspace Write', description: 'Can modify workspace files' },
          { value: 'danger-full-access', label: 'Full Access', description: 'Full system access (dangerous)' },
        ],
        default: 'workspace-write',
        required: false,
        help: 'Sandbox restrictions for file access',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use exec subcommand for non-interactive mode
    args.push('exec');

    // Full-auto mode
    if (this.fullAuto) {
      args.push('--full-auto');
    }

    // Always use JSON format for output parsing
    // This gives us structured events (text, tool_use, etc.) that we can format nicely
    args.push('--json');

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Sandbox mode
    args.push('--sandbox', this.sandbox);

    // Note: Prompt is passed via stdin (see getStdinInput) to avoid
    // Windows shell interpretation issues with special characters.

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters in prompts
   * on Windows where shell: true is required for wrapper script execution.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse Codex JSON output.
   * Wraps the onStdout/onStdoutSegments callbacks to parse JSONL events and extract displayable content.
   * Also forwards raw JSONL messages to onJsonlMessage for subagent tracing.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Wrap callbacks to parse JSON events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            // Parse raw JSONL lines and forward to onJsonlMessage for subagent tracing
            if (options?.onJsonlMessage) {
              for (const line of data.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && trimmed.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(trimmed);
                    options.onJsonlMessage(parsed);
                  } catch {
                    // Not valid JSON, skip
                  }
                }
              }
            }

            // Process for display events
            const events = parseCodexOutputToEvents(data);
            if (events.length > 0) {
              // Call TUI-native segments callback if provided
              if (options?.onStdoutSegments) {
                const segments = processAgentEventsToSegments(events);
                if (segments.length > 0) {
                  options.onStdoutSegments(segments);
                }
              }
              // Also call legacy string callback if provided
              if (options?.onStdout) {
                const parsed = processAgentEvents(events);
                if (parsed.length > 0) {
                  options.onStdout(parsed);
                }
              }
            }
          }
        : undefined,
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(_model: string): string | null {
    // Codex accepts various OpenAI models, no strict validation
    return null;
  }
}

const createCodexAgent: AgentPluginFactory = () => new CodexAgentPlugin();

export default createCodexAgent;
