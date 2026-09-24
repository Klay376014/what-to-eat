import type { DOMWrapper, VueWrapper } from "@vue/test-utils";

/**
 * The form control a person would find by reading its label, the way a
 * screen reader associates them: through `<label for>`. Fails if the label
 * is missing or points at nothing, which is itself an accessibility bug.
 */
export function fieldByLabel<T extends Element = HTMLInputElement>(
  wrapper: VueWrapper | DOMWrapper<Element>,
  text: string,
): Omit<DOMWrapper<T>, "exists"> {
  const label = wrapper.findAll("label").find((l) => l.text().trim() === text);
  if (!label) throw new Error(`No label "${text}"`);
  const id = label.attributes("for");
  if (!id) throw new Error(`Label "${text}" is not associated with a control`);
  return wrapper.get<T>(`[id="${id}"]`);
}

/** The button a person would press, found by its visible text. */
export function buttonByText(
  wrapper: VueWrapper | DOMWrapper<Element>,
  text: string,
): DOMWrapper<HTMLButtonElement> {
  const button = wrapper.findAll<HTMLButtonElement>("button").find((b) => b.text().trim() === text);
  if (!button) throw new Error(`No button "${text}"`);
  return button;
}
