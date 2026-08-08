export declare function withLocalFileLock<T>(directory: string, task: () => Promise<T>): Promise<T>;
