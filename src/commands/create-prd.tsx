/**
 * ABOUTME: Create-PRD command for ralph-tui.
 * Uses AI-powered conversation to create Product Requirements Documents.
 * After PRD generation, shows split view with PRD preview and tracker options.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { PrdChatApp } from '../tui/components/PrdChatApp.js';
import { loadStoredConfig, requireSetup } from '../config/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import type { AgentPlugin, AgentPluginConfig } from '../plugins/agents/types.js';

/**
 * Command-line arguments for the create-prd command.
 */
export interface CreatePrdArgs {
  /** Working directory */
  cwd?: string;

  /** Output directory for PRD files */
  output?: string;

  /** Number of user stories to generate */
  stories?: number;

  /** Force overwrite of existing files */
  force?: boolean;

  /** Override agent plugin */
  agent?: string;

  /** Timeout for agent calls in milliseconds */
  timeout?: number;
}

/**
 * Parse create-prd command arguments.
 */
export function parseCreatePrdArgs(args: string[]): CreatePrdArgs {
  const result: CreatePrdArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--cwd' || arg === '-C') {
      result.cwd = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--stories' || arg === '-n') {
      const count = parseInt(args[++i] ?? '', 10);
      if (!isNaN(count)) {
        result.stories = count;
      }
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--agent' || arg === '-a') {
      result.agent = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      const timeout = parseInt(args[++i] ?? '', 10);
      if (!isNaN(timeout)) {
        result.timeout = timeout;
      }
    } else if (arg === '--help' || arg === '-h') {
      printCreatePrdHelp();
      process.exit(0);
    }
  }

  return result;
}

/**
 * Print help for the create-prd command.
 */
export function printCreatePrdHelp(): void {
  console.log(`
ralph-tui create-prd - Create a new PRD with AI assistance

Usage: ralph-tui create-prd [options]
       ralph-tui prime [options]

Options:
  --cwd, -C <path>       Working directory (default: current directory)
  --output, -o <dir>     Output directory for PRD files (default: ./tasks)
  --agent, -a <name>     Agent plugin to use (default: from config)
  --timeout, -t <ms>     Timeout for AI agent calls (default: 180000)
  --force, -f            Overwrite existing files without prompting
  --help, -h             Show this help message

Description:
  Creates a Product Requirements Document (PRD) through an AI-powered conversation.

  The AI agent (using the ralph-tui-prd skill):
  1. Asks about the feature you want to build
  2. Asks contextual follow-up questions about users, requirements, and scope
  3. Generates a markdown PRD with user stories and acceptance criteria
  4. Offers to create tracker tasks (prd.json or beads)

  Requires an AI agent to be configured. Run 'ralph-tui setup' to configure one.

Examples:
  ralph-tui create-prd                      # Start AI-powered PRD creation
  ralph-tui prime                           # Alias for create-prd
  ralph-tui create-prd --agent claude       # Use specific agent
  ralph-tui create-prd --output ./docs      # Save PRD to custom directory
`);
}

/**
 * Get the configured agent plugin.
 */
async function getAgent(agentName?: string): Promise<AgentPlugin | null> {
  try {
    const cwd = process.cwd();
    const storedConfig = await loadStoredConfig(cwd);

    // Register built-in agents
    registerBuiltinAgents();
    const registry = getAgentRegistry();
    await registry.initialize();

    // Determine target agent
    const targetAgent = agentName || storedConfig.agent || storedConfig.defaultAgent || 'claude';

    // Build agent config
    const agentConfig: AgentPluginConfig = {
      name: targetAgent,
      plugin: targetAgent,
      options: storedConfig.agentOptions || {},
    };

    // Get agent instance
    const agent = await registry.getInstance(agentConfig);

    // Check if agent is ready
    const isReady = await agent.isReady();
    if (!isReady) {
      const detection = await agent.detect();
      if (!detection.available) {
        console.error(`Agent '${targetAgent}' is not available: ${detection.error || 'not detected'}`);
        return null;
      }
    }

    return agent;
  } catch (error) {
    console.error('Failed to load agent:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Run the AI-powered chat mode for PRD creation.
 */
async function runChatMode(parsedArgs: CreatePrdArgs): Promise<void> {
  // Get agent
  const agent = await getAgent(parsedArgs.agent);
  if (!agent) {
    console.error('');
    console.error('Chat mode requires an AI agent. Options:');
    console.error('  1. Run "ralph-tui setup" to configure an agent');
    console.error('  2. Use "--agent claude" or "--agent opencode" to specify one');
    process.exit(1);
  }

  const cwd = parsedArgs.cwd || process.cwd();
  const outputDir = parsedArgs.output || 'tasks';
  const timeout = parsedArgs.timeout || 180000;

  console.log(`Using agent: ${agent.meta.name}`);
  console.log('');

  // Create renderer and render the chat app
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C in the app
  });

  const root = createRoot(renderer);

  await new Promise<void>((resolve) => {
    const handleComplete = (prdPath: string, _featureName: string) => {
      root.unmount();
      renderer.destroy();
      console.log('');
      console.log(`PRD workflow complete: ${prdPath}`);
      resolve();
    };

    const handleCancel = () => {
      root.unmount();
      renderer.destroy();
      console.log('');
      console.log('PRD creation cancelled.');
      resolve();
    };

    const handleError = (error: string) => {
      console.error('Error:', error);
    };

    root.render(
      <PrdChatApp
        agent={agent}
        cwd={cwd}
        outputDir={outputDir}
        timeout={timeout}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onError={handleError}
      />
    );
  });
}

/**
 * Execute the create-prd command.
 * Always uses AI-powered chat mode for conversational PRD creation.
 */
export async function executeCreatePrdCommand(args: string[]): Promise<void> {
  const parsedArgs = parseCreatePrdArgs(args);
  const cwd = parsedArgs.cwd || process.cwd();

  // Verify setup is complete before running
  await requireSetup(cwd, 'ralph-tui prime');

  await runChatMode(parsedArgs);
  process.exit(0);
}
