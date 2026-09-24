import { expect, test } from "vite-plus/test";
import { initialsOf } from "./initials.ts";

test("takes the first and last word's initials", () => {
  expect(initialsOf("alice mei chen")).toBe("AC");
});

test("one word gives one initial", () => {
  expect(initialsOf("Bob")).toBe("B");
});

test("a name written without spaces gives its first character", () => {
  expect(initialsOf("陳美玲")).toBe("陳");
});

test("no name gives a placeholder", () => {
  expect(initialsOf(null)).toBe("?");
  expect(initialsOf("   ")).toBe("?");
});
