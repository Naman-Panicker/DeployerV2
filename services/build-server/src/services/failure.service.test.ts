import { describe, it, expect } from 'vitest';
import { FailureType } from '@deployer/prisma';
import { classifyContainerFailure, classifyServerError } from './failure.service.js';
import type { BuildResult } from './docker.service.js';

function buildResult(fields: Partial<BuildResult>): BuildResult {
  return {
    success: false,
    exitCode: 1,
    stage: 'build',
    timedOut: false,
    oomKilled: false,
    aborted: false,
    infraError: false,
    logTail: ['line 1', 'npm ERR! build failed'],
    ...fields,
  };
}

describe('failure.service - classifyContainerFailure', () => {
  it('classifies a failed clone as a BUILD_ERROR with guidance for the user', () => {
    const failure = classifyContainerFailure(buildResult({ stage: 'clone', exitCode: 128 }));
    expect(failure.type).toBe(FailureType.BUILD_ERROR);
    expect(failure.stage).toBe('clone');
    expect(failure.userMessage).toMatch(/Could not clone the repository/);
  });

  it('classifies failed npm install and npm run build as BUILD_ERROR with exit code', () => {
    const install = classifyContainerFailure(buildResult({ stage: 'install', exitCode: 1 }));
    const build = classifyContainerFailure(buildResult({ stage: 'build', exitCode: 2 }));
    expect(install.type).toBe(FailureType.BUILD_ERROR);
    expect(install.userMessage).toMatch(/npm install failed \(exit code 1\)/);
    expect(build.type).toBe(FailureType.BUILD_ERROR);
    expect(build.userMessage).toMatch(/npm run build failed \(exit code 2\)/);
  });

  it('reports a likely memory limit kill for exit code 137 or OOMKilled during build', () => {
    const byExitCode = classifyContainerFailure(buildResult({ stage: 'build', exitCode: 137 }));
    const byFlag = classifyContainerFailure(buildResult({ stage: 'install', exitCode: 1, oomKilled: true }));
    expect(byExitCode.type).toBe(FailureType.BUILD_ERROR);
    expect(byExitCode.userMessage).toMatch(/memory limit/);
    expect(byFlag.userMessage).toMatch(/memory limit/);
  });

  it('classifies a timeout as a BUILD_ERROR', () => {
    const failure = classifyContainerFailure(buildResult({ stage: 'build', timedOut: true, exitCode: 1 }));
    expect(failure.type).toBe(FailureType.BUILD_ERROR);
    expect(failure.userMessage).toMatch(/time limit/);
  });

  it('classifies upload, detect and setup failures as SYSTEM_ERROR', () => {
    for (const stage of ['upload', 'detect', 'setup']) {
      const failure = classifyContainerFailure(buildResult({ stage }));
      expect(failure.type).toBe(FailureType.SYSTEM_ERROR);
      expect(failure.userMessage).toBeUndefined();
    }
  });

  it('classifies Docker errors and server shutdown aborts as SYSTEM_ERROR', () => {
    const infra = classifyContainerFailure(buildResult({ stage: 'setup', infraError: true, error: 'no such image' }));
    const aborted = classifyContainerFailure(buildResult({ stage: 'build', aborted: true, exitCode: 137 }));
    expect(infra.type).toBe(FailureType.SYSTEM_ERROR);
    expect(aborted.type).toBe(FailureType.SYSTEM_ERROR);
    expect(aborted.stage).toBe('shutdown');
  });

  it('keeps internal details and the container log tail for maintenance', () => {
    const failure = classifyContainerFailure(buildResult({ stage: 'upload', error: 'S3 POST failed' }));
    expect(failure.details).toContain('stage=upload');
    expect(failure.details).toContain('S3 POST failed');
    expect(failure.details).toContain('npm ERR! build failed');
  });
});

describe('failure.service - classifyServerError', () => {
  it('wraps unexpected exceptions as SYSTEM_ERROR with the stack trace', () => {
    const failure = classifyServerError('finalize', new Error('database is down'));
    expect(failure.type).toBe(FailureType.SYSTEM_ERROR);
    expect(failure.stage).toBe('finalize');
    expect(failure.details).toContain('database is down');
  });
});
