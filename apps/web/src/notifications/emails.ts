/*
 * The app's emails: the daily digest and the decision notice (#15), and the
 * nudge (#16), all built from the same parts.
 *
 * Each email has a plain-text part and an HTML part. The HTML is one narrow
 * column with inline styles, scaled to the screen and with large tap
 * targets, because mail clients drop stylesheets and most of these are read
 * on a phone on a street corner. Everything a member typed is escaped.
 *
 * Pure, and imported by the notify Edge Function.
 */
import { mealStart } from "../calendar/mealTime.ts";
import { formatDay, mealName, type Meal } from "../grid/meal.ts";
import type { IsoDate, Trip } from "../trips/trip.ts";
import type { Digest, DigestMeal } from "./digest.ts";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

type EmailTrip = Pick<Trip, "id" | "name">;
type LinkedMeal = Pick<Meal, "id" | "date">;
type NamedMeal = Pick<Meal, "id" | "date" | "slot" | "label" | "startTime">;

/** Where a meal opens in the app: its trip, on its day, at the meal. */
export function mealLink(appUrl: string, tripId: string, meal: LinkedMeal): string {
  const url = new URL(appUrl);
  url.searchParams.set("trip", tripId);
  url.searchParams.set("day", meal.date);
  url.searchParams.set("meal", meal.id);
  return url.toString();
}

/** "Dinner, Sat 3 Oct". */
function mealTitle(meal: Pick<Meal, "slot" | "label" | "date">): string {
  return `${mealName(meal)}, ${formatDay(meal.date).full}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function digestEmail(input: {
  appUrl: string;
  trip: EmailTrip;
  /** The day the digest is for, on the trip's clock. */
  day: IsoDate;
  digest: Digest<DigestMeal>;
}): Email {
  const { appUrl, trip, day, digest } = input;
  const link = (meal: LinkedMeal) => mealLink(appUrl, trip.id, meal);
  const newCount = digest.newProposals.reduce((n, entry) => n + entry.proposals.length, 0);
  const awaiting = digest.awaitingVote.length;

  const subject = [
    `${trip.name}: ${plural(newCount, "new proposal", "new proposals")}`,
    ...(awaiting > 0
      ? [plural(awaiting, "meal awaiting your vote", "meals awaiting your vote")]
      : []),
  ].join(", ");

  const proposalLine = (p: Digest["newProposals"][number]["proposals"][number]) =>
    p.proposerName ? `${p.placeName} (${p.proposerName})` : p.placeName;

  const text = [
    `${trip.name}, ${formatDay(day).full}`,
    "",
    "New proposals",
    ...digest.newProposals.flatMap(({ meal, proposals }) => [
      "",
      mealTitle(meal),
      ...proposals.map((p) => `- ${proposalLine(p)}`),
      link(meal),
    ]),
    ...(awaiting > 0
      ? [
          "",
          "Still awaiting your vote",
          ...digest.awaitingVote.flatMap((meal) => ["", mealTitle(meal), link(meal)]),
        ]
      : []),
    "",
    FOOTER_TEXT,
  ].join("\n");

  const html = layout({
    preheader: subject,
    heading: `${trip.name}`,
    subheading: formatDay(day).full,
    body: [
      section("New proposals"),
      ...digest.newProposals.map(({ meal, proposals }) =>
        mealBlock({
          title: mealTitle(meal),
          href: link(meal),
          lines: proposals.map(proposalLine),
          action: "Vote on it",
        }),
      ),
      ...(awaiting > 0
        ? [
            section("Still awaiting your vote"),
            ...digest.awaitingVote.map((meal) =>
              mealBlock({ title: mealTitle(meal), href: link(meal), lines: [], action: "Vote" }),
            ),
          ]
        : []),
    ].join(""),
  });

  return { subject, text, html };
}

export type DecisionChange =
  | { kind: "decided"; placeName: string }
  | { kind: "changed"; placeName: string; previousPlaceName: string }
  | { kind: "cleared"; previousPlaceName: string };

export function decisionEmail(input: {
  appUrl: string;
  trip: EmailTrip;
  meal: NamedMeal;
  change: DecisionChange;
  /** Who decided, changed or cleared it; null when their account is gone. */
  actorName: string | null;
}): Email {
  const { appUrl, trip, meal, change } = input;
  const title = mealTitle(meal);
  const when = `${title} at ${mealStart(meal)}`;
  const actor = input.actorName ?? "A member";
  const href = mealLink(appUrl, trip.id, meal);

  let subject: string;
  let sentence: string;
  switch (change.kind) {
    case "decided":
      subject = `${trip.name}: ${title} is ${change.placeName}`;
      sentence = `${actor} decided on ${change.placeName} for ${when}.`;
      break;
    case "changed":
      subject = `${trip.name}: ${title} is now ${change.placeName}`;
      sentence = `${actor} changed ${when} from ${change.previousPlaceName} to ${change.placeName}.`;
      break;
    case "cleared":
      subject = `${trip.name}: ${title} is undecided again`;
      sentence = `${actor} cleared ${change.previousPlaceName} from ${when}, so it is open again.`;
      break;
  }

  const text = [`${trip.name}`, "", sentence, "", href, "", FOOTER_TEXT].join("\n");
  const html = layout({
    preheader: sentence,
    heading: trip.name,
    subheading: title,
    body: mealBlock({ title: sentence, href, lines: [], action: "Open the meal" }),
  });
  return { subject, text, html };
}

/** A member asking those who have not voted on a meal to vote (#16). */
export function nudgeEmail(input: {
  appUrl: string;
  trip: EmailTrip;
  meal: NamedMeal;
  /** Who nudged; null when their account is gone. */
  nudgerName: string | null;
  /** The meal's proposals, by name. */
  placeNames: readonly string[];
}): Email {
  const { appUrl, trip, meal, placeNames } = input;
  const title = mealTitle(meal);
  const href = mealLink(appUrl, trip.id, meal);
  const sentence =
    `${input.nudgerName ?? "A member"} asked for your vote on ${title} at ${mealStart(meal)}. ` +
    `${plural(placeNames.length, "restaurant is", "restaurants are")} proposed:`;
  const subject = `${trip.name}: your vote on ${title}`;

  const text = [
    `${trip.name}`,
    "",
    sentence,
    ...placeNames.map((name) => `- ${name}`),
    "",
    href,
    "",
    FOOTER_TEXT,
  ].join("\n");
  const html = layout({
    preheader: sentence,
    heading: trip.name,
    subheading: title,
    body: mealBlock({ title: sentence, href, lines: [...placeNames], action: "Vote" }),
  });
  return { subject, text, html };
}

const FOOTER_TEXT =
  "You get this because you are in this trip on What to eat. Leave the trip to stop these emails.";

// ——— HTML parts ———

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const INK = "#1f2328";
const MUTED = "#59636e";
const ACCENT = "#b3261e";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans TC', 'Noto Sans JP', Helvetica, Arial, sans-serif";

function section(title: string): string {
  return `<h2 style="margin:28px 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${escapeHtml(title)}</h2>`;
}

