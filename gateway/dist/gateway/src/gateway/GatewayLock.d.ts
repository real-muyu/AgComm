/** Process ownership lock with liveness-based stale-lock recovery. */
export declare class GatewayLock {
    private readonly root;
    private readonly now;
    private owner?;
    constructor(root: string, now: () => Date);
    acquire(): Promise<void>;
    release(): Promise<void>;
}
