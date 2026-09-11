import { Request, Response } from 'express';
import { publishToChannel } from '../services/redis-publisher.service.js';

/**
 * Controller for ingesting build logs from containers.
 * POST /api/logs/ingest
 * Body: { deploymentId: string, stream?: string, line: string, timestamp?: string }
 */
export async function ingestLog(req: Request, res: Response): Promise<void> {
  const { deploymentId, stream, line, timestamp } = req.body;

  if (!deploymentId || typeof deploymentId !== 'string') {
    res.status(400).json({ error: 'deploymentId (string) is required' });
    return;
  }

  if (typeof line !== 'string') {
    res.status(400).json({ error: 'line (string) is required' });
    return;
  }

  const payload = JSON.stringify({
    stream: typeof stream === 'string' ? stream : 'stdout',
    line,
    timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
  });

  try {
    await publishToChannel(`logs:${deploymentId}`, payload);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(`[Ingest Controller] Error publishing log for ${deploymentId}:`, err);
    res.status(500).json({ error: 'Failed to ingest log line' });
  }
}
