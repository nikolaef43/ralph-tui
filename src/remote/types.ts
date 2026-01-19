/**
 * ABOUTME: Type definitions for the ralph-tui remote listener feature.
 * Defines configuration, authentication tokens, and WebSocket message types.
 */

/**
 * Remote listener configuration stored in ~/.config/ralph-tui/remote.json
 */
export interface RemoteConfig {
  /** Authentication token (generated on first run) */
  token: string;

  /** When the token was created (ISO 8601) */
  tokenCreatedAt: string;

  /** Token version for tracking rotation */
  tokenVersion: number;
}

/**
 * Options for the listen command
 */
export interface ListenOptions {
  /** Port to bind to (default: 7890) */
  port: number;

  /** Run as a background daemon */
  daemon: boolean;

  /** Rotate the authentication token */
  rotateToken: boolean;
}

/**
 * Default listen options
 */
export const DEFAULT_LISTEN_OPTIONS: ListenOptions = {
  port: 7890,
  daemon: false,
  rotateToken: false,
};

/**
 * WebSocket message base type
 */
export interface WSMessage {
  /** Message type identifier */
  type: string;

  /** Unique message ID for request/response correlation */
  id: string;

  /** Timestamp of the message (ISO 8601) */
  timestamp: string;
}

/**
 * Authentication request sent by client
 */
export interface AuthMessage extends WSMessage {
  type: 'auth';
  token: string;
}

/**
 * Authentication response sent by server
 */
export interface AuthResponseMessage extends WSMessage {
  type: 'auth_response';
  success: boolean;
  error?: string;
}

/**
 * Server status information
 */
export interface ServerStatusMessage extends WSMessage {
  type: 'server_status';
  version: string;
  uptime: number;
  connectedClients: number;
}

/**
 * Error message sent by server
 */
export interface ErrorMessage extends WSMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Ping/pong for connection health check
 */
export interface PingMessage extends WSMessage {
  type: 'ping';
}

export interface PongMessage extends WSMessage {
  type: 'pong';
}

/**
 * All possible WebSocket message types
 */
export type WSMessageType =
  | AuthMessage
  | AuthResponseMessage
  | ServerStatusMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/**
 * Audit log entry for remote actions
 */
export interface AuditLogEntry {
  /** Timestamp of the action (ISO 8601) */
  timestamp: string;

  /** Client identifier (IP address or identifier) */
  clientId: string;

  /** Action that was performed */
  action: string;

  /** Additional details about the action */
  details?: Record<string, unknown>;

  /** Whether the action succeeded */
  success: boolean;

  /** Error message if action failed */
  error?: string;
}

/**
 * Remote server state
 */
export interface RemoteServerState {
  /** Whether the server is running */
  running: boolean;

  /** Port the server is bound to */
  port: number;

  /** Host the server is bound to */
  host: string;

  /** When the server started (ISO 8601) */
  startedAt: string;

  /** Number of currently connected clients */
  connectedClients: number;

  /** PID of the server process (for daemon mode) */
  pid?: number;
}
