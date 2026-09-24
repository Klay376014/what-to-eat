import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { fieldByLabel } from "../test/dom.ts";
import TextAreaField from "./TextAreaField.vue";

describe("TextAreaField", () => {
  test("its label names the textarea, and typing several lines updates the value", async () => {
    const wrapper = mount(TextAreaField, {
      props: { label: "Note", modelValue: "" },
      attachTo: document.body,
    });

    const control = fieldByLabel<HTMLTextAreaElement>(wrapper, "Note");
    expect(control.element.tagName).toBe("TEXTAREA");
    await control.setValue("Cash only.\nQueue moves fast.");

    expect(wrapper.emitted<[string]>("update:modelValue")!.at(-1)).toEqual([
      "Cash only.\nQueue moves fast.",
    ]);
  });

  test("the hint and the error are announced with it, and the error marks it invalid", () => {
    const wrapper = mount(TextAreaField, {
      props: { label: "Note", modelValue: "", hint: "Optional.", error: "Too long." },
      attachTo: document.body,
    });

    const control = fieldByLabel<HTMLTextAreaElement>(wrapper, "Note").element;
    const described = (control.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim());
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(described).toEqual(["Optional.", "Too long."]);
  });
});
