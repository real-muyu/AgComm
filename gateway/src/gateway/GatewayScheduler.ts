// SPDX-License-Identifier: Elastic-2.0
import { type AppBackgroundConfig } from "@agcomm/ai-runtime/gateway-host";
import { nextCronOccurrence } from "../../../shared/background-schedule.ts";
import type { GatewayTrigger } from "./GatewayState.ts";

/** Pure trigger selection and next-occurrence calculations. */
export class GatewayScheduler {
  triggers(background: AppBackgroundConfig): GatewayTrigger[] { return [...(background.heartbeat ? [background.heartbeat] : []), ...(background.cron ?? [])]; }
  nextRun(trigger: GatewayTrigger, after: Date) { return "everyMs" in trigger ? new Date(after.getTime() + trigger.everyMs) : nextCronOccurrence(trigger.expression, trigger.timezone, after); }
}
