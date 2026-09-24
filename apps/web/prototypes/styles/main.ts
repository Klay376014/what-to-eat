/*
 * Dev-only gallery for #19 and the #7 layout study, served by `vp dev` at
 * /prototypes/styles/. `vp build` bundles only the root index.html, so none
 * of this ships. It uses the production tokens and components directly.
 */
import { createApp } from "vue";
import "../../src/styles/tokens.css";
import "../../src/styles/base.css";
import App from "./App.vue";

createApp(App).mount("#gallery");
