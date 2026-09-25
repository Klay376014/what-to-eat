import { describe, expect, it } from "vite-plus/test";
import { CALENDAR_GONE, lapseFrom } from "./calendarLapse.ts";

describe("whether Google's refusal means the calendar connection is dead", () => {
  it("is revoked when Google refuses the refresh token", () => {
    // What the token endpoint answers for a revoked token, or one unused for six months.
    expect(lapseFrom({ status: 400, reason: "invalid_grant", from: "token" })).toBe("revoked");
  });

  it("is revoked when the Calendar API refuses the access token", () => {
    expect(lapseFrom({ status: 401, reason: "authError", from: "calendar" })).toBe("revoked");
  });

  it("is gone when the trip calendar itself no longer exists", () => {
    expect(lapseFrom({ status: 404, reason: CALENDAR_GONE, from: "calendar" })).toBe(
      "calendar_gone",
    );
  });

  it("is not a lapse when the app's own client credentials are wrong", () => {
    // A wrong or rotated client secret: every holder's token is still good.
    expect(lapseFrom({ status: 401, reason: "invalid_client", from: "token" })).toBeNull();
    expect(lapseFrom({ status: 400, reason: "unauthorized_client", from: "token" })).toBeNull();
  });

  it("is not a lapse when Google is down, throttling, or refused one event", () => {
    expect(lapseFrom({ status: 500, reason: null, from: "token" })).toBeNull();
    expect(lapseFrom({ status: 500, reason: null, from: "calendar" })).toBeNull();
    expect(lapseFrom({ status: 403, reason: "rateLimitExceeded", from: "calendar" })).toBeNull();
    expect(lapseFrom({ status: 400, reason: "invalid", from: "calendar" })).toBeNull();
    expect(lapseFrom({ status: 404, reason: "notFound", from: "calendar" })).toBeNull();
  });
});
