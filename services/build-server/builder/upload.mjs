import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';

const formsJson = process.env.S3_UPLOAD_FORMS;
const outputDir = process.env.OUTPUT_DIR || '/app';
const logServiceUrl = process.env.LOG_SERVICE_URL;
const deploymentId = process.env.DEPLOYMENT_ID;

async function log(stream, line) {
  console.log(`[Upload Script] ${line}`);
  if (logServiceUrl && deploymentId) {
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
      // Ignore network errors in log shipping
    }
  }
}

async function walkDirectory(dir, rootDir = dir) {
  let results = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Ignore git, node_modules, and hidden system directories
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await walkDirectory(fullPath, rootDir);
      results = results.concat(nested);
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      results.push({
        absolutePath: fullPath,
        relativePath,
      });
    }
  }

  return results;
}

async function uploadFileToForm(formConfig, relativePath, absolutePath, mimeType, fileBuffer) {
  const formData = new FormData();

  // AWS S3 requires form fields to appear BEFORE the file field
  for (const [key, val] of Object.entries(formConfig.fields)) {
    if (key === 'key') {
      formData.append('key', `${formConfig.prefix}${relativePath}`);
    } else {
      formData.append(key, val);
    }
  }

  if (mimeType) {
    formData.append('Content-Type', mimeType);
  }

  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append('file', blob, path.basename(absolutePath));

  const response = await fetch(formConfig.url, {
    method: 'POST',
    body: formData,
  });

  if (response.status >= 400) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `S3 POST failed with HTTP ${response.status} for ${formConfig.prefix}${relativePath}: ${errorText}`
    );
  }
}

async function runUploadsWithLimit(tasks, limit = 5) {
  let index = 0;
  const executing = new Set();

  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(Array.from(executing));
}

async function main() {
  if (!formsJson) {
    throw new Error('Missing S3_UPLOAD_FORMS environment variable');
  }

  const forms = JSON.parse(formsJson);

  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory does not exist: ${outputDir}`);
  }

  const files = await walkDirectory(outputDir);
  await log('stdout', `Found ${files.length} artifact file(s) in ${outputDir} to upload`);

  if (files.length === 0) {
    await log('stdout', 'No files found to upload.');
    return;
  }

  if (forms.isPlaceholder) {
    await log(
      'stdout',
      `AWS credentials are placeholders — verified ${files.length} local files, simulating successful S3 upload.`
    );
    return;
  }

  let completedCount = 0;
  const uploadTasks = files.map((file) => async () => {
    const mimeType = mime.lookup(file.absolutePath) || 'application/octet-stream';
    const buffer = await fs.promises.readFile(file.absolutePath);

    // Upload to live serving prefix (__outputs/)
    await uploadFileToForm(forms.outputs, file.relativePath, file.absolutePath, mimeType, buffer);

    // Upload to immutable snapshot prefix (__history/)
    await uploadFileToForm(forms.history, file.relativePath, file.absolutePath, mimeType, buffer);

    completedCount++;
    if (completedCount % 10 === 0 || completedCount === files.length) {
      await log('stdout', `Uploaded ${completedCount}/${files.length} files to S3...`);
    }
  });

  await runUploadsWithLimit(uploadTasks, 5);
  await log('stdout', `Successfully uploaded all ${files.length} files to S3!`);
}

main().catch(async (err) => {
  await log('stderr', `Upload failed: ${err.message}`);
  process.exit(1);
});
