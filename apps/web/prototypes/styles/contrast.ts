/*
 * WCAG contrast audit over a style's resolved tokens. Tokens may reference
 * each other with var(--x); "transparent" backgrounds fall back to the next
 * candidate. Textures are checked by blending texture-ink over bg and surface
 * at texture-pct, which is the worst pixel the text can sit on.
 */

export interface ContrastCheck {
  fg: string;
  /** First non-transparent entry is the effective background. */
  bg: string[];
  /** 4.5 for text, 3 for non-text UI such as control boundaries and focus rings. */
  min: number;
}

const c = (fg: string, bg: string | string[], min = 4.5): ContrastCheck => ({
  fg,
  bg: Array.isArray(bg) ? bg : [bg],
  min,
});

/** The colour pairs the gallery actually renders; each must pass WCAG AA. */
export const checks: ContrastCheck[] = [
  c("text", "bg"),
  c("text", "surface"),
  c("text", "surface-2"),
  c("muted", "bg"),
  c("muted", "surface"),
  c("muted", "surface-2"),
  c("text", "bg+texture"),
  c("muted", "bg+texture"),
  c("text", "surface+texture"),
  c("muted", "surface+texture"),
  c("link", "surface"),
  c("link", "surface+texture"),
  c("on-primary", "primary"),
  c("on-secondary", "secondary"),
  c("on-danger", "danger"),
  c("danger-text", "surface"),
  c("on-accent", "accent"),
  c("empty-fg", "empty-bg"),
  c("discuss-fg", "discuss-bg"),
  c("decided-fg", "decided-bg"),
  c("decided-icon", "decided-bg", 3),
  c("on-up", "up"),
  c("on-down", "down"),
  c("avatar-fg", "avatar-bg"),
  c("text", "warning-bg"),
  c("day-title-fg", ["day-title-bg", "surface+texture"]),
  c("day-badge-fg", ["day-badge-bg", "day-title-bg", "surface+texture"]),
  c("border-strong", "surface", 3),
  c("secondary-border", "surface", 3),
  c("empty-border", "surface", 3),
  c("route", "surface+texture", 3),
  c("focus", "bg", 3),
  c("focus", "surface", 3),
];

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function resolve(tokens: Record<string, string>, key: string, depth = 0): string {
  const base = key.endsWith("+texture") ? key.slice(0, -"+texture".length) : key;
  let value = tokens[base] ?? "transparent";
  const ref = /^var\(--([\w-]+)\)$/.exec(value.trim());
  if (ref && depth < 8) value = resolve(tokens, ref[1]!, depth + 1);
  if (base !== key && value.startsWith("#")) {
    const pct = Number.parseFloat(tokens["texture-pct"] ?? "0") / 100;
    const ink = parseHex(resolve(tokens, "texture-ink", depth + 1));
    const under = parseHex(value);
    value = toHex(under.map((v, i) => v * (1 - pct) + ink[i]! * pct) as Rgb);
  }
  return value;
}

export interface ContrastResult {
  label: string;
  ratio: number;
  min: number;
  pass: boolean;
}

export function audit(tokens: Record<string, string>): ContrastResult[] {
  return checks.map((check) => {
    const fg = resolve(tokens, check.fg);
    const bgKey = check.bg.find((k) => resolve(tokens, k).startsWith("#")) ?? check.bg.at(-1)!;
    const bg = resolve(tokens, bgKey);
    const ratio = fg.startsWith("#") && bg.startsWith("#") ? contrastRatio(fg, bg) : 0;
    return { label: `${check.fg} on ${bgKey}`, ratio, min: check.min, pass: ratio >= check.min };
  });
}
