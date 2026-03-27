// Lightweight Sentry error reporter for Vercel serverless functions.
// Uses Sentry's HTTP store API — no npm package required.

const SENTRY_DSN = process.env.SENTRY_DSN ||
  'https://4e0916c95559b0d47da8759859e71905@o4511115058085888.ingest.de.sentry.io/4511115062935632';

// Parse DSN once
const DSN_MATCH = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
const SENTRY_KEY        = DSN_MATCH?.[1];
const SENTRY_HOST       = DSN_MATCH?.[2];
const SENTRY_PROJECT_ID = DSN_MATCH?.[3];
const STORE_URL = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/store/`;

/**
 * Report an error to Sentry from a serverless function.
 * Fire-and-forget — never throws, never blocks the response.
 *
 * @param {Error} err
 * @param {object} context  Extra key/value pairs attached to the event
 */
export async function captureException(err, context = {}) {
  if (!SENTRY_KEY) return;
  try {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    await fetch(STORE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${SENTRY_KEY}, sentry_client=onetouch-api/1.0`,
      },
      body: JSON.stringify({
        event_id:    eventId,
        timestamp:   new Date().toISOString(),
        platform:    'node',
        level:       'error',
        environment: process.env.VERCEL_ENV || 'production',
        release:     'onetouch@1.0.0',
        exception: {
          values: [{
            type:  err?.name  || 'Error',
            value: err?.message || String(err),
            stacktrace: {
              frames: (err?.stack || '')
                .split('\n')
                .slice(1)
                .map(line => ({ filename: line.trim() }))
            }
          }]
        },
        extra: context,
      }),
    });
  } catch {
    // Never let Sentry reporting crash the handler
  }
}
