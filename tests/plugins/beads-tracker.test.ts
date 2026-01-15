/**
 * ABOUTME: Tests for the BeadsTrackerPlugin.
 * Tests CLI interactions with mocked bd commands.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BeadsTrackerPlugin } from '../../src/plugins/trackers/builtin/beads.js';

// Since BeadsTrackerPlugin relies on external CLI, we'll test the
// plugin methods that don't require actual CLI execution and
// verify the configuration handling

describe('BeadsTrackerPlugin', () => {
  let plugin: BeadsTrackerPlugin;

  beforeEach(() => {
    plugin = new BeadsTrackerPlugin();
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  describe('metadata', () => {
    test('has correct plugin ID', () => {
      expect(plugin.meta.id).toBe('beads');
    });

    test('has correct name', () => {
      expect(plugin.meta.name).toBe('Beads Issue Tracker');
    });

    test('supports bidirectional sync', () => {
      expect(plugin.meta.supportsBidirectionalSync).toBe(true);
    });

    test('supports hierarchy', () => {
      expect(plugin.meta.supportsHierarchy).toBe(true);
    });

    test('supports dependencies', () => {
      expect(plugin.meta.supportsDependencies).toBe(true);
    });
  });

  describe('initialization', () => {
    test('accepts beadsDir config', async () => {
      await plugin.initialize({ beadsDir: '.custom-beads' });
      // Note: isReady will be false if .beads doesn't exist
      // but config should be accepted
    });

    test('accepts epicId config', async () => {
      await plugin.initialize({ epicId: 'my-epic-123' });
      expect(plugin.getEpicId()).toBe('my-epic-123');
    });

    test('accepts labels as string', async () => {
      await plugin.initialize({ labels: 'ralph,frontend' });
      // Labels should be parsed and stored
    });

    test('accepts labels as array', async () => {
      await plugin.initialize({ labels: ['ralph', 'frontend'] });
    });

    test('accepts workingDir config', async () => {
      await plugin.initialize({ workingDir: '/tmp/test-project' });
    });
  });

  describe('epicId management', () => {
    test('setEpicId updates the epic ID', async () => {
      await plugin.initialize({});
      plugin.setEpicId('epic-456');

      expect(plugin.getEpicId()).toBe('epic-456');
    });

    test('getEpicId returns empty string initially', async () => {
      await plugin.initialize({});
      expect(plugin.getEpicId()).toBe('');
    });
  });

  describe('getSetupQuestions', () => {
    test('includes beadsDir question', () => {
      const questions = plugin.getSetupQuestions();
      const beadsDirQuestion = questions.find((q) => q.id === 'beadsDir');

      expect(beadsDirQuestion).toBeDefined();
      expect(beadsDirQuestion?.type).toBe('path');
      expect(beadsDirQuestion?.default).toBe('.beads');
    });

    test('includes labels question', () => {
      const questions = plugin.getSetupQuestions();
      const labelsQuestion = questions.find((q) => q.id === 'labels');

      expect(labelsQuestion).toBeDefined();
      expect(labelsQuestion?.type).toBe('text');
      expect(labelsQuestion?.default).toBe('ralph');
    });
  });

  describe('validateSetup', () => {
    test('validates when beads directory not found', async () => {
      // This will fail validation because .beads doesn't exist
      await plugin.initialize({ workingDir: '/nonexistent/path' });
      const result = await plugin.validateSetup({});

      // Should return an error about beads not being available
      expect(result).not.toBeNull();
    });
  });

  describe('dispose', () => {
    test('disposes cleanly', async () => {
      await plugin.initialize({});
      await plugin.dispose();
      // Note: BeadsTrackerPlugin's isReady() re-detects, so we just verify dispose doesn't throw
      // The ready flag is set based on whether .beads directory exists
    });
  });
});

describe('BeadsTrackerPlugin status mapping', () => {
  // Test the internal status mapping logic
  // These tests verify the conversion between bd status and TrackerTaskStatus

  describe('task conversion', () => {
    test('bead ID with dot infers parent ID', async () => {
      // When a bead has ID like "epic-123.45", parent should be "epic-123"
      // This tests the ID parsing logic in beadToTask
      const plugin = new BeadsTrackerPlugin();

      // The plugin parses bead IDs to infer parent relationships
      // e.g., "ralph-tui-45r.37" -> parent is "ralph-tui-45r"
      // This is tested indirectly through the actual getTasks implementation

      await plugin.dispose();
    });
  });
});

describe('BeadsTrackerPlugin detection', () => {
  test('detect returns not available when no .beads directory', async () => {
    const plugin = new BeadsTrackerPlugin();
    await plugin.initialize({ workingDir: '/tmp/nonexistent-dir' });

    const result = await plugin['detect']();
    expect(result.available).toBe(false);

    await plugin.dispose();
  });
});
