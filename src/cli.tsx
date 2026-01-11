#!/usr/bin/env bun
/**
 * ABOUTME: CLI entry point for the Ralph TUI application.
 * Handles subcommands (plugins, run, etc.) and launches the TUI when no subcommand given.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './tui/index.js';
import {
  printTrackerPlugins,
  printAgentPlugins,
  executeRunCommand,
  executeStatusCommand,
  executeResumeCommand,
  executeConfigCommand,
  executeSetupCommand,
  executeLogsCommand,
  executeTemplateCommand,
} from './commands/index.js';

/**
 * Show CLI help message.
 */
function showHelp(): void {
  console.log(`
Ralph TUI - AI Agent Loop Orchestrator

Usage: ralph-tui [command] [options]

Commands:
  (none)              Launch the interactive TUI
  run [options]       Start Ralph execution
  resume [options]    Resume an interrupted session
  status              Check session status
  logs [options]      View/manage iteration output logs
  setup [options]     Run interactive project setup
  config show         Display merged configuration
  template show       Display current prompt template
  template init       Copy default template for customization
  plugins agents      List available agent plugins
  plugins trackers    List available tracker plugins
  help, --help, -h    Show this help message

Run Options:
  --epic <id>         Epic ID for beads tracker
  --prd <path>        PRD file path for json tracker
  --agent <name>      Override agent plugin (e.g., claude, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --iterations <n>    Maximum iterations (0 = unlimited)
  --resume            Resume existing session (deprecated, use 'resume' command)
  --headless          Run without TUI
  --no-setup          Skip interactive setup even if no config exists

Resume Options:
  --cwd <path>        Working directory
  --headless          Run without TUI
  --force             Override stale lock

Examples:
  ralph-tui                              # Start the TUI
  ralph-tui run                          # Start execution with defaults
  ralph-tui run --epic myproject-epic    # Run with specific epic
  ralph-tui run --prd ./prd.json         # Run with PRD file
  ralph-tui resume                       # Resume interrupted session
  ralph-tui status                       # Check session status
  ralph-tui logs                         # List iteration logs
  ralph-tui logs --iteration 5           # View specific iteration
  ralph-tui logs --task US-005           # View logs for a task
  ralph-tui logs --clean --keep 10       # Clean up old logs
  ralph-tui plugins agents               # List agent plugins
  ralph-tui plugins trackers             # List tracker plugins
  ralph-tui template show                # Show current prompt template
  ralph-tui template init                # Create custom template
`);
}

/**
 * Handle subcommands before launching TUI.
 * @returns true if a subcommand was handled and we should exit
 */
async function handleSubcommand(args: string[]): Promise<boolean> {
  const command = args[0];

  // Help command
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return true;
  }

  // Run command
  if (command === 'run') {
    await executeRunCommand(args.slice(1));
    return true;
  }

  // Resume command
  if (command === 'resume') {
    await executeResumeCommand(args.slice(1));
    return true;
  }

  // Status command
  if (command === 'status') {
    await executeStatusCommand(args.slice(1));
    return true;
  }

  // Logs command
  if (command === 'logs') {
    await executeLogsCommand(args.slice(1));
    return true;
  }

  // Config command
  if (command === 'config') {
    await executeConfigCommand(args.slice(1));
    return true;
  }

  // Setup command
  if (command === 'setup') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Template command
  if (command === 'template') {
    await executeTemplateCommand(args.slice(1));
    return true;
  }

  // Plugins commands
  if (command === 'plugins') {
    const subcommand = args[1];

    if (subcommand === 'agents') {
      await printAgentPlugins();
      return true;
    }

    if (subcommand === 'trackers') {
      await printTrackerPlugins();
      return true;
    }

    // Unknown plugins subcommand
    console.error(`Unknown plugins subcommand: ${subcommand || '(none)'}`);
    console.log('Available: plugins agents, plugins trackers');
    return true;
  }

  // Unknown command
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  return false;
}

/**
 * Launch the interactive TUI.
 */
async function launchTui(): Promise<void> {
  // Create the OpenTUI CLI renderer
  const renderer = await createCliRenderer({
    // Exit on Ctrl+C (we also handle 'q' and Escape in the App)
    exitOnCtrlC: true,
  });

  // Create the React root and render the App
  const root = createRoot(renderer);
  root.render(<App />);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Get command-line arguments (skip node and script path)
  const args = process.argv.slice(2);

  // Handle subcommands
  const handled = await handleSubcommand(args);
  if (handled) {
    return;
  }

  // No subcommand - launch the TUI
  await launchTui();
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Failed to start Ralph TUI:', error);
  process.exit(1);
});
