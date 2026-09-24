import { roundOne, type StyleDefinition } from "./styles.ts";
import { roundTwo } from "./travelStyles.ts";

export interface StyleGroup {
  label: string;
  styles: StyleDefinition[];
}

const reference = roundOne.find((s) => s.id === "menu-card")!;

/** Menu Card sits with round 2, since it is the reference for the travel direction. */
export const groups: StyleGroup[] = [
  { label: "Round 1", styles: roundOne.filter((s) => s !== reference) },
  { label: "Round 2: travel (Menu Card as reference)", styles: [reference, ...roundTwo] },
];

/** Switcher order: previous/next walk this list. */
export const catalog: StyleDefinition[] = groups.flatMap((g) => g.styles);
