/**
 * ABOUTME: Listen command for ralph-tui remote listener.
 * Starts a WebSocket server for remote control without local TUI.
 * Supports daemon mode and token rotation.
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  createRemoteServer,
  getOrCreateToken,
  rotateToken,
  getTokenInfo,
  type RemoteServerState,
} from '../remote/index.js';
import type { ListenOptions } from '../remote/types.js';
import { DEFAULT_LISTEN_OPTIONS } from '../remote/types.js';

/**
 * Path to the daemon PID file
 */
const DAEMON_PID_PATH = join(homedir(), '.config', 'ralph-tui', 'listen.pid');

/**
 * Parse listen command arguments.
 */
export function parseListenArgs(args: string[]): Partial<ListenOptions> & { help?: boolean } {
  const options: Partial<ListenOptions> & { help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' && args[i + 1]) {
      const port = parseInt(args[i + 1], 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        options.port = port;
      } else {
        console.error(`Invalid port: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    } else if (arg === '--daemon' || arg === '-d') {
      options.daemon = true;
    } else if (arg === '--rotate-token') {
      options.rotateToken = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Display token information.
 */
async function displayToken(token: string, isNew: boolean): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Authentication Token                        ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (isNew) {
    console.log('  A new authentication token has been generated:');
  } else {
    console.log('  Your authentication token:');
  }

  console.log('');
  console.log(`  ${token}`);
  console.log('');
  console.log('  Store this token securely. You will need it to connect');
  console.log('  remote clients to this instance.');
  console.log('');

  if (isNew) {
    console.log('  To rotate this token later, run:');
    console.log('    ralph-tui listen --rotate-token');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

/**
 * Display server status information.
 */
function displayServerStatus(state: RemoteServerState): void {
  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('                     Remote Listener Started                    ');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  Status:     Running`);
  console.log(`  Port:       ${state.port}`);
  console.log(`  Host:       ${state.host}`);
  console.log(`  PID:        ${state.pid ?? process.pid}`);
  console.log('');

  if (state.host === '127.0.0.1') {
    console.log('  ⚠️  Binding to localhost only (no token configured)');
    console.log('     Remote connections will not be accepted.');
    console.log('');
  } else {
    console.log('  ✓  Accepting connections from all interfaces');
    console.log('');
  }

  console.log('  Connect URL:');
  console.log(`    ws://${state.host === '0.0.0.0' ? '<hostname>' : state.host}:${state.port}`);
  console.log('');
  console.log('  Press Ctrl+C to stop the server');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Fork the current process as a daemon.
 */
async function forkAsDaemon(port: number): Promise<void> {
  // Write out the arguments we want to pass
  const scriptPath = process.argv[1];
  const args = ['listen', '--port', port.toString()];

  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RALPH_DAEMON: '1',
    },
  });

  // Unref the child so parent can exit
  child.unref();

  // Write PID file
  await mkdir(dirname(DAEMON_PID_PATH), { recursive: true });
  await writeFile(DAEMON_PID_PATH, child.pid?.toString() ?? '', 'utf-8');

  console.log('');
  console.log(`Ralph remote listener started as daemon (PID: ${child.pid})`);
  console.log(`Port: ${port}`);
  console.log('');
  console.log('To check token info: ralph-tui listen --help');
  console.log('To stop: kill $(cat ~/.config/ralph-tui/listen.pid)');
  console.log('');
}

/**
 * Execute the listen command.
 */
export async function executeListenCommand(args: string[]): Promise<void> {
  const options = parseListenArgs(args);

  // Handle help
  if (options.help) {
    printListenHelp();
    return;
  }

  // Handle token rotation
  if (options.rotateToken) {
    const newToken = await rotateToken();
    console.log('');
    console.log('Token rotated successfully!');
    console.log('');
    console.log('New token:');
    console.log(`  ${newToken}`);
    console.log('');
    console.log('All existing connections using the old token will be rejected.');
    console.log('');
    return;
  }

  // Merge with defaults
  const listenOptions: ListenOptions = {
    ...DEFAULT_LISTEN_OPTIONS,
    ...options,
  };

  // Check if we're already in daemon mode (forked)
  const isDaemon = process.env.RALPH_DAEMON === '1';

  // If daemon mode requested but not yet forked, fork and exit
  if (listenOptions.daemon && !isDaemon) {
    await forkAsDaemon(listenOptions.port);
    return;
  }

  // Get or create token
  const { token, isNew } = await getOrCreateToken();

  // Display token on first run (not in daemon mode)
  if (isNew && !isDaemon) {
    await displayToken(token, true);
  } else if (!isDaemon) {
    // Show token preview
    const tokenInfo = await getTokenInfo();
    if (tokenInfo.exists) {
      console.log('');
      console.log(`Using token: ${tokenInfo.preview} (v${tokenInfo.version})`);
    }
  }

  // Create and start server
  const server = await createRemoteServer({
    port: listenOptions.port,
    onConnect: (clientId) => {
      if (!isDaemon) {
        console.log(`[connect] Client ${clientId} connected`);
      }
    },
    onDisconnect: (clientId) => {
      if (!isDaemon) {
        console.log(`[disconnect] Client ${clientId} disconnected`);
      }
    },
  });

  const state = await server.start();

  // Display status (not in daemon mode)
  if (!isDaemon) {
    displayServerStatus(state);
  }

  // Handle shutdown signals
  const shutdown = async () => {
    if (!isDaemon) {
      console.log('');
      console.log('Shutting down...');
    }
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  await new Promise(() => {
    // This promise never resolves, keeping the event loop alive
  });
}

/**
 * Print listen command help.
 */
export function printListenHelp(): void {
  console.log(`
ralph-tui listen - Start remote listener

Usage: ralph-tui listen [options]

Options:
  --port <port>     Port to bind to (default: 7890)
  --daemon, -d      Run as a background daemon
  --rotate-token    Generate a new token and invalidate the old one
  -h, --help        Show this help message

Description:
  Starts a WebSocket server for remote control of ralph-tui instances.
  This allows monitoring and controlling ralph-tui from a remote client.

  On first run, a secure authentication token is generated and displayed.
  Store this token securely - you will need it to connect remote clients.

Security:
  - If no token is configured, the server binds only to localhost (127.0.0.1)
  - With a token configured, the server binds to all interfaces (0.0.0.0)
  - All connections must authenticate with the token
  - All actions are logged to ~/.config/ralph-tui/audit.log

Token Management:
  - Token is stored in ~/.config/ralph-tui/remote.json
  - Use --rotate-token to generate a new token
  - Old tokens are immediately invalidated on rotation

Examples:
  ralph-tui listen                    # Start on default port 7890
  ralph-tui listen --port 8080        # Start on custom port
  ralph-tui listen --daemon           # Start as background daemon
  ralph-tui listen --rotate-token     # Rotate authentication token

Daemon Management:
  # Start daemon
  ralph-tui listen --daemon

  # Stop daemon
  kill $(cat ~/.config/ralph-tui/listen.pid)

  # Check if running
  ps -p $(cat ~/.config/ralph-tui/listen.pid) 2>/dev/null && echo "Running"
`);
}
