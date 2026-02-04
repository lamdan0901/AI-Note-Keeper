export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory = "sync" | "reminder" | "schedule";

export interface LogEvent {
  level: LogLevel;
  category: LogCategory;
  event: string;
  ts: string;
  data?: Record<string, unknown>;
}

const levelToConsole: Record<LogLevel, "log" | "info" | "warn" | "error"> = {
  debug: "log",
  info: "info",
  warn: "warn",
  error: "error",
};

export const logEvent = (event: LogEvent): void => {
  const output = { ...event, ts: event.ts || new Date().toISOString() };
  const method = levelToConsole[event.level] || "log";
  try {
    console[method](JSON.stringify(output));
  } catch {
    console[method](output);
  }
};

export const logReminderEvent = (
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void => {
  logEvent({ level, category: "reminder", event, ts: new Date().toISOString(), data });
};

export const logSyncEvent = (
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void => {
  logEvent({ level, category: "sync", event, ts: new Date().toISOString(), data });
};

export const logScheduleEvent = (
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void => {
  logEvent({ level, category: "schedule", event, ts: new Date().toISOString(), data });
};
