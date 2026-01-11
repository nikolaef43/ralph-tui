/**
 * ABOUTME: Header component for the Ralph TUI.
 * Displays Ralph status, epic/project name, elapsed time, and tracker name.
 * Shows current task info when executing for clear visibility into what's happening.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, formatElapsedTime, type RalphStatus } from '../theme.js';
import type { HeaderProps } from '../types.js';

/**
 * Truncate text to fit within a given width, adding ellipsis if needed
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get the status indicator and color for the current Ralph status
 */
function getStatusDisplay(
  status: RalphStatus,
  currentTaskId?: string,
  currentIteration?: number
): { indicator: string; color: string; label: string } {
  switch (status) {
    case 'ready':
      return { indicator: statusIndicators.ready, color: colors.status.info, label: 'Ready - Press Enter to start' };
    case 'running':
      return { indicator: statusIndicators.running, color: colors.status.success, label: 'Running' };
    case 'selecting':
      return { indicator: statusIndicators.selecting, color: colors.status.info, label: 'Selecting next task...' };
    case 'executing': {
      const iterLabel = currentIteration ? `#${currentIteration}` : '';
      const taskLabel = currentTaskId ? ` → ${currentTaskId}` : '';
      return {
        indicator: statusIndicators.executing,
        color: colors.status.success,
        label: `Executing${iterLabel}${taskLabel}`,
      };
    }
    case 'pausing':
      return { indicator: statusIndicators.pausing, color: colors.status.warning, label: 'Pausing after iteration...' };
    case 'paused':
      return { indicator: statusIndicators.paused, color: colors.status.warning, label: 'Paused - Press p to resume' };
    case 'stopped':
      return { indicator: statusIndicators.stopped, color: colors.fg.muted, label: 'Stopped' };
    case 'complete':
      return { indicator: statusIndicators.complete, color: colors.status.success, label: 'Complete ✓' };
    case 'idle':
      return { indicator: statusIndicators.idle, color: colors.fg.muted, label: 'No more tasks' };
    case 'error':
      return { indicator: statusIndicators.blocked, color: colors.status.error, label: 'Error - Check logs' };
  }
}

/**
 * Header component showing Ralph status, epic name, elapsed time, and tracker.
 * When executing, shows which task is being worked on for clear visibility.
 */
export function Header({
  status,
  epicName,
  elapsedTime,
  trackerName,
  currentTaskId,
  currentTaskTitle,
  currentIteration,
}: HeaderProps): ReactNode {
  const statusDisplay = getStatusDisplay(status, currentTaskId, currentIteration);
  const formattedTime = formatElapsedTime(elapsedTime);

  // Show abbreviated task title when executing (max 30 chars)
  const taskDisplay = currentTaskTitle && (status === 'executing' || status === 'running')
    ? truncateText(currentTaskTitle, 30)
    : null;

  return (
    <box
      style={{
        width: '100%',
        height: 3,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.bg.secondary,
        paddingLeft: 1,
        paddingRight: 1,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {/* Left section: Status, status label, and optional task info */}
      <box style={{ flexDirection: 'row', gap: 2, flexShrink: 1 }}>
        <text>
          <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
          <span fg={colors.fg.primary}> Ralph</span>
          <span fg={colors.fg.muted}> · </span>
          <span fg={statusDisplay.color}>{statusDisplay.label}</span>
        </text>
        {taskDisplay && (
          <text fg={colors.accent.tertiary}>「{taskDisplay}」</text>
        )}
      </box>

      {/* Right section: Epic, Timer and Tracker */}
      <box style={{ flexDirection: 'row', gap: 2 }}>
        <text fg={colors.accent.primary}>{epicName}</text>
        <text fg={colors.fg.secondary}>⏱ {formattedTime}</text>
        <text fg={colors.fg.muted}>[{trackerName}]</text>
      </box>
    </box>
  );
}
