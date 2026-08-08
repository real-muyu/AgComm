export type PathBrowserCommand = "interrupt" | "quit" | "up" | "down" | "parent" | "open" | "new" | "ignore";
export declare function pathBrowserCommand(text: string | undefined, key: {
    name?: string;
    ctrl?: boolean;
}, writable: boolean): PathBrowserCommand;
