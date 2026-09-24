// The organiser's invitation links, driven through the screen against the
// in-memory fake. Token strength, the 7-day expiry, revocation and the member
// limit are the database's to enforce (supabase/tests/database/); these tests
// check what the organiser sees and can do.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import { createFakeMembership, type FakePerson } from "../test/fakeMembershipApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import type { Invitation } from "./membershipApi.ts";
import { membershipApiKey } from "./membershipApi.ts";
import InviteLinks from "./InviteLinks.vue";

const NOW = new Date("2026-09-20T03:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Stands in for the browser's clipboard, as an own property that shadows it. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

const alice: FakePerson = { userId: "alice", name: "Alice Chen" };
const trip = aTrip({ id: "tokyo", name: "Tokyo", myRole: "organiser" });

function people(count: number) {
  return Array.from({ length: count }, (_, n) => ({
    userId: n === 0 ? "alice" : `m${n}`,
    name: n === 0 ? "Alice Chen" : `Member ${n}`,
    role: n === 0 ? ("organiser" as const) : ("member" as const),
  }));
}

async function show(
  options: { memberCount?: number; members?: number; invitations?: Invitation[] } = {},
) {
  const memberCount = options.memberCount ?? 3;
  const fake = createFakeMembership({
    me: alice,
    members: { tokyo: people(options.members ?? memberCount) },
    invitations: { tokyo: options.invitations ?? [] },
    now: () => new Date(),
  });
  const wrapper = mount(InviteLinks, {
    props: { trip, memberCount },
    global: { provide: { [membershipApiKey as symbol]: fake.api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof show>>;

function linkFields(wrapper: Wrapper) {
  return wrapper.findAll<HTMLInputElement>("input[readonly]");
}

describe("making a link", () => {
  test("shows a link to the app carrying the invitation, valid for 7 days", async () => {
    const wrapper = await show();

    await buttonByText(wrapper, "Make an invitation link").trigger("click");
    await flushPromises();

    const field = fieldByLabel(wrapper, "Invitation link, works for 7 days");
    const url = new URL(field.element.value);
    expect(url.origin).toBe(window.location.origin);
    expect(url.searchParams.get("invite")).toBe("token-1");
  });

  test("the link can be copied to paste into the group chat", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    stubClipboard(writeText);
    const wrapper = await show();
    await buttonByText(wrapper, "Make an invitation link").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Copy link").trigger("click");
    await flushPromises();

    expect(writeText.mock.calls[0]![0]).toBe(linkFields(wrapper)[0]!.element.value);
    expect(wrapper.get('[role="status"]').text()).toBe("Copied");
  });

  test("when copying is not possible, says to copy it by hand", async () => {
    stubClipboard(async () => Promise.reject(new Error("denied")));
    const wrapper = await show();
    await buttonByText(wrapper, "Make an invitation link").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Copy link").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("copy it yourself");
  });
});

describe("the links listed", () => {
  test("are only the ones that still work, each with the time it has left", async () => {
    const wrapper = await show({
      invitations: [
        {
          id: "a",
          token: "live",
          createdAt: hours(-24),
          expiresAt: hours(6 * 24),
          revokedAt: null,
        },
        { id: "b", token: "old", createdAt: hours(-200), expiresAt: hours(-32), revokedAt: null },
        {
          id: "c",
          token: "off",
          createdAt: hours(-2),
          expiresAt: hours(166),
          revokedAt: hours(-1),
        },
        { id: "d", token: "late", createdAt: hours(-165), expiresAt: hours(3), revokedAt: null },
      ],
    });

    const values = linkFields(wrapper).map((f) =>
      new URL(f.element.value).searchParams.get("invite"),
    );
    expect(values).toEqual(["live", "late"]);
    expect(wrapper.text()).toContain("works for 6 days");
    expect(wrapper.text()).toContain("works for 3 hours");
    expect(buttonByText(wrapper, "Make another link").exists()).toBe(true);
  });
});

describe("turning a link off", () => {
  test("asks first, then takes it off the list", async () => {
    const wrapper = await show({
      invitations: [
        {
          id: "a",
          token: "live",
          createdAt: hours(-24),
          expiresAt: hours(6 * 24),
          revokedAt: null,
        },
      ],
    });

    await buttonByText(wrapper, "Turn off").trigger("click");
    const dialog = wrapper.find('[role="alertdialog"]');
    expect(dialog.text()).toContain("already joined with it stay in the trip");
    await buttonByText(dialog, "Turn off link").trigger("click");
    await flushPromises();

    expect(linkFields(wrapper)).toHaveLength(0);
    expect(buttonByText(wrapper, "Make an invitation link").exists()).toBe(true);
  });
});

describe("a full trip", () => {
  test("offers no new link, and says why the limit exists", async () => {
    const wrapper = await show({ memberCount: 8 });

    expect(wrapper.text()).toContain("This trip is full: it has 8 people.");
    expect(wrapper.text()).toContain("survey nobody finishes");
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels.some((l) => l.includes("link"))).toBe(false);
  });

  test("a refusal from the backend, when the trip filled up meanwhile, is explained", async () => {
    // The screen counted 7, but someone joined in the meantime.
    const wrapper = await show({ memberCount: 7, members: 8 });

    await buttonByText(wrapper, "Make an invitation link").trigger("click");
    await flushPromises();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("at most 8 people");
    expect(alert.text()).toContain("survey nobody finishes");
    expect(linkFields(wrapper)).toHaveLength(0);
  });
});
