import type { PluginContext, PluginValue } from "../../../runtime/plugins/sdk.ts";
import type { Template, VariableRef, VariableKind } from "./model.ts";
import { type BundleLimits } from "./portable.ts";
export type CodeValue = PluginValue;
export type CodeContext = PluginContext;
export type CodeSchema = Record<string, unknown>;
export type CodeDefinition<TInput extends CodeValue = CodeValue, TOutput extends CodeValue = CodeValue> = {
    readonly entry: string;
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly inputSchema: CodeSchema;
    readonly outputSchema: CodeSchema;
    readonly permissions: readonly string[];
    readonly limits?: BundleLimits;
    run(input: TInput, context: CodeContext): Promise<TOutput> | TOutput;
};
export type DefineCodeOptions<TInput extends CodeValue, TOutput extends CodeValue> = Omit<CodeDefinition<TInput, TOutput>, "permissions"> & {
    permissions?: readonly string[];
};
export type CodeInput<T> = VariableRef<T> | (T extends string ? T | Template : T extends number | boolean | null ? T : T extends readonly (infer TItem)[] ? readonly CodeInput<TItem>[] : T extends Record<string, unknown> ? {
    readonly [TKey in keyof T]: CodeInput<T[TKey]>;
} : T);
export declare function assertCodeSchema(schema: CodeSchema, path: string): void;
export declare function outputKindForCode(schema: CodeSchema): VariableKind;
export declare function defineCode<TInput extends CodeValue, TOutput extends CodeValue>(options: DefineCodeOptions<TInput, TOutput>): CodeDefinition<TInput, TOutput>;
