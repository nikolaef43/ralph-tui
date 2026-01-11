/**
 * ABOUTME: Type definitions for Ralph TUI components.
 * Defines the data structures and props used across the TUI layout components.
 */

import type { TaskStatus, RalphStatus } from './theme.js';
import type { IterationResult } from '../engine/types.js';
import type { TaskPriority } from '../plugins/trackers/types.js';

// Re-export TaskPriority for convenience
export type { TaskPriority };

/**
 * Blocker task info for display purposes
 */
export interface BlockerInfo {
  /** Blocker task ID */
  id: string;
  /** Blocker task title */
  title: string;
  /** Blocker task status */
  status: string;
}

/**
 * Task item displayed in the task list and detail view.
 * Extended from TrackerTask for full detail view support.
 */
export interface TaskItem {
  /** Unique identifier */
  id: string;
  /** Human-readable task title */
  title: string;
  /** Current status */
  status: TaskStatus;
  /** Detailed description or body text */
  description?: string;
  /** Current iteration/sprint number */
  iteration?: number;
  /** Priority level (0-4, where 0 is critical) */
  priority?: TaskPriority;
  /** Labels or tags associated with the task */
  labels?: string[];
  /** Task type (e.g., 'feature', 'bug', 'task', 'epic') */
  type?: string;
  /** IDs of tasks this task depends on (blockers) */
  dependsOn?: string[];
  /** IDs of tasks that depend on this task */
  blocks?: string[];
  /** Detailed info about tasks that are blocking this one (for display) */
  blockedByTasks?: BlockerInfo[];
  /** Completion notes or close reason (if closed) */
  closeReason?: string;
  /** Acceptance criteria as markdown text or list */
  acceptanceCriteria?: string;
  /** Assigned user or owner */
  assignee?: string;
  /** Creation timestamp (ISO 8601) */
  createdAt?: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt?: string;
  /** Parent task/epic ID for hierarchical display */
  parentId?: string;
}

/**
 * Props for the Header component
 */
export interface HeaderProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Name of the current epic/project */
  epicName: string;
  /** Elapsed time in seconds */
  elapsedTime: number;
  /** Name of the tracker being used (e.g., 'beads', 'jira') */
  trackerName: string;
  /** Current task ID being worked on (if any) */
  currentTaskId?: string;
  /** Current task title being worked on (if any) */
  currentTaskTitle?: string;
  /** Current iteration number (if running) */
  currentIteration?: number;
}

/**
 * Props for the Footer component
 */
export interface FooterProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Total number of tasks */
  totalTasks: number;
  /** Number of completed tasks */
  completedTasks: number;
}

/**
 * Props for the LeftPanel (task list) component
 */
export interface LeftPanelProps {
  /** List of tasks to display */
  tasks: TaskItem[];
  /** Currently selected task index */
  selectedIndex: number;
  /** Callback when a task is selected (keyboard navigation) */
  onSelectTask?: (index: number) => void;
  /** Callback when Enter is pressed to drill into task details */
  onTaskDrillDown?: (task: TaskItem) => void;
}

/**
 * Props for the RightPanel (details) component
 */
export interface RightPanelProps {
  /** Currently selected task (null if none selected) */
  selectedTask: TaskItem | null;
  /** Current iteration number */
  currentIteration: number;
  /** Current iteration output/log */
  iterationOutput?: string;
}

/**
 * Overall application state for the TUI
 */
export interface AppState {
  header: HeaderProps;
  footer: FooterProps;
  leftPanel: LeftPanelProps;
  rightPanel: RightPanelProps;
}

/**
 * Props for the IterationHistoryPanel component
 */
export interface IterationHistoryPanelProps {
  /** List of iteration results */
  iterations: IterationResult[];
  /** Total number of iterations planned */
  totalIterations: number;
  /** Currently selected iteration index */
  selectedIndex: number;
  /** Current running iteration number (0 if none running) */
  runningIteration: number;
  /** Callback when Enter is pressed to drill into iteration details */
  onIterationDrillDown?: (iteration: IterationResult) => void;
}

/**
 * Props for the TaskDetailView component
 */
export interface TaskDetailViewProps {
  /** The task to display details for */
  task: TaskItem;
  /** Callback when Esc is pressed to return to list view */
  onBack?: () => void;
}
