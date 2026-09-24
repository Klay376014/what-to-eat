import { enableAutoUnmount } from "@vue/test-utils";
import { afterEach } from "vite-plus/test";

// Tests mount into document.body; take each one down before the next starts.
enableAutoUnmount(afterEach);
