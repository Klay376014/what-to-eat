import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    // Component tests mount into a DOM; pure-module tests do not mind one.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
