import type { Key } from "node:readline";
import type { RuntimeInputField } from "../../renderer.ts";
export declare function editableTerminalValue(field: RuntimeInputField, value: unknown): string;
export declare function isTerminalSubmitKey(text: string, key: Key): boolean;
