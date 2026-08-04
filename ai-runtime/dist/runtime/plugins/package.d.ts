import type { Plugin } from "../../domain/flow/types.ts";
export declare class PluginPackageError extends Error {
    constructor(message: string);
}
export declare function validatePlugin(plugin: Plugin): Plugin;
export declare function pluginPackageFiles(plugin: Plugin): {
    "agent-plugin.json": string;
    "package.json": string;
    "tsconfig.json": string;
    "src/index.ts": string;
    "dist/index.js": string;
    "README.md": string;
};
export declare function parsePluginPackageFiles(input: Record<string, string>): Plugin;
export declare function importPluginPackage(buffer: ArrayBuffer): Promise<Plugin>;
export declare function createPluginPackage(plugin: Plugin): Blob;
export declare function finalizePlugin(plugin: Plugin): Promise<Plugin>;
export declare function createPluginScaffold(id?: string, name?: string): Plugin;
