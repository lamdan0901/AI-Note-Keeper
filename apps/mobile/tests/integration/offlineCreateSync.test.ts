import { describe, expect, it } from "@jest/globals";

describe("Offline create sync", () => {
  it.skip("syncs offline-created reminders within 5 minutes after reconnect", async () => {
    // This integration test is intentionally failing until offline create,
    // outbox sync, and reconciliation flows are implemented.
    expect(true).toBe(false);
  });
});
