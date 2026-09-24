/*
 * Dev-only style gallery for #19. Served by `vp dev` at /prototypes/styles/;
 * `vp build` only bundles the root index.html, so none of this ships.
 */
import { createApp } from "vue";
import App from "./App.vue";
import "./gallery.css";

createApp(App).mount("#gallery");
