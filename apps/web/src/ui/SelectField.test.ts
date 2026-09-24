import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { h } from "vue";
import { fieldByLabel } from "../test/dom.ts";
import SelectField from "./SelectField.vue";

const zones = () => [
  h("option", { value: "Asia/Tokyo" }, "Asia/Tokyo"),
  h("option", { value: "Asia/Seoul" }, "Asia/Seoul"),
];

describe("SelectField", () => {
  test("its label names the select, and choosing updates the value", async () => {
    const wrapper = mount(SelectField, {
      props: { label: "Timezone", modelValue: "Asia/Tokyo" },
      slots: { default: zones },
      attachTo: document.body,
    });

    await fieldByLabel<HTMLSelectElement>(wrapper, "Timezone").setValue("Asia/Seoul");

    expect(wrapper.emitted<[string]>("update:modelValue")!.at(-1)).toEqual(["Asia/Seoul"]);
  });

  test("an error is announced as the select's description and marks it invalid", () => {
    const wrapper = mount(SelectField, {
      props: { label: "Timezone", modelValue: "", error: "Choose a timezone." },
      slots: { default: zones },
      attachTo: document.body,
    });

    const select = fieldByLabel<HTMLSelectElement>(wrapper, "Timezone").element;
    const describedBy = select.getAttribute("aria-describedby")!.split(" ");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy.map((id) => document.getElementById(id)?.textContent?.trim())).toContain(
      "Choose a timezone.",
    );
  });

  test("can be disabled", () => {
    const wrapper = mount(SelectField, {
      props: { label: "Trip", modelValue: "Asia/Tokyo", disabled: true },
      slots: { default: zones },
      attachTo: document.body,
    });

    expect(fieldByLabel<HTMLSelectElement>(wrapper, "Trip").element.disabled).toBe(true);
  });
});
