// Base components are tested through the DOM, the way a person meets them:
// what they read, what they press, what happens. No snapshots, no class names.
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vite-plus/test";
import { h } from "vue";
import BaseButton from "./BaseButton.vue";

describe("BaseButton", () => {
  test("shows its label and reports a press", async () => {
    const onClick = vi.fn();
    const wrapper = mount(BaseButton, { props: { onClick }, slots: { default: "Save" } });

    await wrapper.get("button").trigger("click");

    expect(wrapper.get("button").text()).toBe("Save");
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("a disabled button does not fire, however it is pressed", async () => {
    const onClick = vi.fn();
    const wrapper = mount(BaseButton, {
      props: { onClick, disabled: true },
      slots: { default: "Save" },
      attachTo: document.body,
    });

    await wrapper.get("button").trigger("click");
    wrapper.get("button").element.click();
    wrapper.get("button").element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("does not submit a surrounding form unless it is a submit button", async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const wrapper = mount(
      {
        render: () =>
          h("form", { onSubmit }, [
            h(BaseButton, null, () => "Cancel"),
            h(BaseButton, { type: "submit" }, () => "Create"),
          ]),
      },
      { attachTo: document.body },
    );
    const [cancel, create] = wrapper.findAll("button");

    await cancel!.trigger("click");
    expect(onSubmit).not.toHaveBeenCalled();

    await create!.trigger("click");
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
