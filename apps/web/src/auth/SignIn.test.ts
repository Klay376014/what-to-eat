import { mount } from "@vue/test-utils";
import { expect, test } from "vite-plus/test";
import SignIn from "./SignIn.vue";

const signIn = async () => {};

test("someone arriving from an invitation link is told signing in takes them into the trip", () => {
  const wrapper = mount(SignIn, { props: { signIn, invited: true } });

  expect(wrapper.text()).toContain("You've been invited to a trip");
  expect(wrapper.text()).toContain("Sign in with Google");
});

test("without an invitation, the usual introduction is shown", () => {
  const wrapper = mount(SignIn, { props: { signIn } });

  expect(wrapper.text()).not.toContain("invited");
  expect(wrapper.text()).toContain("Propose restaurants");
});
