/*
 * Reading a pasted Google Maps short link (#9). The maps-link Edge Function
 * asks maps.app.goo.gl where a link points and reads the place from the
 * address it is sent to; both halves are here, free of I/O, so the Edge
 * Function and the tests share them.
 *
 * The address's `data=` part is undocumented and unversioned, so everything
 * here is defensive: anything unexpected is "could not parse" (null), never
 * an exception. A proposal never depends on it (docs/adr/0007-maps-link-resolution.md).
 */

/** What a Maps place link says about the place. */
export interface ResolvedPlace {
  placeName: string;
  /** Null together when the address has none: links shared from the phone app. */
  lat: number | null;
  lng: number | null;
  /**
   * The place's CID, in decimal: the second half of the `!1s` feature id
   * pair. Short links carry no Places `place_id`; this is what they have.
   */
  placeCid: string;
}

const SHORT_LINK_HOST = "maps.app.goo.gl";

/**
 * The pasted text as a Maps short link (https://maps.app.goo.gl/<id>, with
 * whatever query the share sheet adds), or null when it is anything else.
 * Only these are ever looked up: the Edge Function asks this one host and
 * nothing a member could point it at.
 */
export function shortLink(pasted: string): URL | null {
  const trimmed = pasted.trim();
  if (!trimmed.startsWith(`https://${SHORT_LINK_HOST}/`)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.host !== SHORT_LINK_HOST || url.username || url.password) return null;
  if (!/^\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
  return url;
}

/**
 * The whole HTTP/1.1 request that asks where a short link points.
 *
 * It carries no User-Agent, and that is the point: a request with a
 * browser's User-Agent is served a JavaScript page with no Location header,
 * while one with none gets a plain 302. The Edge Function writes this itself
 * over TLS because fetch() always adds a User-Agent of its own. Nothing
 * follows the redirect: only its Location is read.
 */
export function redirectRequest(link: URL): string {
  return `GET ${link.pathname}${link.search} HTTP/1.1\r\nHost: ${link.host}\r\nConnection: close\r\n\r\n`;
}

/**
 * What maps.app.goo.gl's reply says about a short link:
 *
 * - `{ location }`: a redirect to an absolute https address, to be parsed.
 * - `"no place"`: Google says the link does not exist (404, 410). That is an
 *   answer, and a lasting one, so it is kept like a link that could not be
 *   parsed.
 * - `"unavailable"`: anything else, from a 429 or a 5xx to a page with no
 *   Location or a reply cut short. No answer yet: nothing is kept, and a
 *   later paste of the same link asks again.
 *
 * For the member all three end the same way when there is no place: the
 * name is left to them.
 */
export type Reply = { location: string } | "no place" | "unavailable";

export function readReply(head: string): Reply {
  const [statusLine, ...headers] = head.split("\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine ?? "")?.[1];
  if (status === "404" || status === "410") return "no place";
  if (!status || !["301", "302", "303", "307", "308"].includes(status)) return "unavailable";
  for (const line of headers) {
    const colon = line.indexOf(":");
    if (colon === -1 || line.slice(0, colon).trim().toLowerCase() !== "location") continue;
    const location = line.slice(colon + 1).trim();
    return location.startsWith("https://") ? { location } : "unavailable";
  }
  return "unavailable";
}

/**
 * The place a Maps address names, or null when it cannot be read. Google
 * sends a short link to one of two shapes.
 *
 * Shared from desktop, a place address:
 *
 * - The name is the `/maps/place/<name>/` path segment, whatever the host:
 *   Google sends each country to its own (google.com.tw, google.co.jp).
 * - The coordinates are the `!3d<lat>!4d<lng>` markers, the place itself,
 *   never the `@lat,lng` after the name, which is where the map was looking.
 * - The CID is the second half of the `!1s0x…:0x…` feature id. Other feature
 *   ids (`!5s` is the building the place is in) are not the place's.
 *
 * Shared from the phone app, a search for the place (`/?q=…&ftid=…`):
 *
 * - The name is `q` up to its first ", ": the rest is the address. A name
 *   with ", " in it is cut short there.
 * - The CID is the second half of `ftid`, the same feature id.
 * - There are no coordinates, so the place has none.
 */
export function parsePlaceUrl(address: string): ResolvedPlace | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  return url.pathname.startsWith("/maps/place/") ? placeFromPath(url) : placeFromSearch(url);
}

function placeFromPath(url: URL): ResolvedPlace | null {
  const placeName = nameFrom(url.pathname);
  // The data part is in the path; the query can hold a copy of `!` markers
  // for other things, so only the path is read.
  const coordinates = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const featureId = /!1s(0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16})(?![0-9a-z])/i.exec(url.pathname);
  if (placeName === null || coordinates === null || featureId === null) return null;

  const lat = Number(coordinates[1]);
  const lng = Number(coordinates[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;

  const placeCid = cidFrom(featureId[1]!);
  if (placeCid === null) return null;

  return { placeName, lat, lng, placeCid };
}

function placeFromSearch(url: URL): ResolvedPlace | null {
  // Only a search on its own: /maps/search/ and /maps/dir/ are not a place.
  if (url.pathname !== "/" && url.pathname !== "/maps") return null;
  const placeName = (url.searchParams.get("q") ?? "").split(", ")[0]!.replace(/\s+/g, " ").trim();
  const placeCid = cidFrom(url.searchParams.get("ftid") ?? "");
  if (placeName.length === 0 || placeCid === null) return null;
  return { placeName, lat: null, lng: null, placeCid };
}

/** The CID in a `0x…:0x…` feature id, in decimal, or null. */
function cidFrom(featureId: string): string | null {
  const second = /^0x[0-9a-f]{1,16}:0x([0-9a-f]{1,16})$/i.exec(featureId)?.[1];
  if (second === undefined) return null;
  const cid = BigInt(`0x${second}`).toString();
  return cid === "0" ? null : cid;
}

/** The name in `/maps/place/<name>/…`, decoded, or null. */
function nameFrom(pathname: string): string | null {
  const segment = /\/maps\/place\/([^/]+)/.exec(pathname)?.[1];
  if (segment === undefined) return null;
  let name: string;
  try {
    // A path segment, but Maps writes its spaces as "+".
    name = decodeURIComponent(segment.replace(/\+/g, " "));
  } catch {
    return null;
  }
  name = name.replace(/\s+/g, " ").trim();
  return name.length === 0 ? null : name;
}
