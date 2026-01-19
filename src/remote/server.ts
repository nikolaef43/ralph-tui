/**
 * ABOUTME: WebSocket server for remote ralph-tui control.
 * Handles client connections, authentication, and message routing.
 * Binds to localhost if no token configured, all interfaces if token is set.
 */

import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';
import type {
  WSMessage,
  AuthMessage,
  AuthResponseMessage,
  ErrorMessage,
  PongMessage,
  ServerStatusMessage,
  RemoteServerState,
} from './types.js';
import { validateToken, getOrCreateToken } from './token.js';
import { createAuditLogger, type AuditLogger } from './audit.js';

/**
 * WebSocket data attached to each connection
 */
interface WebSocketData {
  ip: string;
}

/**
 * Connected client state
 */
interface ClientState {
  /** Unique client identifier */
  id: string;

  /** Client IP address */
  ip: string;

  /** Whether the client has authenticated */
  authenticated: boolean;

  /** When the client connected (ISO 8601) */
  connectedAt: string;
}

/**
 * Server options
 */
export interface RemoteServerOptions {
  /** Port to bind to */
  port: number;

  /** Whether a token is configured (determines bind host) */
  hasToken: boolean;

  /** Callback when server starts */
  onStart?: (state: RemoteServerState) => void;

  /** Callback when server stops */
  onStop?: () => void;

  /** Callback when a client connects */
  onConnect?: (clientId: string) => void;

  /** Callback when a client disconnects */
  onDisconnect?: (clientId: string) => void;
}

/**
 * Generate a unique client ID
 */
function generateClientId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Create a WebSocket message with common fields
 */
function createMessage<T extends WSMessage>(type: T['type'], data: Omit<T, 'type' | 'id' | 'timestamp'>): T {
  return {
    type,
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    ...data,
  } as T;
}

/**
 * RemoteServer class for handling WebSocket connections.
 */
