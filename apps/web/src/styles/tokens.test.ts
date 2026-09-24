// Guards the sunlight rules in docs/adr/0002-visual-direction.md against the
// real token file: WCAG AA for every colour pair the components render, in
// both themes, and the texture ceiling.
import { describe, expect, test } from "vite-plus/test";
import css from "./tokens.css?raw";

type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
  const tokens: Tokens = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name!] = value!.trim();
  }
  return tokens;
}

/** The body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}`);
  const open = css.indexOf("{", start);
  return declarations(css.slice(open + 1, css.indexOf("}", open)));
}

const light = rule(":root");
const darkForced = rule(':root[data-theme="dark"]');
const darkSystem = rule(':root:not([data-theme="light"])');
const themes = { light, dark: { ...light, ...darkForced } };

function channel(hex: string, at: number) {
  const v = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const h = hex.replace("#", "");
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4);
}
function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [foreground, background, minimum]: 4.5 for text, 3 for UI boundaries. */
const pairs: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text", "surface-2", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "surface-2", 4.5],
  ["link", "surface", 4.5],
  ["link", "bg", 4.5],
  ["on-primary", "primary", 4.5],
  ["on-secondary", "secondary", 4.5],
  ["on-danger", "danger", 4.5],
  ["danger-text", "surface", 4.5],
  ["danger-text", "bg", 4.5],
  ["empty-fg", "empty-bg", 4.5],
  ["discuss-fg", "discuss-bg", 4.5],
  ["decided-fg", "decided-bg", 4.5],
  ["on-up", "up", 4.5],
  ["on-down", "down", 4.5],
  ["avatar-fg", "avatar-bg", 4.5],
  ["text", "warning-bg", 4.5],
  ["border-strong", "surface", 3],
  ["secondary-border", "surface", 3],
  ["empty-border", "surface", 3],
  ["route", "surface", 3],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
];

describe.each(Object.entries(themes))("%s theme", (_, tokens) => {
  test.each(pairs)("%s on %s meets %s:1", (fg, bg, min) => {
    expect(tokens[fg], `--${fg}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tokens[bg], `--${bg}`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ratio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(min);
  });
});

test("the system dark theme and the forced dark theme are the same", () => {
  expect(darkSystem).toEqual(darkForced);
});

test("the backdrop texture stays at 14% ink or less", () => {
  expect(Number.parseFloat(light["texture-pct"]!)).toBeLessThanOrEqual(14);
});
