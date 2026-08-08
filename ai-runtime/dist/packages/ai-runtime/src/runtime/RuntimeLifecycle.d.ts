export declare class RuntimeLifecycle {
    readonly controllers: Set<AbortController>;
    dispose(disposers: readonly (() => Promise<void>)[]): Promise<void>;
}
