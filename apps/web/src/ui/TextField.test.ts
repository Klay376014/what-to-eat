import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { fieldByLabel } from "../test/dom.ts";
import TextField from "./TextField.vue";

/** The text of every element the control names in aria-describedby. */
function description(control: Element): string[] {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? `missing #${id}`);
}

describe("TextField", () => {
  test("its label names the input, and typing updates the value", async () => {
    const wrapper = mount(TextField, {
      props: { label: "Trip name", modelValue: "" },
      attachTo: document.body,
    });

    await fieldByLabel(wrapper, "Trip name").setValue("Tokyo");

    expect(wrapper.emitted<[string]>("update:modelValue")!.at(-1)).toEqual(["Tokyo"]);
  });

  test("an error is announced as the input's description and marks it invalid", () => {
    const wrapper = mount(TextField, {
      props: { label: "Trip name", modelValue: "", error: "Give the trip a name." },
      attachTo: document.body,
    });

    const input = fieldByLabel(wrapper, "Trip name").element;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toContain("Give the trip a name.");
  });

  test("a hint is part of the description too, alongside any error", () => {
    const wrapper = mount(TextField, {
      props: {
        label: "End date",
        modelValue: "",
        type: "date",
        hint: "Leave empty for everyday use.",
        error: "Add an end date.",
      },
      attachTo: document.body,
    });

    const input = fieldByLabel(wrapper, "End date").element;
    expect(input.type).toBe("date");
    expect(description(input)).toEqual(["Leave empty for everyday use.", "Add an end date."]);
  });

  test("without an error the input is not marked invalid", () => {
    const wrapper = mount(TextField, {
      props: { label: "Trip name", modelValue: "Tokyo" },
      attachTo: document.body,
    });

    const input = fieldByLabel(wrapper, "Trip name").element;
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});
