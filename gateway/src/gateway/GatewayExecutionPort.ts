// SPDX-License-Identifier: Elastic-2.0
import type { GatewayAppSummary, GatewayRunRecord, PendingRun } from "./GatewayState.ts";

/** Mutable execution state owned outside the Gateway facade. */
export interface GatewayExecutionPort {
  readonly active: Map<string, AbortController>;
  readonly activeRunIds: Map<string, string>;
  readonly pending: Map<string, Map<string, PendingRun>>;
  activeFor(app: GatewayAppSummary): boolean;
  queue(app: GatewayAppSummary, pending: PendingRun): PendingRun | undefined;
  release(record: GatewayRunRecord): void;
  next(appId: string): PendingRun | undefined;
}
