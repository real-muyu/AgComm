export declare function sanitizeTerminalText(value: unknown, multiline?: boolean): string;
export declare function terminalWidth(value: string): number;
export declare function cropTerminalText(value: string, maximum: number): string;
export declare function padTerminalText(value: string, length: number): string;
export declare function wrapTerminalText(value: string, width: number): string[];
export declare function formatElapsed(milliseconds: number): string;
