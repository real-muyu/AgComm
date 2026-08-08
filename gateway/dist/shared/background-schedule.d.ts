export type ParsedCron = {
    minute: ReadonlySet<number>;
    hour: ReadonlySet<number>;
    dayOfMonth: ReadonlySet<number>;
    month: ReadonlySet<number>;
    dayOfWeek: ReadonlySet<number>;
    anyDayOfMonth: boolean;
    anyDayOfWeek: boolean;
};
export declare function parseCronExpression(expression: string): ParsedCron;
export declare function assertTimeZone(timezone: string): void;
export declare function cronMatches(parsed: ParsedCron, date: Date, timezone: string): boolean;
export declare function nextCronOccurrence(expression: string | ParsedCron, timezone: string, after: Date, limitMinutes?: number): Date;
