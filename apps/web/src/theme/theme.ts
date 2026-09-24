/*
 * The light/dark choice: System (the default, follows the device), Light or
 * Dark. It is applied through tokens.css's data-theme hook on <html> and kept
 * in localStorage. Storage can be missing or throw (private windows, blocked
 * site data), so every access is guarded and the fallback is System.
 *
 * index.html repeats the read-and-apply part as a tiny inline script, so the
 * right theme is set before the app mounts; theme.test.ts keeps them in step.
 */
import { ref, watch, type Ref } from "vue";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "what-to-eat.theme";
export const themeChoices: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function saveChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = choice;
}

/** The current choice; setting it applies and remembers it. */
export function useTheme(): Ref<ThemeChoice> {
  const choice = ref<ThemeChoice>(readChoice());
  watch(
    choice,
    (next) => {
      applyChoice(next);
      saveChoice(next);
    },
    { immediate: true, flush: "sync" },
  );
  return choice;
}
