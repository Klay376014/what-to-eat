import type { DatedContent, Trip, TripSettings } from "../trips/trip.ts";
import type { TripsApi } from "../trips/tripsApi.ts";

/**
 * An in-memory TripsApi for component tests: a working stand-in for the
 * backend, not a record of calls. Tests seed it, drive the UI, and assert on
 * what the screen shows.
 *
 * It knows nothing about who may see what. Access control is the database's
 * job and is tested there (supabase/tests/database/), never through this.
 */
export function createFakeTripsApi(
  seed: { trips?: Trip[]; content?: Record<string, DatedContent[]>; myName?: string } = {},
): TripsApi {
  const trips = (seed.trips ?? []).map((trip) => ({ ...trip }));
  const content = seed.content ?? {};
  let nextId = 1;

  function find(id: string): Trip {
    const trip = trips.find((t) => t.id === id);
    if (!trip) throw new Error(`No trip ${id}`);
    return trip;
  }

  function normalise(settings: TripSettings): TripSettings {
    return { ...settings, name: settings.name.trim() };
  }

  return {
    async listTrips() {
      return trips.map((t) => ({ ...t }));
    },
    async createTrip(settings) {
      const trip: Trip = {
        id: `trip-${nextId++}`,
        ...normalise(settings),
        myRole: "organiser",
        organiserName: seed.myName ?? null,
      };
      trips.push(trip);
      return { ...trip };
    },
    async updateTrip(id, settings) {
      Object.assign(find(id), normalise(settings));
      return { ...find(id) };
    },
    async deleteTrip(id) {
      trips.splice(trips.indexOf(find(id)), 1);
    },
    async listDatedContent(tripId) {
      return content[tripId] ?? [];
    },
  };
}

export function aTrip(overrides: Partial<Trip> & Pick<Trip, "id" | "name">): Trip {
  return {
    startDate: null,
    endDate: null,
    timezone: "Asia/Taipei",
    myRole: "organiser",
    organiserName: null,
    ...overrides,
  };
}
