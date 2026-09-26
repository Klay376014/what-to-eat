import { describe, expect, test } from "vite-plus/test";
import { sendEmail } from "./delivery.ts";

const config = { apiKey: "re_secret_123", from: "What to eat <notify@mail.ivy-cudgel.com>" };
const email = {
  to: "bob@example.com",
  subject: "Tokyo: Dinner, Sat 3 Oct is Ichiran",
  text: "Alice decided on Ichiran.",
  html: "<p>Alice decided on Ichiran.</p>",
};
const noWait = { sleep: async () => {}, jitter: () => 0 };

function answering(...responses: (Response | Error)[]) {
  const requests: Request[] = [];
  const fetchFn = async (input: Request) => {
    requests.push(input);
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { requests, fetchFn };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("sendEmail", () => {
  test("sends through Resend under the email's key, and reports the id it was given", async () => {
    const { requests, fetchFn } = answering(json(200, { id: "e-1" }));

    const outcome = await sendEmail(config, email, "decision:41:bob", { fetchFn, ...noWait });

    expect(outcome).toEqual({ sent: true, providerId: "e-1" });
    const [request] = requests;
    expect(request!.url).toBe("https://api.resend.com/emails");
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("Idempotency-Key")).toBe("decision:41:bob");
    expect(await request!.json()).toEqual({
      from: config.from,
      to: ["bob@example.com"],
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  });

  test("the API key travels only in the Authorization header", async () => {
    const { requests, fetchFn } = answering(json(200, { id: "e-1" }));

    await sendEmail(config, email, "k", { fetchFn, ...noWait });

    const request = requests[0]!;
    expect(request.headers.get("Authorization")).toBe("Bearer re_secret_123");
    expect(request.url).not.toContain("re_secret");
    expect(await request.text()).not.toContain("re_secret");
  });

  test("a refusal is reported with Resend's reason, and never repeats the key", async () => {
    const { fetchFn } = answering(
      json(403, { name: "validation_error", message: "API key re_secret_123 is not allowed" }),
    );

    const outcome = await sendEmail(config, email, "k", { fetchFn, ...noWait });

    expect(outcome).toMatchObject({ sent: false, retry: false });
    expect(outcome.sent === false && outcome.error).toContain("403");
    expect(JSON.stringify(outcome)).not.toContain("re_secret_123");
  });

  test("going too fast is waited out and sent again", async () => {
    const { requests, fetchFn } = answering(
      json(429, { name: "rate_limit_exceeded", message: "Too many requests" }),
      json(200, { id: "e-2" }),
    );

    const outcome = await sendEmail(config, email, "k", { fetchFn, ...noWait });

    expect(outcome).toEqual({ sent: true, providerId: "e-2" });
    expect(requests.map((r) => r.headers.get("Idempotency-Key"))).toEqual(["k", "k"]);
  });

  test("still too fast after waiting: tried again on a later pass", async () => {
    const limited = () => json(429, { message: "Too many requests" });
    const { fetchFn } = answering(limited(), limited(), limited());

    expect(await sendEmail(config, email, "k", { fetchFn, ...noWait })).toMatchObject({
      sent: false,
      retry: true,
    });
  });

  test("Resend failing, or the network, is tried again on a later pass", async () => {
    const down = answering(json(503, { message: "Service unavailable" }));
    expect(await sendEmail(config, email, "k", { fetchFn: down.fetchFn, ...noWait })).toMatchObject(
      { sent: false, retry: true },
    );

    const offline = answering(new TypeError("error sending request"));
    expect(
      await sendEmail(config, email, "k", { fetchFn: offline.fetchFn, ...noWait }),
    ).toMatchObject({ sent: false, retry: true, error: "error sending request" });
  });

  test("the same key still being sent by another pass is tried again later", async () => {
    const { fetchFn } = answering(
      json(409, { name: "concurrent_idempotent_requests", message: "In progress" }),
    );

    expect(await sendEmail(config, email, "k", { fetchFn, ...noWait })).toMatchObject({
      sent: false,
      retry: true,
    });
  });
});
