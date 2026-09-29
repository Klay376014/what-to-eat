import { formatDay } from "../grid/meal.ts";
import { dateIn } from "../trips/trip.ts";
import type { Vote } from "./vote.ts";

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
  /** True while anyone has a vote on it: the name can no longer change. */
  nameLocked: boolean;
  /** Everyone's votes, a departed member's included, in no set order. */
  votes: Vote[];
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
  if (!isMapsLink(trimmed)) {
    return "Paste a link from Google Maps, starting with https://. Other links can go in the note.";
  }
  return null;
}

/**
 * A Google Maps address, the same one the database's check on
 * proposals.source_url accepts (20261003090000_maps_only_links.sql):
 *
 * - a share sheet's short link, https://maps.app.goo.gl/<id>;
 * - https://maps.google.<country>/…;
 * - https://www.google.<country>/maps…, with or without the www.
 *
 * The host is spelled out right after https:// and must end there, so
 * nothing (a user name, a port, another domain around it) can make the
 * browser go anywhere else. Anything else a member wants to share goes in
 * the note, where it is only text.
 */
const MAPS_LINK = new RegExp(
  "^https://(" +
    "maps\\.app\\.goo\\.gl/[a-z0-9_-]+([?#]|$)" +
    "|maps\\.google\\.(com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})([/?#]|$)" +
    "|(www\\.)?google\\.(com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})/maps([/?#]|$)" +
    ")",
  "i",
);

function isMapsLink(text: string): boolean {
  if (!MAPS_LINK.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password && url.port === "";
  } catch {
    return false;
  }
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
 * The link out to Google Maps.
 *
 * A proposal made with a Maps link opens that link as pasted: it lands on
 * the place's own page (reviews, hours, the listing), which nothing else
 * reaches. The official Maps URLs scheme can only name a place by a Places
 * `place_id`, which short links do not give, so from coordinates it could
 * only drop a pin (docs/adr/0007-maps-link-resolution.md). The pasted link is
 * a member's input, so only a Google Maps one is ever linked to; the
 * database and the form accept nothing else either.
 *
 * Without a link, the official, key-free scheme
 * (https://developers.google.com/maps/documentation/urls/get-started)
 * searches for the name, or for the coordinates when there are any.
 */
export function mapsUrl(place: Pick<Proposal, "placeName" | "sourceUrl" | "lat" | "lng">): string {
  if (place.sourceUrl !== null && isMapsLink(place.sourceUrl)) return place.sourceUrl;
  const query =
    place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : place.placeName;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * A member as the meal names them after "Proposed by" or "Decided by": you,
 * their name, or what is known once the name or the account is gone.
 */
export function memberLabel(member: { isMe: boolean; id: string | null; name: string | null }) {
  if (member.isMe) return "you";
  if (member.id === null) return "a member who deleted their account";
  return member.name ?? "a member with no name";
}

/** Who proposed it, as the list says it: "Proposed by <this>". */
export function proposerLabel(
  proposal: Pick<Proposal, "proposedBy" | "proposedByMe" | "proposerName">,
): string {
  return memberLabel({
    isMe: proposal.proposedByMe,
    id: proposal.proposedBy,
    name: proposal.proposerName,
  });
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
