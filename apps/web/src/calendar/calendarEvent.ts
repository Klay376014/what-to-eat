/*
 * The Google Calendar event a decided meal becomes (#12). Pure, and imported
 * by the calendar Edge Function, which writes it; see mealTime.ts.
 */
import { formatDay, mealName, type Meal } from "../grid/meal.ts";
import { mapsUrl, type Proposal } from "../proposals/proposal.ts";
import type { Trip } from "../trips/trip.ts";
import { mealTimes, zonedIso, type TimedMeal } from "./mealTime.ts";

export interface EventMeal extends TimedMeal, Pick<Meal, "id" | "label"> {}

export type EventPlace = Pick<Proposal, "placeName" | "note" | "lat" | "lng">;

/** The parts of a Calendar API event resource the app writes. */
export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: { email: string }[];
}

/**
 * The event's id on the trip calendar, fixed by the meal. Google takes an id
 * chosen by the client (base32hex: a–v and 0–9, which a uuid's hex digits
 * are), so a write retried after a lost response finds the event it already
 * made instead of adding a second one.
 */
export function eventIdFor(mealId: string): string {
  return mealId.replaceAll("-", "").toLowerCase();
}

/** "Tokyo" for Asia/Tokyo: how the event text names the trip's zone. */
export function zoneCity(timeZone: string): string {
  return (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
}

/**
 * The event for a decided meal. Its time is written in the trip's timezone,
 * and Google shows each attendee the same instant on their own clock; so a
 * group planning Tokyo from Taipei would see dinner at 18:00. The summary and
 * first line of the description say the local time and zone outright, so the
 * time reads the same whatever zone a calendar is in (spike #2).
 */
export function calendarEvent(input: {
  trip: Pick<Trip, "name" | "timezone">;
  meal: EventMeal;
  proposal: EventPlace;
  /** Email addresses to invite. */
  attendees: readonly string[];
}): CalendarEvent {
  const { trip, meal, proposal } = input;
  const { start, end, localStart } = mealTimes(meal, trip.timezone);
  const name = mealName(meal);
  const city = zoneCity(trip.timezone);
  const link = mapsUrl(proposal);

  const description = [
    `${name} at ${localStart} ${city} time, ${formatDay(meal.date).full}.`,
    ...(proposal.note ? ["", proposal.note] : []),
    "",
    `Google Maps: ${link}`,
  ].join("\n");

  return {
    id: eventIdFor(meal.id),
    summary: `${name} · ${proposal.placeName} (${localStart} ${city})`,
    description,
    location: link,
    start: { dateTime: zonedIso(start, trip.timezone), timeZone: trip.timezone },
    end: { dateTime: zonedIso(end, trip.timezone), timeZone: trip.timezone },
    attendees: input.attendees.map((email) => ({ email })),
  };
}
