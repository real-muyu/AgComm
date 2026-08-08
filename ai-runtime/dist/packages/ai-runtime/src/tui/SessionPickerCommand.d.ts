export type SessionPickerCommand = "quit" | "up" | "down" | "open" | "rename" | "delete" | "ignore";
export declare function sessionPickerCommand(text: string | undefined, key: {
    name?: string;
    ctrl?: boolean;
}): SessionPickerCommand;
