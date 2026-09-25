/*
 * Backing off from Google Calendar's rate limits (#12). What binds this app
 * is not the API's request quota but Calendar's unpublished abuse throttles
 * on creating calendars and sharing with people, which answer 403
 * rateLimitExceeded (or 429). The Calendar docs ask for exponential backoff.
 *
 * Pure apart from the injected clock; imported by the calendar Edge Function.
 */

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

/** Whether Google refused the request for going too fast. Leaves `res` unread. */
export async function isRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as { error?: { errors?: { reason?: string }[] } };
    return (body.error?.errors ?? []).some((e) => RATE_LIMIT_REASONS.has(e.reason ?? ""));
  } catch {
    return false;
  }
}

export interface BackoffOptions {
  /** How many times to send the request in all. */
  attempts?: number;
  /** The first wait, doubled after each further refusal. */
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Extra wait added to each one, so parallel retries spread out. */
  jitter?: () => number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends the request, and again after a growing wait each time Google says it
 * is rate limited. Any other answer, and the last one, is returned as is.
 */
export async function withBackoff(
  request: () => Promise<Response>,
  {
    attempts = 5,
    baseMs = 1000,
    sleep = wait,
    jitter = () => Math.random() * 500,
  }: BackoffOptions = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await request();
    if (attempt >= attempts || !(await isRateLimited(res))) return res;
    await sleep(baseMs * 2 ** (attempt - 1) + jitter());
  }
}
