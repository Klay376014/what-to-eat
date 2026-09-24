import { afterEach, describe, expect, test } from "vite-plus/test";
import { capturePendingInvite, clearPendingInvite, pendingInvite } from "./pendingInvite.ts";

const token = "Q2hlY2sgdGhhdCB0aGlzIGlzIDQzIGNoYXJhY3RlcnM";

function openAt(address: string) {
  window.history.replaceState(null, "", address);
}

afterEach(() => {
  clearPendingInvite();
  openAt("/");
});

describe("an invitation in the address at startup", () => {
  test("is kept for after sign-in, and taken out of the address bar", () => {
    openAt(`/?invite=${token}`);

    capturePendingInvite();

    expect(pendingInvite()).toBe(token);
    expect(window.location.search).toBe("");
    expect(window.sessionStorage.getItem("what-to-eat:pending-invite")).toBe(token);
  });

  test("leaves the rest of the address alone", () => {
    openAt(`/?day=2026-10-03&invite=${token}#top`);

    capturePendingInvite();

    expect(window.location.search).toBe("?day=2026-10-03");
    expect(window.location.hash).toBe("#top");
  });

  test("survives the sign-in round trip, which comes back to the bare address", () => {
    openAt(`/?invite=${token}`);
    capturePendingInvite();

    // The page reloads after Google: the in-memory copy is gone, the tab's
    // session storage is not.
    clearHeldCopyOnly();
    openAt("/?code=abc");
    capturePendingInvite();

    expect(pendingInvite()).toBe(token);
  });

  test("once used, is forgotten", () => {
    openAt(`/?invite=${token}`);
    capturePendingInvite();

    clearPendingInvite();

    expect(pendingInvite()).toBeNull();
  });

  test("an address with no invitation leaves nothing pending", () => {
    openAt("/?day=2026-10-03");

    capturePendingInvite();

    expect(pendingInvite()).toBeNull();
    expect(window.location.search).toBe("?day=2026-10-03");
  });
});

/** Simulates a page reload: module memory is lost, sessionStorage is kept. */
function clearHeldCopyOnly() {
  const stored = window.sessionStorage.getItem("what-to-eat:pending-invite");
  clearPendingInvite();
  if (stored) window.sessionStorage.setItem("what-to-eat:pending-invite", stored);
}
