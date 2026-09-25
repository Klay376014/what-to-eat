import { describe, expect, it } from "vite-plus/test";
import { calendarEvent, eventIdFor, zoneCity } from "./calendarEvent.ts";

const trip = { name: "Tokyo in October", timezone: "Asia/Tokyo" };
const dinner = {
  id: "0b6f1c2e-8d3a-4f5b-9c7d-1e2f3a4b5c6d",
  date: "2026-10-03",
  slot: "dinner" as const,
  label: null,
  startTime: null,
};
const ichiran = {
  placeName: "Ichiran Shibuya",
  note: "No reservations; the queue moves fast.",
  sourceUrl: "https://maps.app.goo.gl/2avW6UjkkDbgHUwPA",
  lat: 35.6605,
  lng: 139.7005,
};

describe("a decided meal's calendar event", () => {
  it("names the meal, the restaurant and the local time and zone", () => {
    const event = calendarEvent({ trip, meal: dinner, proposal: ichiran, attendees: [] });
    expect(event.summary).toBe("Dinner · Ichiran Shibuya (19:00 Tokyo)");
  });

  it("calls an other meal by its own name", () => {
    const event = calendarEvent({
      trip,
      meal: { ...dinner, slot: "other", label: "Afternoon tea", startTime: "15:30:00" },
      proposal: ichiran,
      attendees: [],
    });
    expect(event.summary).toBe("Afternoon tea · Ichiran Shibuya (15:30 Tokyo)");
  });

  it("carries the time on the trip's clock, the proposer's note and the pasted Maps link", () => {
    const event = calendarEvent({ trip, meal: dinner, proposal: ichiran, attendees: [] });
    const mapsLink = "https://maps.app.goo.gl/2avW6UjkkDbgHUwPA";
    expect(event.description).toBe(
      [
        "Dinner at 19:00 Tokyo time, Sat 3 Oct.",
        "",
        "No reservations; the queue moves fast.",
        "",
        `Google Maps: ${mapsLink}`,
      ].join("\n"),
    );
    expect(event.location).toBe(mapsLink);
  });

  it("leaves the note out when there is none, and searches Maps for a name typed with no link", () => {
    const event = calendarEvent({
      trip,
      meal: dinner,
      proposal: { placeName: "Afuri", note: null, sourceUrl: null, lat: null, lng: null },
      attendees: [],
    });
    expect(event.description).toBe(
      [
        "Dinner at 19:00 Tokyo time, Sat 3 Oct.",
        "",
        "Google Maps: https://www.google.com/maps/search/?api=1&query=Afuri",
      ].join("\n"),
    );
  });

  it("is written for the meal's time in the trip's timezone", () => {
    const event = calendarEvent({ trip, meal: dinner, proposal: ichiran, attendees: [] });
    expect(event.start).toEqual({ dateTime: "2026-10-03T19:00:00+09:00", timeZone: "Asia/Tokyo" });
    expect(event.end).toEqual({ dateTime: "2026-10-03T21:00:00+09:00", timeZone: "Asia/Tokyo" });
  });

  it("uses the meal's own time over its slot's", () => {
    const event = calendarEvent({
      trip,
      meal: { ...dinner, startTime: "20:15" },
      proposal: ichiran,
      attendees: [],
    });
    expect(event.start.dateTime).toBe("2026-10-03T20:15:00+09:00");
    expect(event.summary).toBe("Dinner · Ichiran Shibuya (20:15 Tokyo)");
  });

  it("invites the participants", () => {
    const event = calendarEvent({
      trip,
      meal: dinner,
      proposal: ichiran,
      attendees: ["mei@example.com", "kenji@example.com"],
    });
    expect(event.attendees).toEqual([{ email: "mei@example.com" }, { email: "kenji@example.com" }]);
  });

  it("has an id fixed by the meal, so writing it twice cannot make two events", () => {
    const event = calendarEvent({ trip, meal: dinner, proposal: ichiran, attendees: [] });
    expect(event.id).toBe("0b6f1c2e8d3a4f5b9c7d1e2f3a4b5c6d");
    expect(eventIdFor(dinner.id)).toBe(event.id);
    // Google's event ids allow only a–v and 0–9.
    expect(event.id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe("a timezone as the event text names it", () => {
  it("is the city of the zone", () => {
    expect(zoneCity("Asia/Tokyo")).toBe("Tokyo");
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});
