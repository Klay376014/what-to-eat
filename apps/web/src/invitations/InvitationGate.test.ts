// Opening an invitation link, driven through the screen the way the app
// mounts it: the gate wraps the trips home. The backend is the in-memory
// fakes in src/test/, told up front what each token leads to. Nothing here
// asserts who may join what: whether a token is expired, revoked or valid is
// the database's call, tested in supabase/tests/database/invitations.test.sql.
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { calendarApiKey } from "../calendar/calendarApi.ts";
import { createFakeCalendarApi } from "../test/fakeCalendarApi.ts";
import { mealsApiKey } from "../grid/mealsApi.ts";
import { createFakeMealsApi } from "../test/fakeMealsApi.ts";
import { createFakeMembership, type FakeLink } from "../test/fakeMembershipApi.ts";
import { aTrip, createFakeTripsApi } from "../test/fakeTripsApi.ts";
import type { Trip } from "../trips/trip.ts";
import { tripsApiKey } from "../trips/tripsApi.ts";
import TripsHome from "../trips/TripsHome.vue";
import InvitationGate from "./InvitationGate.vue";
import { membershipApiKey } from "./membershipApi.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const me = { userId: "erin", name: "Erin Kao" };

const tokyo = aTrip({
  id: "tokyo",
  name: "Tokyo",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  timezone: "Asia/Tokyo",
  myRole: "member",
  organiserName: "Alice Chen",
});
// Starts sooner than Tokyo, so it is what the app would open by default.
const taipei = aTrip({
  id: "taipei",
  name: "Taipei",
  startDate: "2026-09-25",
  endDate: "2026-09-27",
  myRole: "organiser",
  organiserName: "Erin Kao",
});

async function openWith(
  token: string | null,
  options: { links?: Record<string, FakeLink>; myTrips?: Trip[]; alreadyIn?: string[] } = {},
) {
  const alice = { userId: "alice", name: "Alice Chen", role: "organiser" as const };
  const tokyoMembers = options.alreadyIn?.includes("tokyo")
    ? [alice, { ...me, role: "member" as const }]
    : [alice];
  const fake = createFakeMembership({
    me,
    links: options.links,
    members: { tokyo: tokyoMembers },
  });
  const trips = fake.tripsApi(createFakeTripsApi({ trips: options.myTrips ?? [taipei] }));
  const settled = vi.fn();

  // The same arrangement as App.vue.
  const Harness = defineComponent(
    () => () =>
      h(
        InvitationGate,
        { token, onSettled: settled },
        {
          default: ({ openTripId }: { openTripId: string | null }) => h(TripsHome, { openTripId }),
        },
      ),
  );
  const wrapper = mount(Harness, {
    global: {
      provide: {
        [tripsApiKey as symbol]: trips,
        [membershipApiKey as symbol]: fake.api,
        // #7: the trip view also shows the trip grid.
        [mealsApiKey as symbol]: createFakeMealsApi(),
        // #12: the grid also shows the trip's calendar.
        [calendarApiKey as symbol]: createFakeCalendarApi(),
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, settled };
}

function openTripName(wrapper: Awaited<ReturnType<typeof openWith>>["wrapper"]) {
  return wrapper.get("article h2").text();
}

describe("opening a valid link while signed in", () => {
  test("joins the trip and opens it, instead of the trip the app would open by default", async () => {
    const { wrapper } = await openWith("good", { links: { good: { trip: tokyo } } });

    expect(wrapper.text()).toContain("You've joined the trip");
    expect(openTripName(wrapper)).toBe("Tokyo");
    expect(wrapper.text()).toContain("Organised by Alice Chen");
  });

  test("shows the new member among the people in the trip", async () => {
    const { wrapper } = await openWith("good", { links: { good: { trip: tokyo } } });

    const people = wrapper.findAll("li").map((li) => li.text());
    expect(people.some((t) => t.includes("Alice Chen") && t.includes("Organiser"))).toBe(true);
    expect(people.some((t) => t.includes("Erin Kao") && t.includes("(you)"))).toBe(true);
  });

  test("spends the invitation, so a reload does not try it again", async () => {
    const { settled } = await openWith("good", { links: { good: { trip: tokyo } } });

    expect(settled).toHaveBeenCalledOnce();
  });
});

describe("opening a link for a trip I am already in", () => {
  test("takes me into it without an error", async () => {
    const { wrapper } = await openWith("again", {
      links: { again: { trip: tokyo } },
      myTrips: [taipei, tokyo],
    });

    expect(openTripName(wrapper)).toBe("Tokyo");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  test("does not welcome me as if I had just joined", async () => {
    const { wrapper } = await openWith("again", {
      links: { again: { trip: tokyo } },
      myTrips: [taipei, tokyo],
      alreadyIn: ["tokyo"],
    });

    expect(openTripName(wrapper)).toBe("Tokyo");
    expect(wrapper.text()).not.toContain("You've joined");
  });
});

describe("opening a link that does not work", () => {
  test.each([
    ["expired", "This invitation has expired", "7 days"],
    ["revoked", "This invitation was withdrawn", "turned this link off"],
    ["invalid", "This invitation link doesn't work", "cut short"],
    ["full", "This trip is full", "8 people"],
    ["predates_departure", "This link is from before you left", "new one"],
  ] as const)("a %s link is explained, not dropped", async (reason, title, detail) => {
    const { wrapper } = await openWith("bad", { links: { bad: { refused: reason } } });

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain(title);
    expect(alert.text()).toContain(detail);
    expect(alert.text()).not.toContain("Tokyo");
  });

  test("still shows my own trips underneath, opened as usual", async () => {
    const { wrapper } = await openWith("bad", { links: { bad: { refused: "expired" } } });

    expect(openTripName(wrapper)).toBe("Taipei");
  });

  test("the explanation can be dismissed", async () => {
    const { wrapper } = await openWith("bad", { links: { bad: { refused: "revoked" } } });

    const dismiss = wrapper.findAll("button").find((b) => b.text() === "Dismiss")!;
    await dismiss.trigger("click");

    expect(wrapper.text()).not.toContain("This invitation was withdrawn");
  });

  test("a refused link is spent too", async () => {
    const { settled } = await openWith("bad", { links: { bad: { refused: "expired" } } });

    expect(settled).toHaveBeenCalledOnce();
  });
});

describe("with no invitation", () => {
  test("goes straight to my trips", async () => {
    const { wrapper, settled } = await openWith(null);

    expect(openTripName(wrapper)).toBe("Taipei");
    expect(wrapper.text()).not.toContain("joined");
    expect(settled).not.toHaveBeenCalled();
  });
});
