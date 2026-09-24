import { mount } from "@vue/test-utils";
import { expect, test, vi } from "vite-plus/test";
import { h } from "vue";
import { buttonByText } from "../test/dom.ts";
import EmptyState from "./EmptyState.vue";

test("an empty state explains itself and offers the way forward", async () => {
  const onCreate = vi.fn();
  const wrapper = mount(EmptyState, {
    props: { title: "No trips yet" },
    slots: {
      default: () => "Create a trip to start deciding where to eat.",
      action: () => h("button", { type: "button", onClick: onCreate }, "Create a trip"),
    },
  });

  expect(wrapper.get("h2").text()).toBe("No trips yet");
  expect(wrapper.text()).toContain("Create a trip to start deciding where to eat.");
  await buttonByText(wrapper, "Create a trip").trigger("click");
  expect(onCreate).toHaveBeenCalledOnce();
});
