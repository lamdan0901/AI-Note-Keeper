import { sha256 } from "js-sha256";
import type { Reminder } from "../types/reminder";

export const calculatePayloadHash = (reminder: Reminder): string => {
  // Extract stable fields for synchronization
  // We use a canonical order to ensure consistent hashing
  const payload = {
    active: reminder.active,
    id: reminder.id,
    repeatConfig: reminder.repeatConfig,
    repeatRule: reminder.repeatRule,
    snoozedUntil: reminder.snoozedUntil,
    timezone: reminder.timezone,
    triggerAt: reminder.triggerAt,
    updatedAt: reminder.updatedAt,
    userId: reminder.userId,
  };

  // Create a stable string representation
  // We explicitly order keys in the object construction above, 
  // but JSON.stringify might not respect it depending on engine (though typically does).
  // To be absolutely safe, we can stringify manually or rely on the fact that 
  // we constructed it with sorted keys and V8/modern JS preserves insertion order for non-integer keys.
  
  return sha256(JSON.stringify(payload));
};
