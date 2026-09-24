import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { defineComponent, h, nextTick, ref } from "vue";
import { buttonByText } from "../test/dom.ts";
import ConfirmDialog from "./ConfirmDialog.vue";

/** A page with a button that opens the dialog, the way screens use it. */
function mountPage(options: { busy?: boolean } = {}) {
  const events: string[] = [];
  const Page = defineComponent(() => {
    const open = ref(false);
    const close = (event: string) => {
      events.push(event);
      open.value = false;
    };
    return () => [
      h("button", { type: "button", onClick: () => (open.value = true) }, "Delete trip"),
      h(
        ConfirmDialog,
        {
          open: open.value,
          title: "Delete “Tokyo”?",
          confirmLabel: "Delete for everyone",
          cancelLabel: "Keep the trip",
          destructive: true,
          busy: options.busy ?? false,
          onConfirm: () => close("confirm"),
          onCancel: () => close("cancel"),
        },
        () => h("p", "This removes the trip for every member."),
      ),
    ];
  });
  const wrapper = mount(Page, { attachTo: document.body });
  const dialog = () => wrapper.find('[role="alertdialog"]');
  async function openFromTrigger() {
    const trigger = buttonByText(wrapper, "Delete trip");
    trigger.element.focus();
    await trigger.trigger("click");
    await nextTick();
    return trigger;
  }
  return { wrapper, events, dialog, openFromTrigger };
}

describe("ConfirmDialog", () => {
  test("is not on the page until it is opened", async () => {
    const { dialog, openFromTrigger } = mountPage();

    expect(dialog().exists()).toBe(false);
    await openFromTrigger();

    expect(dialog().exists()).toBe(true);
    expect((dialog().element as HTMLDialogElement).open).toBe(true);
  });

  test("is named by its title and described by its message", async () => {
    const { dialog, openFromTrigger } = mountPage();
    await openFromTrigger();

    const el = dialog().element;
    const byId = (attr: string) => document.getElementById(el.getAttribute(attr)!)?.textContent;
    expect(byId("aria-labelledby")).toBe("Delete “Tokyo”?");
    expect(byId("aria-describedby")).toContain("This removes the trip for every member.");
  });

  test("confirming reports confirm", async () => {
    const { wrapper, events, dialog, openFromTrigger } = mountPage();
    await openFromTrigger();

    await buttonByText(wrapper, "Delete for everyone").trigger("click");

    expect(events).toEqual(["confirm"]);
    expect(dialog().exists()).toBe(false);
  });

  test("the cancel button reports cancel", async () => {
    const { wrapper, events, openFromTrigger } = mountPage();
    await openFromTrigger();

    await buttonByText(wrapper, "Keep the trip").trigger("click");

    expect(events).toEqual(["cancel"]);
  });

  test("Escape cancels", async () => {
    const { events, dialog, openFromTrigger } = mountPage();
    await openFromTrigger();

    await dialog().trigger("keydown", { key: "Escape" });

    expect(events).toEqual(["cancel"]);
    expect(dialog().exists()).toBe(false);
  });

  test("the browser's own cancel request (Escape, back gesture) cancels once", async () => {
    const { events, dialog, openFromTrigger } = mountPage();
    await openFromTrigger();

    await dialog().trigger("cancel");

    expect(events).toEqual(["cancel"]);
  });

  test("opening moves focus to the safe choice, not the destructive one", async () => {
    const { wrapper, openFromTrigger } = mountPage();
    await openFromTrigger();

    expect(document.activeElement).toBe(buttonByText(wrapper, "Keep the trip").element);
  });

  test("focus returns to the button that opened it, whichever way it closes", async () => {
    const { wrapper, dialog, openFromTrigger } = mountPage();

    const trigger = await openFromTrigger();
    await buttonByText(wrapper, "Keep the trip").trigger("click");
    await nextTick();
    expect(document.activeElement).toBe(trigger.element);

    await openFromTrigger();
    await dialog().trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(document.activeElement).toBe(trigger.element);
  });

  test("while busy, neither choice can be pressed and Escape does nothing", async () => {
    const { wrapper, events, dialog, openFromTrigger } = mountPage({ busy: true });
    await openFromTrigger();

    expect(buttonByText(wrapper, "Delete for everyone").element.disabled).toBe(true);
    expect(buttonByText(wrapper, "Keep the trip").element.disabled).toBe(true);
    await dialog().trigger("keydown", { key: "Escape" });
    expect(events).toEqual([]);
  });
});
