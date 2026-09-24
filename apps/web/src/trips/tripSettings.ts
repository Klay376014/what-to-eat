import type { TripSettings } from "./trip.ts";

export const MAX_TRIP_NAME_LENGTH = 100;

/**
 * Whether `zone` is the kind of timezone a trip may have: an IANA
 * region/city name. Mirrors the shape rule of private.check_trip_timezone()
 * so the form does not offer what the database will refuse.
 */
function isPlaceZone(zone: string): boolean {
  return zone.includes("/") && !/^(Etc|posix|right|SystemV)\//.test(zone);
}

/** IANA region/city zones the browser knows, sorted. */
export function timeZoneOptions(): string[] {
  return Intl.supportedValuesOf("timeZone").filter(isPlaceZone).sort();
}

/**
 * The zone a new trip starts with: the browser's own, unless it is not a
 * place (a browser set to UTC), in which case the user must pick one.
 */
export function defaultTimeZone(
  browserZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return isPlaceZone(browserZone) ? browserZone : "";
}

export type TripSettingsErrors = Partial<Record<keyof TripSettings, string>>;

/** Problems with `settings`, keyed by field; empty when it can be saved. */
export function validateTripSettings(settings: TripSettings): TripSettingsErrors {
  const errors: TripSettingsErrors = {};
  const name = settings.name.trim();

  if (name.length === 0) {
    errors.name = "Give the trip a name.";
  } else if (name.length > MAX_TRIP_NAME_LENGTH) {
    errors.name = `Keep the name to ${MAX_TRIP_NAME_LENGTH} characters or fewer.`;
  }

  if (settings.startDate && !settings.endDate) {
    errors.endDate = "Add an end date, or clear the start date.";
  } else if (!settings.startDate && settings.endDate) {
    errors.startDate = "Add a start date, or clear the end date.";
  } else if (settings.startDate && settings.endDate && settings.endDate < settings.startDate) {
    errors.endDate = "The trip cannot end before it starts.";
  }

  if (!settings.timezone) {
    errors.timezone = "Choose the timezone the trip takes place in.";
  }

  return errors;
}
