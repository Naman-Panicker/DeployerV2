/**
 * Log Scrubber Service
 * Redacts injected secret environment variable values from build stdout/stderr
 * before publishing to Redis or persisting to logs.
 */

export interface LogScrubber {
  scrub: (line: string) => string;
}

/**
 * Creates a scrubber configured with secret values from the given environment variables.
 * Values shorter than minLength (default: 4) are ignored to avoid over-redacting
 * common words, booleans ("true"), or port numbers.
 */
export function createScrubber(
  envVars: Record<string, string> = {},
  minLength: number = 4
): LogScrubber {
  // Collect unique secret values meeting the minimum length criteria
  const rawSecrets = Object.values(envVars)
    .filter((val): val is string => typeof val === 'string' && val.trim().length >= minLength)
    .map((val) => val.trim());

  // Deduplicate and sort by length descending (longest secrets redacted first to avoid partial matches)
  const secrets = Array.from(new Set(rawSecrets)).sort((a, b) => b.length - a.length);

  return {
    scrub(line: string): string {
      if (!line || secrets.length === 0) return line;

      let scrubbed = line;
      for (const secret of secrets) {
        scrubbed = scrubbed.replaceAll(secret, '[REDACTED]');
      }
      return scrubbed;
    },
  };
}
