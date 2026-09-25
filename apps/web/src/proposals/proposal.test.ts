import { describe, expect, test } from "vite-plus/test";
import {
  MAX_NOTE_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  formatProposedAt,
  mapsUrl,
  proposerLabel,
  validateMapsLink,
  validateNote,
  validatePlaceName,
} from "./proposal.ts";

describe("validatePlaceName", () => {
  test("a restaurant's name is fine", () => {
    expect(validatePlaceName("Afuri Ramen Ebisu")).toBeNull();
  });

  test("a blank name is refused", () => {
    expect(validatePlaceName("   ")).toBe("Say which restaurant.");
  });

  test("the limit applies to the trimmed name, as the database stores it", () => {
    expect(validatePlaceName(` ${"x".repeat(MAX_PLACE_NAME_LENGTH)} `)).toBeNull();
    expect(validatePlaceName("x".repeat(MAX_PLACE_NAME_LENGTH + 1))).toBe(
      "Keep the name to 200 characters or fewer.",
    );
  });
});

describe("validateMapsLink", () => {
  test("no link is fine: the link is optional", () => {
    expect(validateMapsLink("")).toBeNull();
    expect(validateMapsLink("   ")).toBeNull();
  });

  test("a Maps short link or a full Maps address is fine", () => {
    expect(validateMapsLink("https://maps.app.goo.gl/AbCdEf123?g_st=ic")).toBeNull();
    expect(validateMapsLink(" https://www.google.co.jp/maps/place/Tsuta ")).toBeNull();
  });

  test("something that is not a web link is refused, with how to fix it", () => {
    const fix = "Paste the whole link, starting with https://";
    expect(validateMapsLink("maps.app.goo.gl/AbCdEf123")).toBe(fix);
    expect(validateMapsLink("javascript:alert(1)")).toBe(fix);
    expect(validateMapsLink("Afuri Ramen")).toBe(fix);
  });

  test("a link missing the // after https: is refused, as the database would refuse it", () => {
    const fix = "Paste the whole link, starting with https://";
    expect(validateMapsLink("https:maps.app.goo.gl/AbCdEf123")).toBe(fix);
    expect(validateMapsLink("https:/maps.app.goo.gl/AbCdEf123")).toBe(fix);
  });

  test("an absurdly long link is refused", () => {
    expect(validateMapsLink(`https://maps.app.goo.gl/${"x".repeat(2000)}`)).toBe(
      "That link is too long to keep.",
    );
  });
});

describe("validateNote", () => {
  test("no note, or a short one, is fine", () => {
    expect(validateNote("")).toBeNull();
    expect(validateNote("No reservation needed")).toBeNull();
  });

  test("a note past the limit is refused", () => {
    expect(validateNote("x".repeat(MAX_NOTE_LENGTH + 1))).toBe(
      "Keep the note to 1000 characters or fewer.",
    );
  });
});

describe("mapsUrl", () => {
  const typed = { sourceUrl: null, lat: null, lng: null };

  test("a proposal with a Maps link opens that link, which lands on the place's own page", () => {
    expect(
      mapsUrl({
        placeName: "Ichiran Shibuya",
        sourceUrl: "https://maps.app.goo.gl/2avW6UjkkDbgHUwPA",
        lat: 25.0140156,
        lng: 121.542539,
      }),
    ).toBe("https://maps.app.goo.gl/2avW6UjkkDbgHUwPA");
    expect(
      mapsUrl({
        placeName: "Tsuta",
        sourceUrl: "https://www.google.co.jp/maps/place/Tsuta/@35.7,139.7,17z",
        lat: null,
        lng: null,
      }),
    ).toBe("https://www.google.co.jp/maps/place/Tsuta/@35.7,139.7,17z");
  });

  test("a link that is not http(s) is never linked to", () => {
    for (const sourceUrl of ["javascript:alert(1)", "data:text/html,hi", "not a link"]) {
      expect(mapsUrl({ ...typed, placeName: "Afuri", sourceUrl }), sourceUrl).toBe(
        "https://www.google.com/maps/search/?api=1&query=Afuri",
      );
    }
  });

  test("without a link, searches for the name through the official Maps URLs scheme", () => {
    expect(mapsUrl({ ...typed, placeName: "Afuri Ramen Ebisu" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Afuri%20Ramen%20Ebisu",
    );
  });

  test("encodes a name that would otherwise break the address", () => {
    const url = new URL(mapsUrl({ ...typed, placeName: "Tsuta & Co #2 / 蔦" }));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("Tsuta & Co #2 / 蔦");
  });

  test("without a link but with coordinates, searches for those, so it lands on that branch", () => {
    expect(mapsUrl({ placeName: "Afuri", sourceUrl: null, lat: 35.6467, lng: 139.7101 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.6467%2C139.7101",
    );
  });
});

describe("proposerLabel", () => {
  test("names the proposer, or says it was you", () => {
    expect(
      proposerLabel({ proposedBy: "u1", proposedByMe: false, proposerName: "Alice Chen" }),
    ).toBe("Alice Chen");
    expect(
      proposerLabel({ proposedBy: "u1", proposedByMe: true, proposerName: "Alice Chen" }),
    ).toBe("you");
  });

  test("still says something when there is no name, or no account any more", () => {
    expect(proposerLabel({ proposedBy: "u1", proposedByMe: false, proposerName: null })).toBe(
      "a member with no name",
    );
    expect(proposerLabel({ proposedBy: null, proposedByMe: false, proposerName: null })).toBe(
      "a member who deleted their account",
    );
  });
});

describe("formatProposedAt", () => {
  test("says when in the trip's own timezone, never the browser's", () => {
    // 02:00 UTC is 11:00 in Tokyo and 22:00 the evening before in New York.
    expect(formatProposedAt("2026-09-24T02:00:00Z", "Asia/Tokyo")).toBe("Thu 24 Sep, 11:00");
    expect(formatProposedAt("2026-09-24T02:00:00Z", "America/New_York")).toBe("Wed 23 Sep, 22:00");
  });

  test("uses a 24-hour clock, midnight included", () => {
    expect(formatProposedAt("2026-09-24T15:05:00Z", "Asia/Tokyo")).toBe("Fri 25 Sep, 00:05");
  });
});
