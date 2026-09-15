/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as actions from "../actions.js";
import type * as auditLogs from "../auditLogs.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as customBuilders from "../customBuilders.js";
import type * as families from "../families.js";
import type * as http from "../http.js";
import type * as onboarding from "../onboarding.js";
import type * as records from "../records.js";
import type * as recovery from "../recovery.js";
import type * as rls from "../rls.js";
import type * as users from "../users.js";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  auditLogs: typeof auditLogs;
  contacts: typeof contacts;
  crons: typeof crons;
  customBuilders: typeof customBuilders;
  families: typeof families;
  http: typeof http;
  onboarding: typeof onboarding;
  records: typeof records;
  recovery: typeof recovery;
  rls: typeof rls;
  users: typeof users;
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

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
