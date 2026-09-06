/**
 * Extracts the project subdomain from the incoming HTTP Host header.
 *
 * Supported formats:
 * - "<subdomain>.localhost:8080"  -> "<subdomain>"
 * - "<subdomain>.localhost"       -> "<subdomain>"
 * - "localhost:8080"              -> null
 * - "127.0.0.1:8080"              -> null
 * - "<subdomain>.example.com"     -> "<subdomain>"
 */
export function extractSubdomain(host: string | undefined): string | null {
  if (!host) {
    return null;
  }

  // Remove port if present
  const hostname = host.split(':')[0].trim().toLowerCase();

  // Guard against IP addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  ) {
    return null;
  }

  // Handle .localhost subdomains (e.g., "my-app.localhost")
  if (hostname.endsWith('.localhost')) {
    const sub = hostname.slice(0, -'.localhost'.length);
    return sub.length > 0 ? sub : null;
  }

  // Handle general subdomains (e.g., "my-app.customdomain.com")
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts[0].length > 0 ? parts[0] : null;
  }

  return null;
}
