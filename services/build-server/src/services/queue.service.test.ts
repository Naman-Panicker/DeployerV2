import { describe, it, expect } from 'vitest';
import { isRollbackCopy } from './queue.service.js';

const PROJECT_A = '0b6f1c4e-8a7d-4c1e-9f3a-2d5e6b7c8a90';
const PROJECT_B = '7e2d9a1b-3c4f-4e5d-8a6b-1c2d3e4f5a6b';
const DEPLOYMENT = 'c9d8e7f6-a5b4-4c3d-9e2f-1a0b9c8d7e6f';

describe('queue.service - isRollbackCopy (copy job guard)', () => {
  it('accepts a rollback copy from a project history snapshot to the same project outputs', () => {
    expect(isRollbackCopy(`__history/${PROJECT_A}/${DEPLOYMENT}/`, `__outputs/${PROJECT_A}/`)).toBe(true);
  });

  it("rejects copying one project's snapshot over another project's live site", () => {
    expect(isRollbackCopy(`__history/${PROJECT_A}/${DEPLOYMENT}/`, `__outputs/${PROJECT_B}/`)).toBe(false);
  });

  it('rejects copies that do not go from __history to __outputs', () => {
    expect(isRollbackCopy(`__outputs/${PROJECT_A}/`, `__outputs/${PROJECT_A}/`)).toBe(false);
    expect(isRollbackCopy(`__history/${PROJECT_A}/${DEPLOYMENT}/`, `__history/${PROJECT_A}/${DEPLOYMENT}/`)).toBe(false);
  });

  it('rejects malformed, nested or traversal prefixes', () => {
    expect(isRollbackCopy(`__history/${PROJECT_A}/`, `__outputs/${PROJECT_A}/`)).toBe(false);
    expect(isRollbackCopy(`__history/${PROJECT_A}/${DEPLOYMENT}/`, `__outputs/${PROJECT_A}/sub/`)).toBe(false);
    expect(isRollbackCopy(`__history/${PROJECT_A}/../${PROJECT_B}/`, `__outputs/${PROJECT_A}/`)).toBe(false);
    expect(isRollbackCopy(`__history/not-a-uuid/${DEPLOYMENT}/`, `__outputs/not-a-uuid/`)).toBe(false);
    expect(isRollbackCopy('', '')).toBe(false);
  });
});
