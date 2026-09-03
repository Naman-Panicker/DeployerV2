import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(50, 'Project name too long'),
  repoUrl: z.string().url('Invalid repository URL'),
  branch: z.string().default('main'),
  subdomain: z
    .string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(50, 'Subdomain must be at most 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Subdomain must contain only lowercase alphanumeric characters and hyphens')
    .optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  repoUrl: z.string().url().optional(),
  branch: z.string().min(1).optional(),
});

export const envVarsSchema = z.record(z.string(), z.string());

export const rollbackSchema = z.object({
  deploymentId: z.string().uuid('Invalid deployment UUID'),
});

export const githubWebhookSchema = z.object({
  ref: z.string().optional(),
  repository: z
    .object({
      name: z.string().optional(),
      clone_url: z.string().optional(),
      html_url: z.string().optional(),
      default_branch: z.string().optional(),
    })
    .optional(),
  head_commit: z
    .object({
      id: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type EnvVarsInput = z.infer<typeof envVarsSchema>;
export type RollbackInput = z.infer<typeof rollbackSchema>;