function mealBlock(block: { title: string; href: string; lines: string[]; action: string }) {
  const lines = block.lines
    .map((line) => `<li style="margin:4px 0;">${escapeHtml(line)}</li>`)
    .join("");
  return [
    `<div style="margin:0 0 12px;padding:16px;border:1px solid #d8dee4;border-radius:12px;">`,
    `<p style="margin:0 0 8px;font-size:17px;font-weight:600;color:${INK};">${escapeHtml(block.title)}</p>`,
    lines ? `<ul style="margin:0 0 12px;padding-left:20px;">${lines}</ul>` : "",
    `<a href="${escapeHtml(block.href)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:${ACCENT};color:#ffffff;font-weight:600;text-decoration:none;">${escapeHtml(block.action)}</a>`,
    `</div>`,
  ].join("");
}

/** The frame every email shares: one column, at most 560px, readable at phone width. */
export function layout(parts: {
  preheader: string;
  heading: string;
  subheading: string;
  body: string;
}): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(parts.heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f6f8fa;">`,
    `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(parts.preheader)}</div>`,
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK};background:#ffffff;">`,
    `<h1 style="margin:0;font-size:22px;line-height:1.3;">${escapeHtml(parts.heading)}</h1>`,
    `<p style="margin:4px 0 0;color:${MUTED};">${escapeHtml(parts.subheading)}</p>`,
    parts.body,
    `<p style="margin:32px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(FOOTER_TEXT)}</p>`,
    "</div></body></html>",
  ].join("");
}
