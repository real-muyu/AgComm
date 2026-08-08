import type { VariableKind } from "./model-types.ts";
export type CodeSchema = Record<string, unknown>;
export declare function assertCodeSchema(schema: CodeSchema, path: string): void;
export declare function outputKindForCode(schema: CodeSchema): VariableKind;
