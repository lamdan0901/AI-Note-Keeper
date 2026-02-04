import { describe, expect, it } from "@jest/globals";

describe("Offline delete sync", () => {
  it.skip("syncs offline-deleted reminders within 5 minutes after reconnect", async () => {
    // This integration test is intentionally failing until offline delete,
    // outbox sync, and reconciliation flows are implemented.
    expect(true).toBe(false);
  });
});
