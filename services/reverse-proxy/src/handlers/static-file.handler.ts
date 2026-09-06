import { IncomingMessage, ServerResponse } from 'node:http';
import { extractSubdomain } from '../middleware/subdomain.js';
import { resolveSubdomain } from '../services/project-resolver.service.js';
import {
  fetchFromS3,
  isS3NotFoundError,
  S3NotConfiguredError,
  S3FetchResult,
} from '../services/s3-fetcher.service.js';
import { getMimeType, hasFileExtension } from '../utils/mime.js';

function renderHtmlPage(title: string, heading: string, message: string, code: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Deployer</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --code-bg: #21262d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.5rem;
      max-width: 540px;
      width: 100%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      text-transform: uppercase;
      background: var(--code-bg);
      border: 1px solid var(--border);
      color: var(--accent);
    }
    h1 {
      font-size: 1.5rem;
      color: #fff;
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    p {
      color: var(--text-muted);
      line-height: 1.6;
      font-size: 0.95rem;
      margin-bottom: 1.25rem;
    }
    .footer {
      font-size: 0.8rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      padding-top: 1rem;
      margin-top: 1rem;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Deployer Reverse Proxy • ${code}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    <div class="footer">
      <span>Deployer Serving Layer</span>
      <span>Port 8080</span>
    </div>
  </div>
</body>
</html>`;
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'X-Served-By': 'deployer-reverse-proxy',
  });
  res.end(html);
}

function getCacheControl(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html') || lower === 'index.html') {
    return 'public, max-age=0, must-revalidate';
  }

  // Check for hashed asset pattern: e.g. chunk-ABC12345.js or main.a1b2c3d4.css
  if (
    /[-.][a-f0-9]{8,}\.(js|css|wasm)$/i.test(lower) ||
    lower.startsWith('assets/')
  ) {
    return 'public, max-age=31536000, immutable';
  }

  return 'public, max-age=86400';
}

function streamS3Response(
  req: IncomingMessage,
  res: ServerResponse,
  s3Result: S3FetchResult,
  filePath: string,
  extraHeaders: Record<string, string> = {}
): void {
  // Check ETag for 304 Not Modified
  if (s3Result.etag && req.headers['if-none-match'] === s3Result.etag) {
    res.writeHead(304, {
      ETag: s3Result.etag,
      'Cache-Control': getCacheControl(filePath),
      'X-Served-By': 'deployer-reverse-proxy',
    });
    res.end();
    return;
  }

  const mimeType = getMimeType(filePath) || s3Result.contentType || 'application/octet-stream';
  const headers: Record<string, string | number> = {
    'Content-Type': mimeType,
    'Cache-Control': getCacheControl(filePath),
    'X-Served-By': 'deployer-reverse-proxy',
    ...extraHeaders,
  };

  if (s3Result.etag) {
    headers['ETag'] = s3Result.etag;
  }
  if (s3Result.contentLength !== undefined) {
    headers['Content-Length'] = s3Result.contentLength;
  }

  res.writeHead(200, headers);
  s3Result.body.pipe(res);
}

/**
 * Main request handler for all incoming HTTP requests to the reverse proxy.
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const rawHost = req.headers.host;
  const subdomain = extractSubdomain(rawHost);

  // 1. Root / Bare host landing page
  if (!subdomain) {
    const landingHtml = renderHtmlPage(
      'Deployer Serving Layer',
      'Deployer Reverse Proxy',
      'This is the static serving layer for Deployer. Access deployed projects via their assigned subdomain: <code>&lt;subdomain&gt;.localhost:8080</code>',
      200
    );
    sendHtml(res, 200, landingHtml);
    return;
  }

  // 2. Normalize and sanitize URL path
  const rawUrl = req.url || '/';

  // Security: reject directory traversal attempts in raw URL
  if (rawUrl.includes('..') || rawUrl.includes('\0')) {
    const forbiddenHtml = renderHtmlPage(
      'Bad Request',
      '400 Bad Request',
      'Path traversal is not permitted.',
      400
    );
    sendHtml(res, 400, forbiddenHtml);
    return;
  }

  let decodedRawUrl: string;
  try {
    decodedRawUrl = decodeURIComponent(rawUrl);
  } catch {
    const badRequestHtml = renderHtmlPage(
      'Bad Request',
      '400 Bad Request',
      'The requested URL path contains invalid encoding.',
      400
    );
    sendHtml(res, 400, badRequestHtml);
    return;
  }

  if (decodedRawUrl.includes('..') || decodedRawUrl.includes('\0')) {
    const forbiddenHtml = renderHtmlPage(
      'Bad Request',
      '400 Bad Request',
      'Path traversal is not permitted.',
      400
    );
    sendHtml(res, 400, forbiddenHtml);
    return;
  }

  const parsedUrl = new URL(rawUrl, `http://${rawHost || 'localhost'}`);
  let pathname = parsedUrl.pathname;

  // 3. Resolve subdomain to project
  let project;
  try {
    project = await resolveSubdomain(subdomain);
  } catch (error) {
    const errorHtml = renderHtmlPage(
      'Server Error',
      '500 Database Error',
      'Unable to look up project information. Please try again later.',
      500
    );
    sendHtml(res, 500, errorHtml);
    return;
  }

  if (!project) {
    const notFoundHtml = renderHtmlPage(
      'Project Not Found',
      '404 Project Not Found',
      `No active project with subdomain <strong>${subdomain}</strong> was found on this server.`,
      404
    );
    sendHtml(res, 404, notFoundHtml);
    return;
  }

  if (!project.currentDeploymentId) {
    const notDeployedHtml = renderHtmlPage(
      'Not Yet Deployed',
      '404 Not Yet Deployed',
      `Project <strong>${subdomain}</strong> exists, but has not completed any successful deployments yet.`,
      404
    );
    sendHtml(res, 404, notDeployedHtml);
    return;
  }

  // 4. Construct S3 relative path
  let relativePath = pathname.replace(/^\/+/, '');
  if (!relativePath || relativePath.endsWith('/')) {
    relativePath = `${relativePath}index.html`;
  }

  // 5. Fetch from S3 with SPA fallback
  try {
    const s3Result = await fetchFromS3(project.projectId, relativePath);
    streamS3Response(req, res, s3Result, relativePath);
  } catch (err: unknown) {
    if (isS3NotFoundError(err)) {
      // If path does not have an extension and is not index.html, try SPA fallback
      if (!hasFileExtension(relativePath) && relativePath !== 'index.html') {
        try {
          const fallbackResult = await fetchFromS3(project.projectId, 'index.html');
          streamS3Response(req, res, fallbackResult, 'index.html', {
            'X-Served-By': 'deployer-reverse-proxy (spa-fallback)',
          });
          return;
        } catch (fallbackErr: unknown) {
          if (!isS3NotFoundError(fallbackErr)) {
            console.error('[Reverse Proxy] SPA fallback unexpected error:', fallbackErr);
          }
        }
      }

      // Asset was not found
      const fileNotFoundHtml = renderHtmlPage(
        'File Not Found',
        '404 File Not Found',
        `The requested file <code>/${relativePath}</code> was not found for this deployment.`,
        404
      );
      sendHtml(res, 404, fileNotFoundHtml);
      return;
    }

    if (err instanceof S3NotConfiguredError) {
      const s3UnavailableHtml = renderHtmlPage(
        'Storage Unavailable',
        '503 Storage Not Configured',
        'AWS S3 credentials are not configured on this Deployer instance. Please check your environment variables.',
        503
      );
      sendHtml(res, 503, s3UnavailableHtml);
      return;
    }

    console.error('[Reverse Proxy] Unexpected S3 error:', err);
    const internalErrorHtml = renderHtmlPage(
      'Internal Error',
      '500 Internal Server Error',
      'An unexpected error occurred while fetching artifacts from storage.',
      500
    );
    sendHtml(res, 500, internalErrorHtml);
  }
}
