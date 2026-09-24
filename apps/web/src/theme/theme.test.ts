// The inline script in index.html sets the theme before the app mounts, so
// the wrong theme never flashes. It must agree with theme.ts on the storage
// key and the values; this runs the real script against the real module.
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import html from "../../index.html?raw";
import { THEME_STORAGE_KEY } from "./theme.ts";

const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

/**
 * Runs the inline script's exact text. happy-dom does not execute <script>
 * elements added in tests, so the Function constructor stands in for the
 * browser; the text is our own index.html, not user input.
 */
function runInlineScript() {
  // oxlint-disable-next-line no-implied-eval
  new Function(script)();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A storage that refuses every access, as in a locked-down private window. */
const brokenStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
  clear() {},
};

test("index.html has an inline theme script", () => {
  expect(script).toContain(THEME_STORAGE_KEY);
});

test.each(["light", "dark"])("a stored %s choice is applied before the app mounts", (choice) => {
  localStorage.setItem(THEME_STORAGE_KEY, choice);
  runInlineScript();
  expect(document.documentElement.dataset.theme).toBe(choice);
});

test("System, or no choice, or a junk value, leaves the theme to the device", () => {
  for (const stored of ["system", null, "purple"]) {
    localStorage.clear();
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    runInlineScript();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  }
});

test("the script does not throw when storage is unavailable", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  vi.stubGlobal("localStorage", brokenStorage);
  expect(runInlineScript).not.toThrow();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});
