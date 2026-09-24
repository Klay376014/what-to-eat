// The people in a trip and what can be done with them, driven through the
// screen against the in-memory fake (src/test/fakeMembershipApi.ts). These
// tests seed who is organiser and check what the screen offers and shows;
// they never assert that someone *may not* do something. The database
// functions are what refuse, and supabase/tests/database/membership.test.sql
// is where that is proven.
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, test } from "vite-plus/test";
import { membershipApiKey } from "../invitations/membershipApi.ts";
import { buttonByText } from "../test/dom.ts";
import { createFakeMembership, type FakePerson } from "../test/fakeMembershipApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import type { Trip, TripRole } from "../trips/trip.ts";
import TripPeople from "./TripPeople.vue";

const alice: FakePerson = { userId: "alice", name: "Alice Chen" };
const bob = { userId: "bob", name: "Bob Lin" };
const dave = { userId: "dave", name: "Dave Ho" };

function tokyo(myRole: TripRole): Trip {
  return aTrip({ id: "tokyo", name: "Tokyo", myRole, organiserName: "Alice Chen" });
}

async function show(options: {
  me: FakePerson;
  myRole: TripRole;
  people?: { person: FakePerson; role: TripRole }[];
}) {
  const people = options.people ?? [
    { person: alice, role: "organiser" },
    { person: bob, role: "member" },
    { person: dave, role: "member" },
  ];
  const fake = createFakeMembership({
    me: options.me,
    members: { tokyo: people.map(({ person, role }) => ({ ...person, role })) },
  });
  // Passes the trip back after a hand-over, as TripsHome does.
  const Parent = defineComponent(() => {
    const trip = ref(tokyo(options.myRole));
    return () =>
      h(TripPeople, { trip: trip.value, onChanged: (next: Trip) => (trip.value = next) });
  });
  const wrapper = mount(Parent, {
    global: { provide: { [membershipApiKey as symbol]: fake.api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function emitted<T extends unknown[]>(wrapper: Wrapper, event: "left" | "changed") {
  return wrapper.findComponent(TripPeople).emitted<T>(event);
}

type Wrapper = Awaited<ReturnType<typeof show>>;

function listed(wrapper: Wrapper): string[] {
  return wrapper.findAll(".members > li").map((li) => li.get(".name").text());
}

function dialog(wrapper: Wrapper) {
  const found = wrapper.find('[role="alertdialog"]');
  if (!found.exists()) throw new Error("No dialog open");
  return found;
}

describe("seeing who is in the trip", () => {
  test("a member sees everyone, the organiser first and marked as such", async () => {
    const wrapper = await show({ me: bob, myRole: "member" });

    expect(listed(wrapper)).toEqual(["Alice Chen", "Bob Lin (you)", "Dave Ho"]);
    expect(wrapper.get(".members > li").text()).toContain("Organiser");
  });

  test("shows how full the trip is against the limit", async () => {
    const wrapper = await show({ me: bob, myRole: "member" });

    expect(wrapper.get("h2").text()).toContain("3 of 8");
  });

  test("someone with no Google name still appears", async () => {
    const wrapper = await show({
      me: alice,
      myRole: "organiser",
      people: [
        { person: alice, role: "organiser" },
        { person: { userId: "x", name: null }, role: "member" },
      ],
    });

    expect(listed(wrapper)).toContain("A member with no name");
  });
});

describe("an organiser removing a member", () => {
  test("asks first, then takes them off the list", async () => {
    const wrapper = await show({ me: alice, myRole: "organiser" });

    await buttonByText(wrapper, "Remove Dave Ho").trigger("click");
    expect(dialog(wrapper).text()).toContain("Remove Dave Ho from the trip?");
    expect(dialog(wrapper).text()).toContain("proposed or voted on stays");

    await buttonByText(dialog(wrapper), "Remove").trigger("click");
    await flushPromises();

    expect(listed(wrapper)).toEqual(["Alice Chen (you)", "Bob Lin"]);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
  });

  test("changing their mind keeps the member", async () => {
    const wrapper = await show({ me: alice, myRole: "organiser" });

    await buttonByText(wrapper, "Remove Dave Ho").trigger("click");
    await buttonByText(dialog(wrapper), "Cancel").trigger("click");
    await flushPromises();

    expect(listed(wrapper)).toContain("Dave Ho");
  });

  test("an ordinary member is offered no remove or hand-over buttons", async () => {
    const wrapper = await show({ me: bob, myRole: "member" });

    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels.some((l) => l.startsWith("Remove"))).toBe(false);
    expect(labels.some((l) => l.startsWith("Make organiser"))).toBe(false);
  });
});

describe("a member leaving", () => {
  test("asks first, then reports that they left", async () => {
    const wrapper = await show({ me: bob, myRole: "member" });

    await buttonByText(wrapper, "Leave trip").trigger("click");
    expect(dialog(wrapper).text()).toContain("Leave “Tokyo”?");
    await buttonByText(dialog(wrapper), "Leave trip").trigger("click");
    await flushPromises();

    expect(emitted(wrapper, "left")).toEqual([["tokyo"]]);
  });
});

describe("the organiser trying to leave", () => {
  test("is told to hand over the role first, and does not leave", async () => {
    const wrapper = await show({ me: alice, myRole: "organiser" });

    await buttonByText(wrapper, "Leave trip").trigger("click");

    expect(wrapper.get('[role="alert"]').text()).toContain("hand the role to someone else");
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(emitted(wrapper, "left")).toBeUndefined();
  });

  test("can then hand over the role, and leave as an ordinary member", async () => {
    const wrapper = await show({ me: alice, myRole: "organiser" });
    await buttonByText(wrapper, "Leave trip").trigger("click");

    await buttonByText(wrapper, "Make organiser: Bob Lin").trigger("click");
    expect(dialog(wrapper).text()).toContain("Make Bob Lin the organiser?");
    await buttonByText(dialog(wrapper), "Make organiser").trigger("click");
    await flushPromises();

    const [[changed]] = emitted<[Trip]>(wrapper, "changed")!;
    expect(changed).toMatchObject({ id: "tokyo", myRole: "member", organiserName: "Bob Lin" });
    expect(wrapper.find(".members > li").text()).toContain("Bob Lin");
    expect(wrapper.find(".members > li").text()).toContain("Organiser");

    // The parent has passed the trip back with the new role.
    await buttonByText(wrapper, "Leave trip").trigger("click");
    await buttonByText(dialog(wrapper), "Leave trip").trigger("click");
    await flushPromises();

    expect(emitted(wrapper, "left")).toEqual([["tokyo"]]);
  });

  test("as the only one in the trip, is pointed to deleting it instead", async () => {
    const wrapper = await show({
      me: alice,
      myRole: "organiser",
      people: [{ person: alice, role: "organiser" }],
    });

    await buttonByText(wrapper, "Leave trip").trigger("click");

    expect(wrapper.get('[role="alert"]').text()).toContain("delete it");
  });
});
