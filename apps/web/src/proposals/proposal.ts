import { formatDay } from "../grid/meal.ts";
import { dateIn } from "../trips/trip.ts";

/** Mirror the checks on public.proposals. */
export const MAX_PLACE_NAME_LENGTH = 200;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_LINK_LENGTH = 2000;

/** A restaurant put forward for a meal. */
export interface Proposal {
  id: string;
  mealId: string;
  placeName: string;
  /** The Maps link as the proposer pasted it, or null. */
  sourceUrl: string | null;
  note: string | null;
  /** Where the place is, when #9 resolved it from the link. */
  lat: number | null;
  lng: number | null;
  /** Who proposed it; null once their account is deleted. */
  proposedBy: string | null;
  proposedByMe: boolean;
  /** Their Google name, or null when Google sent none. */
  proposerName: string | null;
  /** An instant (ISO 8601). */
  createdAt: string;
  /** True once anyone has voted: the name can no longer change. */
  nameLocked: boolean;
}

export interface NewProposal {
  mealId: string;
  placeName: string;
  sourceUrl: string | null;
  note: string | null;
}

/**
 * An edit of one's own proposal. The name is left out once it is locked;
 * the note is always sent, null to clear it.
 */
export interface ProposalEdit {
  placeName?: string;
  note: string | null;
}

/** The problem with a restaurant's name, or null when it can be saved. */
export function validatePlaceName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Say which restaurant.";
  if (trimmed.length > MAX_PLACE_NAME_LENGTH) {
    return `Keep the name to ${MAX_PLACE_NAME_LENGTH} characters or fewer.`;
  }
  return null;
}

/** The problem with a pasted Maps link, or null. No link at all is fine. */
export function validateMapsLink(link: string): string | null {
  const trimmed = link.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LINK_LENGTH) return "That link is too long to keep.";
  // The database insists on the "//" too; `new URL` alone accepts "https:host".
  if (!/^https?:\/\//i.test(trimmed)) return "Paste the whole link, starting with https://";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Paste the whole link, starting with https://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Paste the whole link, starting with https://";
  }
  return null;
}

export function validateNote(note: string): string | null {
  if (note.trim().length > MAX_NOTE_LENGTH) {
    return `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  return null;
}

/** What is stored for an optional text field: trimmed, and null when blank. */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The link out to Google Maps, in the official, key-free Maps URLs scheme
 * (https://developers.google.com/maps/documentation/urls/get-started). The
 * pasted link itself is never used as a link: whatever someone pastes, the
 * app only ever sends people to google.com/maps.
 *
 * Coordinates, when #9 has resolved them, pin the exact branch; otherwise
 * Maps searches for the name.
 */
export function mapsUrl(place: Pick<Proposal, "placeName" | "lat" | "lng">): string {
  const query =
    place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : place.placeName;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Who proposed it, as the list says it: "Proposed by <this>". */
export function proposerLabel(
  proposal: Pick<Proposal, "proposedBy" | "proposedByMe" | "proposerName">,
): string {
  if (proposal.proposedByMe) return "you";
  if (proposal.proposedBy === null) return "a member who deleted their account";
  return proposal.proposerName ?? "a member with no name";
}

/**
 * "Thu 24 Sep, 11:00": when a proposal was made, on the trip's own clock.
 * Every time the app shows for a trip is in the trip's timezone.
 */
export function formatProposedAt(instant: string, timeZone: string): string {
  const at = new Date(instant);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${formatDay(dateIn(timeZone, at)).full}, ${time}`;
}
