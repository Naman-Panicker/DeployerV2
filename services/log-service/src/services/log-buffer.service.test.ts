import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist mock for @deployer/prisma
vi.mock('@deployer/prisma', () => ({
  prisma: {
    deploymentLog: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

import { prisma } from '@deployer/prisma';
import {
  handleLogMessage,
  flushBuffer,
  flushAll,
  markComplete,
  isMarkedComplete,
  startFlushInterval,
  stopFlushInterval,
  getBufferSize,
  clearBufferState,
} from './log-buffer.service.js';

describe('log-buffer.service', () => {
  beforeEach(() => {
    clearBufferState();
    stopFlushInterval();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopFlushInterval();
    clearBufferState();
    vi.useRealTimers();
  });

  it('accumulates logs in memory when handleLogMessage is called', async () => {
    const deploymentId = 'dep-test-1';
    await handleLogMessage(deploymentId, 'stdout', 'Starting build container...');
    await handleLogMessage(deploymentId, 'stdout', 'Cloning git repository...');

    expect(getBufferSize(deploymentId)).toBe(2);
    expect(prisma.deploymentLog.createMany).not.toHaveBeenCalled();
  });

  it('automatically flushes when buffer hits FLUSH_THRESHOLD_LINES (50 lines)', async () => {
    const deploymentId = 'dep-test-thresh';

    // Push 49 lines - should not flush yet
    for (let i = 0; i < 49; i++) {
      await handleLogMessage(deploymentId, 'stdout', `Log message ${i}`);
    }
    expect(getBufferSize(deploymentId)).toBe(49);
    expect(prisma.deploymentLog.createMany).not.toHaveBeenCalled();

    // Push 50th line - triggers automatic flush
    await handleLogMessage(deploymentId, 'stdout', 'Log message 50');
    expect(prisma.deploymentLog.createMany).toHaveBeenCalledTimes(1);
    expect(getBufferSize(deploymentId)).toBe(0);
  });

  it('flushes buffered logs to prisma.deploymentLog.createMany', async () => {
    const deploymentId = 'dep-test-flush';
    await handleLogMessage(deploymentId, 'stdout', 'Step 1 output');
    await handleLogMessage(deploymentId, 'stderr', 'Warning: deprecated package');

    await flushBuffer(deploymentId);

    expect(prisma.deploymentLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          deploymentId,
          stream: 'stdout',
          line: 'Step 1 output',
        }),
        expect.objectContaining({
          deploymentId,
          stream: 'stderr',
          line: 'Warning: deprecated package',
        }),
      ]),
    });
    expect(getBufferSize(deploymentId)).toBe(0);
  });

  it('does nothing when flushBuffer is called on an empty buffer', async () => {
    await flushBuffer('empty-deployment');
    expect(prisma.deploymentLog.createMany).not.toHaveBeenCalled();
  });

  it('tracks markComplete state correctly', () => {
    const depId = 'dep-complete-check';
    expect(isMarkedComplete(depId)).toBe(false);

    markComplete(depId);
    expect(isMarkedComplete(depId)).toBe(true);
  });

  it('removes buffer entry after flushBuffer when marked as complete', async () => {
    const depId = 'dep-cleanup';
    await handleLogMessage(depId, 'stdout', 'Final deployment line');
    markComplete(depId);

    await flushBuffer(depId);
    expect(getBufferSize(depId)).toBe(0);
  });

  it('flushAll flushes all active deployment buffers', async () => {
    await handleLogMessage('dep-1', 'stdout', 'Dep 1 line');
    await handleLogMessage('dep-2', 'stdout', 'Dep 2 line');

    await flushAll();

    expect(prisma.deploymentLog.createMany).toHaveBeenCalledTimes(2);
    expect(getBufferSize('dep-1')).toBe(0);
    expect(getBufferSize('dep-2')).toBe(0);
  });

  it('restores drained logs back to buffer if database insert fails', async () => {
    const depId = 'dep-db-fail';
    await handleLogMessage(depId, 'stdout', 'Critical log line');

    vi.mocked(prisma.deploymentLog.createMany).mockRejectedValueOnce(
      new Error('Database connection lost')
    );

    await expect(flushBuffer(depId)).rejects.toThrow('Database connection lost');

    // Buffer should have restored the log line so it can be retried
    expect(getBufferSize(depId)).toBe(1);
  });

  it('starts and stops interval timer for periodic flushing', async () => {
    vi.useFakeTimers();

    await handleLogMessage('dep-timer', 'stdout', 'Timer log');
    startFlushInterval(1000);

    // Advance 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    expect(prisma.deploymentLog.createMany).toHaveBeenCalledTimes(1);

    stopFlushInterval();
    await handleLogMessage('dep-timer', 'stdout', 'After stop');
    await vi.advanceTimersByTimeAsync(2000);

    // Should not have flushed again
    expect(prisma.deploymentLog.createMany).toHaveBeenCalledTimes(1);
  });

  it('clearBufferState empties all in-memory state', async () => {
    await handleLogMessage('dep-a', 'stdout', 'line 1');
    markComplete('dep-a');

    clearBufferState();

    expect(getBufferSize('dep-a')).toBe(0);
    expect(isMarkedComplete('dep-a')).toBe(false);
  });
});
