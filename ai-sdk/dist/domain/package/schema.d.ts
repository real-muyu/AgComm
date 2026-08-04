export declare const CURRENT_AI_FORMAT_VERSION: 2;
export type AiPackageIssue = {
    code: string;
    path: string;
    message: string;
    jsonPointer?: string;
};
export declare class AiPackageValidationError extends Error {
    readonly code: string;
    readonly phase: "version" | "parse" | "validate" | "migrate" | "normalize";
    readonly issues: AiPackageIssue[];
    constructor(code: string, phase: AiPackageValidationError["phase"], message: string, issues?: AiPackageIssue[]);
}
type StandaloneValidationError = {
    keyword: string;
    instancePath: string;
    message?: string;
};
type StandaloneValidator = ((value: unknown) => boolean) & {
    errors?: StandaloneValidationError[] | null;
};
export declare function assertSchema(validator: StandaloneValidator, value: unknown, path: string): void;
export declare function validateLegacyProject(value: unknown): void;
export declare function validateManifest(value: unknown, version: 1 | 2): void;
export declare function validateFlowDocument(value: unknown): void;
export declare function validateNodeDocument(value: unknown, path: string): void;
export declare function validateSkillDocument(value: unknown, path: string, version: 1 | 2): void;
export declare function validatePluginDocument(value: unknown, path: string): void;
export {};