export class RemoteServer {
  private server: Server<WebSocketData> | null = null;
  private clients: Map<ServerWebSocket<WebSocketData>, ClientState> = new Map();
  private options: RemoteServerOptions;
  private auditLogger: AuditLogger;
  private startedAt: string | null = null;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.auditLogger = createAuditLogger();
  }

  /**
   * Start the WebSocket server.
   */
  async start(): Promise<RemoteServerState> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    // Determine host based on token configuration
    // If no token is configured, bind only to localhost for security
    // If token is configured, bind to all interfaces for remote access
    const host = this.options.hasToken ? '0.0.0.0' : '127.0.0.1';

    // Store reference to this for use in websocket handlers
    const self = this;

    // Create WebSocket handler
    const websocketHandler: WebSocketHandler<WebSocketData> = {
      open(ws: ServerWebSocket<WebSocketData>) {
        const clientId = generateClientId();
        const clientIp = ws.data?.ip ?? 'unknown';

        const state: ClientState = {
          id: clientId,
          ip: clientIp,
          authenticated: false,
          connectedAt: new Date().toISOString(),
        };

        self.clients.set(ws, state);
        self.auditLogger.logConnection(`${clientId}@${clientIp}`, 'connect');
        self.options.onConnect?.(clientId);
      },

      message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        const clientState = self.clients.get(ws);
        if (!clientState) {
          return;
        }

        self.handleMessage(ws, clientState, message.toString());
      },

      close(ws: ServerWebSocket<WebSocketData>) {
        const clientState = self.clients.get(ws);
        if (clientState) {
          self.auditLogger.logConnection(
            `${clientState.id}@${clientState.ip}`,
            'disconnect'
          );
          self.options.onDisconnect?.(clientState.id);
          self.clients.delete(ws);
        }
      },
    };

    this.server = Bun.serve<WebSocketData>({
      port: this.options.port,
      hostname: host,

      fetch(req, server) {
        // Upgrade HTTP request to WebSocket
        const clientIp = server.requestIP(req)?.address ?? 'unknown';

        if (server.upgrade(req, { data: { ip: clientIp } })) {
          return; // Upgrade successful
        }

        // Non-WebSocket request - return simple info
        return new Response(JSON.stringify({
          service: 'ralph-tui-remote',
          version: '0.2.1',
          websocket: true,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },

      websocket: websocketHandler,
    });

    this.startedAt = new Date().toISOString();

    const state: RemoteServerState = {
      running: true,
      port: this.options.port,
      host,
      startedAt: this.startedAt,
      connectedClients: 0,
      pid: process.pid,
    };

    await this.auditLogger.logServerEvent('start', {
      port: this.options.port,
      host,
      pid: process.pid,
    });

    this.options.onStart?.(state);
    return state;
  }

  /**
   * Stop the WebSocket server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Close all client connections
    for (const [ws] of this.clients) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    this.server.stop();
    this.server = null;

    await this.auditLogger.logServerEvent('stop');
    this.options.onStop?.();
  }

  /**
   * Get current server state.
   */
  getState(): RemoteServerState | null {
    if (!this.server || !this.startedAt) {
      return null;
    }

    return {
      running: true,
      port: this.options.port,
      host: this.options.hasToken ? '0.0.0.0' : '127.0.0.1',
      startedAt: this.startedAt,
      connectedClients: this.clients.size,
      pid: process.pid,
    };
  }

  /**
   * Handle an incoming WebSocket message.
   */
  private async handleMessage(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    rawMessage: string
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;
    let message: WSMessage;

    try {
      message = JSON.parse(rawMessage) as WSMessage;
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Invalid JSON message');
      await this.auditLogger.logFailure(clientId, 'message_parse', 'Invalid JSON');
      return;
    }

    // Handle authentication
    if (message.type === 'auth') {
      await this.handleAuth(ws, clientState, message as AuthMessage);
      return;
    }

    // Handle ping (allowed without auth for connection health checks)
    if (message.type === 'ping') {
      this.sendPong(ws, message.id);
      return;
    }

    // All other messages require authentication
    if (!clientState.authenticated) {
      this.sendError(ws, 'NOT_AUTHENTICATED', 'Authentication required');
      await this.auditLogger.logFailure(
        clientId,
        'unauthorized_message',
        'Not authenticated',
        { messageType: message.type }
      );
      return;
    }

    // Handle authenticated messages
    switch (message.type) {
      case 'status':
        this.sendStatus(ws);
        break;
      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle authentication request.
   */
  private async handleAuth(
    ws: ServerWebSocket<WebSocketData>,
    clientState: ClientState,
    message: AuthMessage
  ): Promise<void> {
    const clientId = `${clientState.id}@${clientState.ip}`;

    const isValid = await validateToken(message.token);

    if (isValid) {
      clientState.authenticated = true;

      const response = createMessage<AuthResponseMessage>('auth_response', {
        success: true,
      });
      this.send(ws, response);

      await this.auditLogger.logAuth(clientId, true);
    } else {
      const response = createMessage<AuthResponseMessage>('auth_response', {
        success: false,
        error: 'Invalid token',
      });
      this.send(ws, response);

      await this.auditLogger.logAuth(clientId, false, 'Invalid token');
    }
  }

  /**
   * Send a pong response.
   */
  private sendPong(ws: ServerWebSocket<WebSocketData>, requestId: string): void {
    const response = createMessage<PongMessage>('pong', {});
    // Keep the same ID as the ping request
    response.id = requestId;
    this.send(ws, response);
  }

  /**
   * Send server status.
   */
  private sendStatus(ws: ServerWebSocket<WebSocketData>): void {
    const uptime = this.startedAt
      ? (Date.now() - new Date(this.startedAt).getTime()) / 1000
      : 0;

    const response = createMessage<ServerStatusMessage>('server_status', {
      version: '0.2.1',
      uptime,
      connectedClients: this.clients.size,
    });
    this.send(ws, response);
  }

  /**
   * Send an error message.
   */
  private sendError(ws: ServerWebSocket<WebSocketData>, code: string, message: string): void {
    const response = createMessage<ErrorMessage>('error', {
      code,
      message,
    });
    this.send(ws, response);
  }

  /**
   * Send a message to a WebSocket client.
   */
  private send(ws: ServerWebSocket<WebSocketData>, message: WSMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Client may have disconnected
    }
  }
}

/**
 * Create and start a remote server.
 */
export async function createRemoteServer(
  options: Partial<RemoteServerOptions> = {}
): Promise<RemoteServer> {
  // Check if token exists
  const { token, isNew } = await getOrCreateToken();
  const hasToken = !isNew || token.length > 0;

  const serverOptions: RemoteServerOptions = {
    port: options.port ?? 7890,
    hasToken,
    onStart: options.onStart,
    onStop: options.onStop,
    onConnect: options.onConnect,
    onDisconnect: options.onDisconnect,
  };

  return new RemoteServer(serverOptions);
}
