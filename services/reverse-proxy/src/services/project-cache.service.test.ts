import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectCache } from './project-cache.service.js';

describe('ProjectCache (LRU & TTL)', () => {
  let cache: ProjectCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ProjectCache(3, 5000); // maxSize = 3, TTL = 5000ms
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves an entry successfully', () => {
    cache.set('project-a', {
      projectId: 'p_1',
      currentDeploymentId: 'd_1',
    });

    const entry = cache.get('project-a');
    expect(entry).not.toBeNull();
    expect(entry?.projectId).toBe('p_1');
    expect(entry?.currentDeploymentId).toBe('d_1');
  });

  it('returns null for nonexistent keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('expires entries after TTL elapsed', () => {
    cache.set('project-a', {
      projectId: 'p_1',
      currentDeploymentId: 'd_1',
    });

    // Advance 4 seconds (still within 5s TTL)
    vi.advanceTimersByTime(4000);
    expect(cache.get('project-a')).not.toBeNull();

    // Advance 2 more seconds (total 6s, beyond TTL)
    vi.advanceTimersByTime(2000);
    expect(cache.get('project-a')).toBeNull();
  });

  it('evicts least recently used (LRU) entry when max capacity is reached', () => {
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1' });
    cache.set('app-2', { projectId: 'p2', currentDeploymentId: 'd2' });
    cache.set('app-3', { projectId: 'p3', currentDeploymentId: 'd3' });

    expect(cache.size()).toBe(3);

    // Adding 4th entry exceeds maxSize of 3; app-1 (oldest) should be evicted
    cache.set('app-4', { projectId: 'p4', currentDeploymentId: 'd4' });

    expect(cache.size()).toBe(3);
    expect(cache.get('app-1')).toBeNull();
    expect(cache.get('app-2')).not.toBeNull();
    expect(cache.get('app-3')).not.toBeNull();
    expect(cache.get('app-4')).not.toBeNull();
  });

  it('refreshes LRU position on access so accessed entry is saved from eviction', () => {
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1' });
    cache.set('app-2', { projectId: 'p2', currentDeploymentId: 'd2' });
    cache.set('app-3', { projectId: 'p3', currentDeploymentId: 'd3' });

    // Access app-1 to move it to most recently used
    cache.get('app-1');

    // Add app-4. Since app-1 was refreshed, app-2 should be evicted!
    cache.set('app-4', { projectId: 'p4', currentDeploymentId: 'd4' });

    expect(cache.get('app-1')).not.toBeNull();
    expect(cache.get('app-2')).toBeNull(); // evicted!
    expect(cache.get('app-3')).not.toBeNull();
    expect(cache.get('app-4')).not.toBeNull();
  });

  it('invalidates a specific key correctly', () => {
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1' });
    cache.set('app-2', { projectId: 'p2', currentDeploymentId: 'd2' });

    cache.invalidate('app-1');
    expect(cache.get('app-1')).toBeNull();
    expect(cache.get('app-2')).not.toBeNull();
    expect(cache.size()).toBe(1);
  });

  it('clears all entries from cache', () => {
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1' });
    cache.set('app-2', { projectId: 'p2', currentDeploymentId: 'd2' });

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('app-1')).toBeNull();
    expect(cache.get('app-2')).toBeNull();
  });

  it('reports correct size when updating existing keys', () => {
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1' });
    expect(cache.size()).toBe(1);

    // Update same key
    cache.set('app-1', { projectId: 'p1', currentDeploymentId: 'd1-updated' });
    expect(cache.size()).toBe(1);
    expect(cache.get('app-1')?.currentDeploymentId).toBe('d1-updated');
  });
});
