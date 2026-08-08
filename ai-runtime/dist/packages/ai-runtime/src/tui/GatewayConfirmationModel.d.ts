import type { AiAppInfo } from "../runtime-types.ts";
export declare function gatewayConfirmationLines(info: AiAppInfo): string[];
export declare function gatewayConfirmationCommand(text: string | undefined, key: {
    name?: string;
    ctrl?: boolean;
}): "accept" | "ignore" | "interrupt" | "reject";
