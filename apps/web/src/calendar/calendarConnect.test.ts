import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  captureCalendarReturn,
  clearCalendarReturn,
  consentUrl,
  isCalendarReturn,
  pendingCalendarReturn,
} from "./calendarConnect.ts";

const trip = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const redirectUri = "https://klay376014.github.io/what-to-eat/app/";

function openAt(address: string) {
  window.history.replaceState(null, "", address);
}

/** Starts connecting, as the button does, and returns the consent URL's parameters. */
async function startConnecting(): Promise<URLSearchParams> {
  const url = new URL(await consentUrl({ clientId: "calendar-client", tripId: trip, redirectUri }));
  expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  return url.searchParams;
}

afterEach(() => {
  clearCalendarReturn();
  window.sessionStorage.clear();
  openAt("/");
});

describe("connecting a calendar sends the member to Google", () => {
  test("asking for the trip calendar scope and nothing else", async () => {
    const params = await startConnecting();
    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(params.get("client_id")).toBe("calendar-client");
    expect(params.get("redirect_uri")).toBe(redirectUri);
    expect(params.get("response_type")).toBe("code");
  });

  test("asking for lasting access, so meals are written while they are away", async () => {
    const params = await startConnecting();
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
  });

  test("with a PKCE challenge and a fresh state each time", async () => {
    const first = await startConnecting();
    const second = await startConnecting();
    expect(first.get("code_challenge_method")).toBe("S256");
    expect(first.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.get("state")).not.toBe(second.get("state"));
    expect(first.get("code_challenge")).not.toBe(second.get("code_challenge"));
  });
});

describe("coming back from Google", () => {
  test("keeps the code for the trip it was for, and takes it out of the address bar", async () => {
    const params = await startConnecting();
    const state = params.get("state")!;
    openAt(`/?state=${state}&code=4%2F0Ab&scope=calendar&authuser=0&prompt=consent`);

    captureCalendarReturn();

    const returned = pendingCalendarReturn();
    expect(returned).toMatchObject({ tripId: trip, code: "4/0Ab", redirectUri });
    expect(returned && "codeVerifier" in returned && returned.codeVerifier).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(window.location.search).toBe("");
  });

  test("with a verifier that matches the challenge Google was shown", async () => {
    const params = await startConnecting();
    openAt(`/?state=${params.get("state")}&code=c`);
    captureCalendarReturn();

    const returned = pendingCalendarReturn();
    if (!returned || !("codeVerifier" in returned)) throw new Error("no code kept");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(returned.codeVerifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(params.get("code_challenge"));
  });

  test("says so when the member declined", async () => {
    const params = await startConnecting();
    openAt(`/?error=access_denied&state=${params.get("state")}`);

    captureCalendarReturn();

    expect(pendingCalendarReturn()).toEqual({
      tripId: trip,
      error: "Google Calendar wasn't connected: access was not allowed.",
    });
    expect(window.location.search).toBe("");
  });

  test("refuses an answer this tab did not ask for", async () => {
    await startConnecting();
    openAt("/?state=calendar-forged&code=attacker-code");

    captureCalendarReturn();

    expect(pendingCalendarReturn()).toEqual({
      tripId: null,
      error: "That answer from Google wasn't for this tab, so nothing was connected. Try again.",
    });
    expect(window.location.search).toBe("");
  });

  test("uses a state only once", async () => {
    const params = await startConnecting();
    openAt(`/?state=${params.get("state")}&code=c`);
    captureCalendarReturn();
    clearCalendarReturn();

    openAt(`/?state=${params.get("state")}&code=c`);
    captureCalendarReturn();

    expect(pendingCalendarReturn()).toMatchObject({ tripId: null });
  });

  test("leaves every other address alone, a sign-in return included", () => {
    openAt("/?code=supabase-code&day=2026-10-03");

    captureCalendarReturn();

    expect(pendingCalendarReturn()).toBeNull();
    expect(window.location.search).toBe("?code=supabase-code&day=2026-10-03");
  });
});

describe("telling the calendar's return from a sign-in return", () => {
  test("goes by the state this app gives calendar requests", async () => {
    const state = (await startConnecting()).get("state")!;
    expect(isCalendarReturn({ state, code: "c" })).toBe(true);
    expect(isCalendarReturn({ state, error: "access_denied" })).toBe(true);
    expect(isCalendarReturn({ code: "c" })).toBe(false);
    expect(isCalendarReturn({ error: "server_error" })).toBe(false);
  });
});
