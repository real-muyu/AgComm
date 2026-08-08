import type { AppBuilderContext, AppDefinition, DefineAppOptions, PreparedApp } from "./model-types.ts";
export declare function defineApp(options: DefineAppOptions, build: (context: AppBuilderContext) => void): AppDefinition;
export declare function preparedApp(app: AppDefinition): PreparedApp;
