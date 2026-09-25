import { describe, expect, it } from "vite-plus/test";
import { isRateLimited, withBackoff } from "./backoff.ts";

function rateLimited(reason = "rateLimitExceeded"): Response {
  return new Response(
    JSON.stringify({ error: { code: 403, errors: [{ reason, domain: "usageLimits" }] } }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/** Answers each call with the next response, and records every wait. */
function script(responses: Response[]) {
  const waits: number[] = [];
  let calls = 0;
  return {
    waits,
    calls: () => calls,
    request: async () => responses[calls++]!,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("a rate-limited Calendar response", () => {
  it("is a 403 whose reason is a rate limit, or a 429", async () => {
    expect(await isRateLimited(rateLimited())).toBe(true);
    expect(await isRateLimited(rateLimited("userRateLimitExceeded"))).toBe(true);
    expect(await isRateLimited(new Response("", { status: 429 }))).toBe(true);
  });

  it("is not any other 403, such as a missing permission", async () => {
    expect(await isRateLimited(rateLimited("forbidden"))).toBe(false);
    expect(await isRateLimited(new Response("not json", { status: 403 }))).toBe(false);
    expect(await isRateLimited(new Response("{}", { status: 200 }))).toBe(false);
  });
});

describe("a Calendar request with backoff", () => {
  it("is sent once when it succeeds", async () => {
    const s = script([new Response("{}", { status: 200 })]);
    const res = await withBackoff(s.request, { sleep: s.sleep, jitter: () => 0 });
    expect(res.status).toBe(200);
    expect(s.calls()).toBe(1);
    expect(s.waits).toEqual([]);
  });

  it("is retried after a rate limit, waiting twice as long each time", async () => {
    const s = script([
      rateLimited(),
      rateLimited(),
      rateLimited(),
      new Response("{}", { status: 200 }),
    ]);
    const res = await withBackoff(s.request, { sleep: s.sleep, jitter: () => 0 });
    expect(res.status).toBe(200);
    expect(s.waits).toEqual([1000, 2000, 4000]);
  });

  it("adds jitter so retries from several requests do not line up", async () => {
    const s = script([rateLimited(), new Response("{}", { status: 200 })]);
    await withBackoff(s.request, { sleep: s.sleep, jitter: () => 250 });
    expect(s.waits).toEqual([1250]);
  });

  it("gives up after its last attempt and returns the rate-limited response", async () => {
    const s = script([rateLimited(), rateLimited(), rateLimited()]);
    const res = await withBackoff(s.request, {
      sleep: s.sleep,
      jitter: () => 0,
      attempts: 3,
    });
    expect(res.status).toBe(403);
    expect(s.calls()).toBe(3);
    expect(s.waits).toEqual([1000, 2000]);
  });

  it("does not retry other failures", async () => {
    const s = script([new Response("{}", { status: 404 })]);
    const res = await withBackoff(s.request, { sleep: s.sleep, jitter: () => 0 });
    expect(res.status).toBe(404);
    expect(s.calls()).toBe(1);
  });

  it("leaves the response readable by the caller", async () => {
    const s = script([rateLimited(), rateLimited()]);
    const res = await withBackoff(s.request, { sleep: s.sleep, jitter: () => 0, attempts: 2 });
    expect(await res.json()).toMatchObject({ error: { code: 403 } });
  });
});
