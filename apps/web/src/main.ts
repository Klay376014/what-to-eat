import { createApp } from "vue";
import "./styles/tokens.css";
import "./styles/base.css";
import App from "./App.vue";
import { capturePendingInvite } from "./invitations/pendingInvite.ts";

// #6: keep an ?invite= link across the sign-in round trip, before anything
// else reads or rewrites the address.
capturePendingInvite();

createApp(App).mount("#app");
