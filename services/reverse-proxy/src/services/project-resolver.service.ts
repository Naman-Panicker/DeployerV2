import { prisma } from '@deployer/prisma';
import { ProjectCache } from './project-cache.service.js';

const projectCache = new ProjectCache();

export interface ResolvedProject {
  projectId: string;
  currentDeploymentId: string | null;
}

/**
 * Resolves a subdomain to a project record via LRU cache or PostgreSQL lookup.
 */
export async function resolveSubdomain(
  subdomain: string
): Promise<ResolvedProject | null> {
  // 1. Check in-memory LRU cache
  const cached = projectCache.get(subdomain);
  if (cached) {
    return {
      projectId: cached.projectId,
      currentDeploymentId: cached.currentDeploymentId,
    };
  }

  // 2. Query PostgreSQL via Prisma
  try {
    const project = await prisma.project.findUnique({
      where: { subdomain },
      select: {
        id: true,
        currentDeploymentId: true,
      },
    });

    if (!project) {
      return null;
    }

    // 3. Cache the resolved project
    projectCache.set(subdomain, {
      projectId: project.id,
      currentDeploymentId: project.currentDeploymentId,
    });

    return {
      projectId: project.id,
      currentDeploymentId: project.currentDeploymentId,
    };
  } catch (error) {
    console.error(`[Project Resolver] Failed to lookup project for subdomain "${subdomain}":`, error);
    throw error;
  }
}

/**
 * Expose project cache instance (for testing or manual invalidation).
 */
export function getProjectCache(): ProjectCache {
  return projectCache;
}
