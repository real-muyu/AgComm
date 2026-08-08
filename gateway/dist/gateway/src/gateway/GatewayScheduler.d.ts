import { type AppBackgroundConfig } from "@agcomm/ai-runtime/gateway-host";
import type { GatewayTrigger } from "./GatewayState.ts";
/** Pure trigger selection and next-occurrence calculations. */
export declare class GatewayScheduler {
    triggers(background: AppBackgroundConfig): GatewayTrigger[];
    nextRun(trigger: GatewayTrigger, after: Date): Date;
}
