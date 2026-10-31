/** Private durable at-most-once admission. No message bodies or credentials are saved. */
export declare class GuardedOutbox {
    private readonly file;
    private state;
    private chain;
    private lock;
    private closed;
    constructor(directory: string);
    private save;
    binding(identity: string): string;
    rotate(): void;
    close(): void;
    send(input: {
        requestId: string;
        expectedBinding: string;
        identity: string;
        payloadHash?: string;
        authorize: () => boolean;
        current?: () => boolean;
        deliver: () => Promise<void>;
    }): Promise<'accepted' | 'uncertain' | 'blocked'>;
}
//# sourceMappingURL=dot-guarded-outbox.d.ts.map