import { describe, expect, test } from "vite-plus/test";
import { digestDue, dueDigestDay } from "./digestSchedule.ts";

const at = (iso: string) => new Date(iso);

describe("digestDue", () => {
  test("a trip's digest is due from 08:00 on its own clock", () => {
    // Taipei is UTC+8 all year: 08:00 there is 00:00 UTC.
    expect(digestDue("Asia/Taipei", at("2026-10-03T00:00:00Z"))).toBe("2026-10-03");
    expect(digestDue("Asia/Taipei", at("2026-10-02T23:59:59Z"))).toBeNull();
  });

  test("a trip whose 08:00 falls on the previous UTC day gets that local day's digest", () => {
    // Tokyo, UTC+9: 08:00 on Sat 3 Oct is 23:00 UTC on Fri 2 Oct.
    expect(digestDue("Asia/Tokyo", at("2026-10-02T23:00:00Z"))).toBe("2026-10-03");
    expect(digestDue("Asia/Tokyo", at("2026-10-02T22:59:00Z"))).toBeNull();
    // Kiritimati, UTC+14: 08:00 on 3 Oct is 18:00 UTC on 2 Oct.
    expect(digestDue("Pacific/Kiritimati", at("2026-10-02T18:00:00Z"))).toBe("2026-10-03");
  });

  test("a trip behind UTC gets its digest later in the UTC day", () => {
    // Los Angeles in October is UTC−7: 08:00 is 15:00 UTC.
    expect(digestDue("America/Los_Angeles", at("2026-10-03T14:59:00Z"))).toBeNull();
    expect(digestDue("America/Los_Angeles", at("2026-10-03T15:00:00Z"))).toBe("2026-10-03");
    // …and 23:00 UTC is still the afternoon of the same local day.
    expect(digestDue("America/Los_Angeles", at("2026-10-03T23:00:00Z"))).toBe("2026-10-03");
  });

  test("zones a quarter or half hour off the hour are due on their own 08:00", () => {
    // Kathmandu is UTC+5:45: 08:00 is 02:15 UTC.
    expect(digestDue("Asia/Kathmandu", at("2026-10-03T02:14:00Z"))).toBeNull();
    expect(digestDue("Asia/Kathmandu", at("2026-10-03T02:15:00Z"))).toBe("2026-10-03");
  });

  test("the digest stays due for the rest of that local day, so a late run still sends it", () => {
    // 23:59 in Tokyo on 3 Oct.
    expect(digestDue("Asia/Tokyo", at("2026-10-03T14:59:00Z"))).toBe("2026-10-03");
    // One minute later it is 4 Oct, 00:00, and nothing is due until 08:00.
    expect(digestDue("Asia/Tokyo", at("2026-10-03T15:00:00Z"))).toBeNull();
  });

  test("08:00 follows the clocks across a DST change", () => {
    // London springs forward on 29 Mar 2026: 08:00 BST is 07:00 UTC.
    expect(digestDue("Europe/London", at("2026-03-29T06:59:00Z"))).toBeNull();
    expect(digestDue("Europe/London", at("2026-03-29T07:00:00Z"))).toBe("2026-03-29");
    // The day before, still GMT, 08:00 is 08:00 UTC.
    expect(digestDue("Europe/London", at("2026-03-28T07:59:00Z"))).toBeNull();
    expect(digestDue("Europe/London", at("2026-03-28T08:00:00Z"))).toBe("2026-03-28");
  });
});

describe("dueDigestDay", () => {
  const tokyo = { timezone: "Asia/Tokyo", endDate: "2026-10-05" };
  // 08:00 on Sat 3 Oct in Tokyo.
  const morning = at("2026-10-02T23:00:00Z");

  test("a trip with no digest yet today gets one", () => {
    expect(dueDigestDay(tokyo, "2026-10-02", morning)).toBe("2026-10-03");
    expect(dueDigestDay(tokyo, null, morning)).toBe("2026-10-03");
  });

  test("a trip that has had today's digest gets no second one", () => {
    expect(dueDigestDay(tokyo, "2026-10-03", morning)).toBeNull();
    expect(dueDigestDay(tokyo, "2026-10-03", at("2026-10-03T10:00:00Z"))).toBeNull();
  });

  test("nothing is due before 08:00 on the trip's clock", () => {
    expect(dueDigestDay(tokyo, "2026-10-02", at("2026-10-02T22:59:00Z"))).toBeNull();
  });

  test("a trip that has ended gets no more digests", () => {
    const ended = { ...tokyo, endDate: "2026-10-02" };
    expect(dueDigestDay(ended, "2026-10-01", morning)).toBeNull();
    // Its last day still gets one.
    const lastDay = { ...tokyo, endDate: "2026-10-03" };
    expect(dueDigestDay(lastDay, "2026-10-02", morning)).toBe("2026-10-03");
  });

  test("an everyday trip, with no dates, gets one every day", () => {
    expect(dueDigestDay({ timezone: "Asia/Tokyo", endDate: null }, null, morning)).toBe(
      "2026-10-03",
    );
  });

  test("one run for two trips in different zones: each on its own morning", () => {
    // 23:30 UTC on 2 Oct: 08:30 on 3 Oct in Tokyo, 16:30 on 2 Oct in Los Angeles.
    const now = at("2026-10-02T23:30:00Z");
    const la = { timezone: "America/Los_Angeles", endDate: null };

    expect(dueDigestDay(tokyo, "2026-10-02", now)).toBe("2026-10-03");
    expect(dueDigestDay(la, "2026-10-02", now)).toBeNull();
    expect(dueDigestDay(la, "2026-10-01", now)).toBe("2026-10-02");
  });
});
