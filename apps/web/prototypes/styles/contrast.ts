import type { ModeTokens } from "./styles.ts";

type Key = keyof ModeTokens;

export interface ContrastCheck {
  fg: Key;
  bg: Key;
  /** 4.5 for text, 3 for non-text UI such as control boundaries and focus rings. */
  min: number;
}

/** The colour pairs the gallery actually renders; each must pass WCAG AA. */
export const checks: ContrastCheck[] = [
  { fg: "text", bg: "bg", min: 4.5 },
  { fg: "text", bg: "surface", min: 4.5 },
  { fg: "text", bg: "surface-2", min: 4.5 },
  { fg: "muted", bg: "bg", min: 4.5 },
  { fg: "muted", bg: "surface", min: 4.5 },
  { fg: "muted", bg: "surface-2", min: 4.5 },
  { fg: "link", bg: "surface", min: 4.5 },
  { fg: "on-primary", bg: "primary", min: 4.5 },
  { fg: "on-secondary", bg: "secondary", min: 4.5 },
  { fg: "on-danger", bg: "danger", min: 4.5 },
  { fg: "danger-text", bg: "surface", min: 4.5 },
  { fg: "empty-fg", bg: "empty-bg", min: 4.5 },
  { fg: "discuss-fg", bg: "discuss-bg", min: 4.5 },
  { fg: "decided-fg", bg: "decided-bg", min: 4.5 },
  { fg: "on-up", bg: "up", min: 4.5 },
  { fg: "on-down", bg: "down", min: 4.5 },
  { fg: "avatar-fg", bg: "avatar-bg", min: 4.5 },
  { fg: "text", bg: "warning-bg", min: 4.5 },
  { fg: "border-strong", bg: "surface", min: 3 },
  { fg: "secondary-border", bg: "surface", min: 3 },
  { fg: "empty-border", bg: "surface", min: 3 },
  { fg: "focus", bg: "bg", min: 3 },
  { fg: "focus", bg: "surface", min: 3 },
];

function channel(hex: string, offset: number): number {
  const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastResult extends ContrastCheck {
  ratio: number;
  pass: boolean;
}

export function audit(tokens: ModeTokens): ContrastResult[] {
  return checks.map((check) => {
    const ratio = contrastRatio(tokens[check.fg], tokens[check.bg]);
    return { ...check, ratio, pass: ratio >= check.min };
  });
}
