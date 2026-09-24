/** Up to two initials for a name, first and last word; "?" when there is none. */
export function initialsOf(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : [words[0]!];
  // By code point, so a character outside the BMP is not cut in half.
  return letters.map((word) => String.fromCodePoint(word.codePointAt(0)!).toUpperCase()).join("");
}
