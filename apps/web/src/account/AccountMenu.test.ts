// The account menu in the header: the usual website pattern. Driven through
// the DOM the way a person uses it, by pointer and by keyboard.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { nextTick } from "vue";
import { buttonByText } from "../test/dom.ts";
import AccountMenu from "./AccountMenu.vue";

const klay = { name: "Klay Lee", email: "klay@example.com", avatarUrl: null as string | null };

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

function mountMenu(options: { signOut?: () => Promise<void>; avatarUrl?: string | null } = {}) {
  const signOut = vi.fn(options.signOut ?? (async () => {}));
  const wrapper = mount(AccountMenu, {
    props: { user: { ...klay, avatarUrl: options.avatarUrl ?? null }, signOut },
    attachTo: document.body,
  });
  const button = () => wrapper.get<HTMLButtonElement>("button[aria-haspopup]");
  const menu = () => wrapper.find('[role="menu"]');
  async function open() {
    button().element.focus();
    await button().trigger("click");
    await nextTick();
  }
  const item = (name: string) =>
    wrapper.findAll<HTMLElement>('[role^="menuitem"]').find((el) => el.text().trim() === name) ??
    (() => {
      throw new Error(`No menu item "${name}"`);
    })();
  return { wrapper, signOut, button, menu, open, item };
}

describe("the account button", () => {
  test("is named for the signed-in person and says it opens a menu", () => {
    const { button } = mountMenu();

    expect(button().attributes("aria-label")).toBe("Account: Klay Lee");
    expect(button().attributes("aria-haspopup")).toBe("menu");
    expect(button().attributes("aria-expanded")).toBe("false");
  });

  test("shows the Google picture when there is one", () => {
    const { button } = mountMenu({ avatarUrl: "https://lh3.googleusercontent.com/a/klay" });

    expect(button().get("img").attributes("src")).toBe("https://lh3.googleusercontent.com/a/klay");
  });

  test("falls back to initials without a picture, or when it fails to load", async () => {
    expect(mountMenu().button().text()).toBe("KL");

    const withPicture = mountMenu({ avatarUrl: "https://lh3.googleusercontent.com/a/gone" });
    await withPicture.button().get("img").trigger("error");
    expect(withPicture.button().find("img").exists()).toBe(false);
    expect(withPicture.button().text()).toBe("KL");
  });
});

describe("the menu", () => {
  test("opens with the person's name and email, the theme choice and Sign out", async () => {
    const { button, menu, open, wrapper } = mountMenu();

    expect(menu().exists()).toBe(false);
    await open();

    expect(button().attributes("aria-expanded")).toBe("true");
    expect(menu().exists()).toBe(true);
    expect(wrapper.text()).toContain("Klay Lee");
    expect(wrapper.text()).toContain("klay@example.com");
    expect(wrapper.findAll('[role="menuitemradio"]').map((el) => el.text().trim())).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(wrapper.find('[role="menuitem"]').text()).toBe("Sign out");
  });

  test("opening moves focus into the menu, and arrow keys move between items", async () => {
    const { menu, open, item } = mountMenu();
    await open();

    expect(document.activeElement).toBe(item("System").element);
    await menu().trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Light").element);
    await menu().trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(item("Sign out").element);
    await menu().trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("System").element);
  });

  test("Escape closes it and returns focus to the account button", async () => {
    const { button, menu, open } = mountMenu();
    await open();

    await menu().trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(menu().exists()).toBe(false);
    expect(button().attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button().element);
  });

  test("a click outside closes it", async () => {
    const { menu, open } = mountMenu();
    await open();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await nextTick();

    expect(menu().exists()).toBe(false);
  });

  test("a click inside does not close it", async () => {
    const { menu, open } = mountMenu();
    await open();

    menu().element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await nextTick();

    expect(menu().exists()).toBe(true);
  });

  test("pressing the button again closes it", async () => {
    const { button, menu, open } = mountMenu();
    await open();

    await button().trigger("click");

    expect(menu().exists()).toBe(false);
  });
});

describe("signing out", () => {
  test("Sign out signs out", async () => {
    const { signOut, open, item } = mountMenu();
    await open();

    await item("Sign out").trigger("click");
    await flushPromises();

    expect(signOut).toHaveBeenCalledOnce();
  });

  test("a failure to sign out is shown", async () => {
    const { open, item, wrapper } = mountMenu({
      signOut: async () => {
        throw new Error("network down");
      },
    });
    await open();

    await item("Sign out").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("network down");
  });
});

describe("the theme choice", () => {
  test("starts on System, which leaves the theme to the device", async () => {
    const { open, item } = mountMenu();
    await open();

    expect(item("System").attributes("aria-checked")).toBe("true");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("the chosen theme lands on the page, and System hands it back", async () => {
    const { open, item } = mountMenu();
    await open();

    await item("Dark").trigger("click");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(item("Dark").attributes("aria-checked")).toBe("true");
    expect(item("System").attributes("aria-checked")).toBe("false");

    await item("Light").trigger("click");
    expect(document.documentElement.dataset.theme).toBe("light");

    await item("System").trigger("click");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("the choice survives a remount, as it would a reload", async () => {
    const first = mountMenu();
    await first.open();
    await first.item("Dark").trigger("click");
    first.wrapper.unmount();
    document.documentElement.removeAttribute("data-theme");

    const second = mountMenu();
    await second.open();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(second.item("Dark").attributes("aria-checked")).toBe("true");
  });

  test("with storage unavailable it falls back to System, and choosing still works", async () => {
    localStorage.setItem("what-to-eat.theme", "dark");
    vi.stubGlobal("localStorage", brokenStorage);

    const { open, item } = mountMenu();
    await open();
    expect(item("System").attributes("aria-checked")).toBe("true");

    await item("Light").trigger("click");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

test("the Sign out item is a real, keyboard-reachable control", async () => {
  const { open, wrapper } = mountMenu();
  await open();
  expect(buttonByText(wrapper, "Sign out").element.tagName).toBe("BUTTON");
});
