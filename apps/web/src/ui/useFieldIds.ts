import { computed, useId, type Ref } from "vue";

/**
 * Ids that tie a form control to its label, hint and error, and the
 * aria-describedby that announces the hint and error with the control.
 */
export function useFieldIds(hint: Ref<string | undefined>, error: Ref<string | undefined>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = computed(
    () =>
      [hint.value ? hintId : null, error.value ? errorId : null].filter(Boolean).join(" ") ||
      undefined,
  );
  return { id, hintId, errorId, describedBy };
}
