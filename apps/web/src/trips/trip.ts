/** A calendar date as `YYYY-MM-DD`, with no time or zone attached. */
export type IsoDate = string;

export type TripRole = "organiser" | "member";

export interface Trip {
  id: string;
  name: string;
  /** Both set or both null; a trip without dates is for everyday use. */
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** IANA zone. The trip's own calendar: "today" for a trip is today here. */
  timezone: string;
  myRole: TripRole;
  /** The organiser's display name, or null when they have none. */
  organiserName: string | null;
}

export interface TripSettings {
  name: string;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  timezone: string;
}

/** Today's date on the calendar of `timeZone`. */
export function dateIn(timeZone: string, now: Date): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The trip the app opens on: the one happening now, else the next one to
 * start, else an undated everyday trip, else the most recently ended one.
 * Each trip is judged against today on its own calendar.
 */
export function pickDefaultTrip(trips: readonly Trip[], now: Date): Trip | undefined {
  const current: Trip[] = [];
  const upcoming: Trip[] = [];
  const undated: Trip[] = [];
  const past: Trip[] = [];

  for (const trip of trips) {
    if (trip.startDate === null || trip.endDate === null) {
      undated.push(trip);
      continue;
    }
    const today = dateIn(trip.timezone, now);
    if (today < trip.startDate) upcoming.push(trip);
    else if (today > trip.endDate) past.push(trip);
    else current.push(trip);
  }

  const byStart = (a: Trip, b: Trip) => a.startDate!.localeCompare(b.startDate!);
  const byEnd = (a: Trip, b: Trip) => a.endDate!.localeCompare(b.endDate!);

  return (
    current.sort(byStart).at(-1) ??
    upcoming.sort(byStart).at(0) ??
    undated.at(0) ??
    past.sort(byEnd).at(-1)
  );
}

/** Something in a trip that lives on a particular day, such as a meal. */
export interface DatedContent {
  id: string;
  date: IsoDate;
  /** How the item is named in the warning, e.g. "Dinner, Sat 3 Oct". */
  label: string;
}

/**
 * The items that would sit outside the trip after its dates change to
 * `range`. A trip with no dates has no range to fall outside of.
 */
export function contentOutsideRange(
  items: readonly DatedContent[],
  range: Pick<TripSettings, "startDate" | "endDate">,
): DatedContent[] {
  const { startDate, endDate } = range;
  if (startDate === null || endDate === null) return [];
  return items.filter((item) => item.date < startDate || item.date > endDate);
}
