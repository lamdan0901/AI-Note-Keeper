/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as functions__generated_api from "../functions/_generated/api.js";
import type * as functions__generated_server from "../functions/_generated/server.js";
import type * as functions_deviceTokens from "../functions/deviceTokens.js";
import type * as functions_notes from "../functions/notes.js";
import type * as functions_push from "../functions/push.js";
import type * as functions_reminderChangeEvents from "../functions/reminderChangeEvents.js";
import type * as functions_reminderTriggers from "../functions/reminderTriggers.js";
import type * as functions_reminders from "../functions/reminders.js";
import type * as utils_uuid from "../utils/uuid.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "functions/_generated/api": typeof functions__generated_api;
  "functions/_generated/server": typeof functions__generated_server;
  "functions/deviceTokens": typeof functions_deviceTokens;
  "functions/notes": typeof functions_notes;
  "functions/push": typeof functions_push;
  "functions/reminderChangeEvents": typeof functions_reminderChangeEvents;
  "functions/reminderTriggers": typeof functions_reminderTriggers;
  "functions/reminders": typeof functions_reminders;
  "utils/uuid": typeof utils_uuid;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
