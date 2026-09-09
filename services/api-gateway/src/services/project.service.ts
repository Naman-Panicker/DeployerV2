import crypto from 'node:crypto';
import { prisma, type Project, type Prisma } from '@deployer/prisma';
import { encryptEnvVars, decryptEnvVars, maskSecret } from './encryption.service.js';


/**
 * Slugifies a project name for use in subdomains.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

/**
 * Generates a unique subdomain for a project.
 */
export async function generateUniqueSubdomain(baseName: string): Promise<string> {
  const baseSlug = slugify(baseName);
  
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomBytes(2).toString('hex'); // 4 chars
    const candidate = `${baseSlug}-${suffix}`;
    const existing = await prisma.project.findUnique({
      where: { subdomain: candidate },
    });
    if (!existing) {
      return candidate;
    }
  }

  // Fallback with timestamp
  return `${baseSlug}-${Date.now().toString(36)}`;
}

export async function createProject(
  userId: string,
  data: { name: string; repoUrl: string; branch?: string; subdomain?: string }
): Promise<Project> {
  let subdomain = data.subdomain?.toLowerCase().trim();

  if (subdomain) {
    const existing = await prisma.project.findUnique({
      where: { subdomain },
    });
    if (existing) {
      throw new Error(`Subdomain '${subdomain}' is already taken`);
    }
  } else {
    subdomain = await generateUniqueSubdomain(data.name);
  }

  return prisma.project.create({
    data: {
      userId,
      name: data.name,
      repoUrl: data.repoUrl,
      branch: data.branch || 'main',
      subdomain,
    },
  });
}

export async function listUserProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      name: true,
      repoUrl: true,
      branch: true,
      subdomain: true,
      currentDeploymentId: true,
      createdAt: true,
      updatedAt: true,
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
}

export async function getProjectById(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      userId: true,
      name: true,
      repoUrl: true,
      branch: true,
      subdomain: true,
      currentDeploymentId: true,
      createdAt: true,
      updatedAt: true,
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!project) {
    return null;
  }

  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  data: { name?: string; repoUrl?: string; branch?: string }
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    return null;
  }

  return prisma.project.update({
    where: { id: projectId },
    data,
  });
}

export async function deleteProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    return null;
  }

  return prisma.project.delete({
    where: { id: projectId },
  });
}

export async function setProjectEnvVars(
  userId: string,
  projectId: string,
  envVars: Record<string, string>
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    return null;
  }

  const encrypted = encryptEnvVars(envVars);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      envVarsEncrypted: encrypted as Prisma.InputJsonValue,
    },
  });

  return { success: true, count: Object.keys(envVars).length };
}

export interface EnvVarPreview {
  key: string;
  preview: string;
}

export async function getProjectEnvVars(
  userId: string,
  projectId: string
): Promise<EnvVarPreview[] | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    return null;
  }

  if (!project.envVarsEncrypted || typeof project.envVarsEncrypted !== 'object') {
    return [];
  }

  const decrypted = decryptEnvVars(project.envVarsEncrypted as Record<string, string>);

  return Object.entries(decrypted).map(([key, val]) => ({
    key,
    preview: maskSecret(val),
  }));
}

