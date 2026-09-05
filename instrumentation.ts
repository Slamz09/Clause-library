/**
 * Next.js server-startup hook. Runs once when the server boots (nodejs
 * runtime), before any request is served.
 *
 * Imports lib/env.ts for its side effect: startup validation of required
 * environment variables, so a misconfigured deployment fails at boot with a
 * clear message instead of at first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/env');
  }
}
