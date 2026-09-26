/*
 * Sending one email through Resend (#15; ADR 0009), by its REST API.
 *
 * Every email goes with an Idempotency-Key: its outbox key. Resend remembers
 * a key for 24 hours and answers a repeat with the email it already sent, so
 * a send whose answer was lost (the function timed out, the network dropped)
 * is safe to repeat: the recipient still gets one email.
 *
 * The API key goes in the Authorization header and nowhere else, and is
 * struck out of anything that comes back, so no error message recorded or
 * logged can carry it.
 *
 * Pure apart from the injected fetch and clock; imported by the notify Edge
 * Function.
 */
import { withBackoff, type BackoffOptions } from "../calendar/backoff.ts";

export const RESEND_URL = "https://api.resend.com/emails";

export interface ResendConfig {
  apiKey: string;
  /** "Name <address>" on the verified sending domain. */
  from: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type DeliveryOutcome =
  | { sent: true; providerId: string | null }
  /** `retry`: worth trying again on a later pass; otherwise it never will be sent. */
  | { sent: false; retry: boolean; error: string };

export interface SendOptions extends Pick<BackoffOptions, "sleep" | "jitter"> {
  fetchFn?: (request: Request) => Promise<Response>;
}

/** Sends `message` once under `idempotencyKey`, waiting out a rate limit a few times. */
export async function sendEmail(
  config: ResendConfig,
  message: EmailMessage,
  idempotencyKey: string,
  { fetchFn = (r) => fetch(r), sleep, jitter }: SendOptions = {},
): Promise<DeliveryOutcome> {
  const redact = (text: string) => text.replaceAll(config.apiKey, "[redacted]");
  const body = JSON.stringify({
    from: config.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  let res: Response;
  try {
    res = await withBackoff(
      () =>
        fetchFn(
          new Request(RESEND_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body,
          }),
        ),
      { attempts: 3, baseMs: 1000, sleep, jitter },
    );
  } catch (error) {
    return {
      sent: false,
      retry: true,
      error: redact(error instanceof Error ? error.message : String(error)),
    };
  }

  const answer = (await res.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    message?: string;
  };
  if (res.ok) return { sent: true, providerId: answer.id ?? null };

  const error = redact(`Resend ${res.status}: ${answer.message ?? answer.name ?? res.statusText}`);
  // Too fast, Resend failing, or this key still being sent by another pass.
  const retry =
    res.status === 429 ||
    res.status >= 500 ||
    (res.status === 409 && answer.name === "concurrent_idempotent_requests");
  return { sent: false, retry, error: error.slice(0, 500) };
}
