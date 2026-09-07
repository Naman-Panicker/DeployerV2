import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '@deployer/config';
import { githubWebhookSchema } from '../utils/validation.js';
import { triggerWebhookDeploy } from '../services/deployment.service.js';

export function verifyGitHubSignature(req: Request): boolean {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret configured, allow (dev mode / optional verification)
    return true;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    return false;
  }

  const rawBody: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

export async function githubWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!verifyGitHubSignature(req)) {
      res.status(401).json({ error: 'Invalid or missing GitHub webhook signature' });
      return;
    }

    const payload = githubWebhookSchema.parse(req.body);

    const repoUrl = payload.repository?.clone_url || payload.repository?.html_url;
    if (!repoUrl) {
      res.status(400).json({ error: 'Repository URL not found in webhook payload' });
      return;
    }

    let branch: string | undefined;
    if (payload.ref && payload.ref.startsWith('refs/heads/')) {
      branch = payload.ref.replace('refs/heads/', '');
    } else if (payload.repository?.default_branch) {
      branch = payload.repository.default_branch;
    }

    const commitHash = payload.head_commit?.id;

    console.log(
      `[API Gateway] Received GitHub webhook for repo: ${repoUrl}, branch: ${branch || 'default'}, commit: ${commitHash || 'none'}`
    );

    const deployment = await triggerWebhookDeploy(repoUrl, branch, commitHash);

    if (!deployment) {
      res.status(200).json({
        message: 'Webhook received, but no linked project matched the repository URL',
        repoUrl,
        branch,
      });
      return;
    }

    res.status(202).json({
      message: 'Deployment triggered via webhook',
      deployment: {
        id: deployment.id,
        projectId: deployment.projectId,
        status: deployment.status,
        triggerType: deployment.triggerType,
      },
    });
  } catch (err) {
    next(err);
  }
}
