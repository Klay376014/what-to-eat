import { createApp } from "vue";
import "./styles/tokens.css";
import "./styles/base.css";
import App from "./App.vue";
import { captureCalendarReturn } from "./calendar/calendarConnect.ts";
import { captureMealLink } from "./grid/mealLink.ts";
import { capturePendingInvite } from "./invitations/pendingInvite.ts";

// #6: keep an ?invite= link across the sign-in round trip, before anything
// else reads or rewrites the address.
capturePendingInvite();
// #12: likewise Google's answer to connecting a calendar.
captureCalendarReturn();
// #15: an email's link straight to a meal, likewise.
captureMealLink();

createApp(App).mount("#app");
