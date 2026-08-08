export type PathBrowserItem = {
    name: string;
    isDirectory(): boolean;
};
export declare class PathBrowserState {
    private readonly extensions;
    directory: string;
    selected: number;
    items: PathBrowserItem[];
    constructor(initialDirectory: string, extensions: ReadonlySet<string>);
    refresh(): Promise<void>;
    move(offset: -1 | 1): void;
    parent(): void;
    open(): string | undefined;
    rows(): string[];
}
