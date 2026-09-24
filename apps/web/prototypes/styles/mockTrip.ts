/* Mock data for the style gallery. Not shaped like the real API on purpose. */

export interface Member {
  id: string;
  name: string;
  initials: string;
}

export const members: Member[] = [
  { id: "kl", name: "Klay Lee", initials: "KL" },
  { id: "mc", name: "Mei Chen", initials: "MC" },
  { id: "jw", name: "Jun Wu", initials: "JW" },
  { id: "at", name: "Ann Tsai", initials: "AT" },
  { id: "rl", name: "Ray Lin", initials: "RL" },
];

export const me = "kl";

export function member(id: string): Member {
  const found = members.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown member ${id}`);
  return found;
}

export type Slot =
  | { state: "empty" }
  | { state: "discussing"; proposals: number; awaitingMe: boolean }
  | { state: "decided"; restaurant: string };

export interface OtherMeal {
  label: string;
  slot: Slot;
}

export interface Day {
  date: string;
  weekday: string;
  label: string;
  breakfast: Slot;
  lunch: Slot;
  dinner: Slot;
  other: OtherMeal[];
}

const empty: Slot = { state: "empty" };
const discussing = (proposals: number, awaitingMe = false): Slot => ({
  state: "discussing",
  proposals,
  awaitingMe,
});
const decided = (restaurant: string): Slot => ({ state: "decided", restaurant });

export const trip = {
  name: "Tokyo, October",
  dates: "14 – 18 Oct 2026",
  timezone: "Asia/Tokyo",
};

export const days: Day[] = [
  {
    date: "2026-10-14",
    weekday: "Wed",
    label: "14 Oct",
    breakfast: empty,
    lunch: decided("Afuri Ramen Ebisu"),
    dinner: discussing(3, true),
    other: [],
  },
  {
    date: "2026-10-15",
    weekday: "Thu",
    label: "15 Oct",
    breakfast: decided("Onibus Coffee Nakameguro"),
    lunch: empty,
    dinner: decided("Uobei Shibuya Dogenzaka"),
    other: [{ label: "Afternoon tea", slot: discussing(1) }],
  },
  {
    date: "2026-10-16",
    weekday: "Fri",
    label: "16 Oct",
    breakfast: discussing(2),
    lunch: decided("Tsukiji Itadori Bekkan"),
    dinner: empty,
    other: [
      { label: "Afternoon tea", slot: decided("Higashiya Ginza") },
      { label: "Late-night snack", slot: discussing(2, true) },
      { label: "Dessert run", slot: empty },
    ],
  },
  {
    date: "2026-10-17",
    weekday: "Sat",
    label: "17 Oct",
    breakfast: empty,
    lunch: discussing(4),
    dinner: discussing(1, true),
    other: [],
  },
  {
    date: "2026-10-18",
    weekday: "Sun",
    label: "18 Oct",
    breakfast: decided("Komeda Coffee Shinagawa"),
    lunch: empty,
    dinner: empty,
    other: [{ label: "Airport last meal", slot: discussing(2) }],
  },
];

export interface Proposal {
  id: string;
  name: string;
  proposedBy: string;
  note: string;
  up: string[];
  down: string[];
  decided: boolean;
}

/** Thu 15 Oct, dinner: decided, with the proposals that were considered. */
export const dinnerProposals: Proposal[] = [
  {
    id: "p1",
    name: "Uobei Shibuya Dogenzaka",
    proposedBy: "mc",
    note: "Conveyor sushi, no booking needed. 5 min from the hotel.",
    up: ["kl", "mc", "jw", "at"],
    down: [],
    decided: true,
  },
  {
    id: "p2",
    name: "Gyukatsu Motomura Shibuya",
    proposedBy: "rl",
    note: "Queue is usually 45 min after 18:00.",
    up: ["rl", "jw"],
    down: ["at"],
    decided: false,
  },
  {
    id: "p3",
    name: "Tonki Meguro",
    proposedBy: "jw",
    note: "",
    up: [],
    down: ["mc", "at"],
    decided: false,
  },
];
