import { computeScheduleHash } from "../../src/reminders/scheduleHash";

describe("computeScheduleHash", () => {
  const baseInput = {
    triggerAt: 1712345678901,
    repeatRule: "none",
    active: true,
    snoozedUntil: null,
  };

  it("returns stable hashes for identical inputs", () => {
    const first = computeScheduleHash(baseInput);
    const second = computeScheduleHash({ ...baseInput });
    expect(first).toBe(second);
  });

  it("treats undefined and null snoozedUntil as equivalent", () => {
    const withNull = computeScheduleHash({ ...baseInput, snoozedUntil: null });
    const withUndefined = computeScheduleHash({
      ...baseInput,
      snoozedUntil: undefined,
    });
    expect(withNull).toBe(withUndefined);
  });

  it("changes when triggerAt changes", () => {
    const original = computeScheduleHash(baseInput);
    const updated = computeScheduleHash({ ...baseInput, triggerAt: 1712345679901 });
    expect(updated).not.toBe(original);
  });

  it("changes when repeatRule changes", () => {
    const original = computeScheduleHash(baseInput);
    const updated = computeScheduleHash({ ...baseInput, repeatRule: "daily" });
    expect(updated).not.toBe(original);
  });

  it("changes when active changes", () => {
    const original = computeScheduleHash(baseInput);
    const updated = computeScheduleHash({ ...baseInput, active: false });
    expect(updated).not.toBe(original);
  });

  it("changes when snoozedUntil changes", () => {
    const original = computeScheduleHash(baseInput);
    const updated = computeScheduleHash({ ...baseInput, snoozedUntil: 1712345679999 });
    expect(updated).not.toBe(original);
  });

  it("changes when title changes", () => {
    const original = computeScheduleHash({ ...baseInput, title: "Morning check-in" });
    const updated = computeScheduleHash({ ...baseInput, title: "Evening check-in" });
    expect(updated).not.toBe(original);
  });

  it("changes when repeatConfig changes", () => {
    const original = computeScheduleHash({
      ...baseInput,
      repeatConfig: { interval: 1, unit: "day" },
    });
    const updated = computeScheduleHash({
      ...baseInput,
      repeatConfig: { interval: 2, unit: "day" },
    });
    expect(updated).not.toBe(original);
  });

  it("treats repeatConfig key order as stable", () => {
    const first = computeScheduleHash({
      ...baseInput,
      repeatConfig: { interval: 1, unit: "day", days: ["mon", "wed"] },
    });
    const second = computeScheduleHash({
      ...baseInput,
      repeatConfig: { unit: "day", days: ["mon", "wed"], interval: 1 },
    });
    expect(first).toBe(second);
  });

  it("treats undefined and null repeatConfig as equivalent", () => {
    const withNull = computeScheduleHash({ ...baseInput, repeatConfig: null });
    const withUndefined = computeScheduleHash({
      ...baseInput,
      repeatConfig: undefined,
    });
    expect(withNull).toBe(withUndefined);
  });

  it("treats nested repeatConfig key order as stable", () => {
    const first = computeScheduleHash({
      ...baseInput,
      repeatConfig: {
        interval: 1,
        window: { start: "08:00", end: "10:00" },
        days: ["mon", "wed"],
      },
    });
    const second = computeScheduleHash({
      ...baseInput,
      repeatConfig: {
        days: ["mon", "wed"],
        window: { end: "10:00", start: "08:00" },
        interval: 1,
      },
    });
    expect(first).toBe(second);
  });

  it("changes when repeatConfig array order changes", () => {
    const original = computeScheduleHash({
      ...baseInput,
      repeatConfig: { days: ["mon", "wed", "fri"] },
    });
    const updated = computeScheduleHash({
      ...baseInput,
      repeatConfig: { days: ["fri", "wed", "mon"] },
    });
    expect(updated).not.toBe(original);
  });
});
