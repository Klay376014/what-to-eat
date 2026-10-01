// The strip's edge cue (#48). happy-dom lays nothing out, so each test sets
// the strip's scroll size by hand, the way a browser would have measured it;
// how the cue looks is checked in a browser, not here.
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { nextTick } from "vue";
import DayTabs from "./DayTabs.vue";
import { addDays, type DayTab } from "./tripDays.ts";

const tabs: DayTab[] = Array.from({ length: 10 }, (_, i) => ({
  date: addDays("2026-10-01", i),
  isToday: false,
  summary: { gaps: 3, open: 0, text: "3 gaps" },
}));

function mountTabs(active = tabs[0]!.date) {
  return mount(DayTabs, {
    props: { tabs, active, idPrefix: "day", panelId: "panel" },
    attachTo: document.body,
  });
}

function strip(wrapper: VueWrapper) {
  return wrapper.get<HTMLElement>('[role="tablist"]').element;
}

/** As a browser measures it: the strip's visible width, its content's width, and where it is scrolled to. */
function layOut(el: HTMLElement, size: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: size.clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: size.scrollWidth });
}

async function scrollTo(wrapper: VueWrapper, left: number) {
  strip(wrapper).scrollLeft = left;
  strip(wrapper).dispatchEvent(new Event("scroll"));
  await nextTick();
}

function cues(wrapper: VueWrapper) {
  const frame = wrapper.get(".strip-frame");
  return {
    before: frame.classes("more-before"),
    after: frame.classes("more-after"),
  };
}

describe("the strip's edge cue (#48)", () => {
  test("shows no cue when every day fits", async () => {
    const wrapper = mountTabs();
    layOut(strip(wrapper), { clientWidth: 600, scrollWidth: 600 });
    await scrollTo(wrapper, 0);

    expect(cues(wrapper)).toEqual({ before: false, after: false });
  });

  test("shows a cue on each side the strip can still scroll to", async () => {
    const wrapper = mountTabs();
    layOut(strip(wrapper), { clientWidth: 300, scrollWidth: 600 });

    await scrollTo(wrapper, 0);
    expect(cues(wrapper)).toEqual({ before: false, after: true });

    await scrollTo(wrapper, 150);
    expect(cues(wrapper)).toEqual({ before: true, after: true });

    await scrollTo(wrapper, 300);
    expect(cues(wrapper)).toEqual({ before: true, after: false });
  });

  test("follows the days themselves: a tab growing wider turns the cue on", async () => {
    const wrapper = mountTabs();
    layOut(strip(wrapper), { clientWidth: 600, scrollWidth: 600 });
    await scrollTo(wrapper, 0);
    expect(cues(wrapper).after).toBe(false);

    // A day's summary changes and its tab widens; the strip keeps its size.
    layOut(strip(wrapper), { clientWidth: 600, scrollWidth: 640 });
    const changed = tabs.map((t, i) =>
      i === 9 ? { ...t, summary: { gaps: 0, open: 2, text: "2 open" } } : t,
    );
    await wrapper.setProps({ tabs: changed } as Record<string, unknown>);
    await nextTick();

    expect(cues(wrapper).after).toBe(true);
  });

  test("is decoration only: hidden from assistive technology", () => {
    const wrapper = mountTabs();
    const edges = wrapper.findAll(".edge");
    expect(edges).toHaveLength(2);
    for (const edge of edges) expect(edge.attributes("aria-hidden")).toBe("true");
  });

  test("keeps the selected day clear of the cue", async () => {
    const wrapper = mountTabs();
    const el = strip(wrapper);
    layOut(el, { clientWidth: 300, scrollWidth: 600 });
    // Ten 60px tabs; the sixth (300–360px) sits just past the right edge.
    wrapper.findAll<HTMLElement>('[role="tab"]').forEach((tab, i) => {
      Object.defineProperty(tab.element, "offsetLeft", { configurable: true, value: i * 60 });
      Object.defineProperty(tab.element, "offsetWidth", { configurable: true, value: 60 });
    });
    await scrollTo(wrapper, 0);

    await wrapper.setProps({ active: tabs[5]!.date } as Record<string, unknown>);
    await nextTick();

    // Scrolled so its right edge is a cue's width (32px) inside the strip's.
    expect(el.scrollLeft).toBe(360 + 32 - 300);
  });
});
