import readline from 'node:readline';

const streamType = process.argv[2] || 'stdout';
const singleMessage = process.argv[3];
const logServiceUrl = process.env.LOG_SERVICE_URL;
const deploymentId = process.env.DEPLOYMENT_ID;

async function sendLog(stream, line) {
  if (!logServiceUrl || !deploymentId) return;
  try {
    await fetch(`${logServiceUrl}/api/logs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deploymentId,
        stream,
        line,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Suppress network errors during log ingestion to avoid crashing builds
  }
}

async function main() {
  if (singleMessage !== undefined) {
    console.log(`[${streamType}] ${singleMessage}`);
    await sendLog(streamType, singleMessage);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  const pending = new Set();

  for await (const line of rl) {
    console.log(line);
    const p = sendLog(streamType, line);
    pending.add(p);
    p.finally(() => pending.delete(p));
  }

  await Promise.all(Array.from(pending));
}

main().catch((err) => {
  console.error('[Logger] Uncaught error:', err);
  process.exit(1);
});
