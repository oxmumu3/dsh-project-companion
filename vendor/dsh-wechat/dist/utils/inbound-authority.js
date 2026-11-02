import { AsyncLocalStorage } from "node:async_hooks";

// Each incoming message retains its original local grant across nested async
// commands and session resolution. Re-granting cannot revive an older message.
const admissions = new AsyncLocalStorage();
export function assertInboundAuthority() {
    const current = admissions.getStore();
    if (current && current() !== true)
        throw Object.assign(new Error("WeChat pairing authorization changed"), { code: "PEER_AUTHORIZATION_CHANGED" });
}
export function withInboundAuthority(current, operation) {
    return admissions.run(current, () => {
        assertInboundAuthority();
        return operation();
    });
}
export async function awaitInbound(pending) {
    try {
        const result = await pending;
        assertInboundAuthority();
        return result;
    }
    catch (error) {
        assertInboundAuthority();
        throw error;
    }
}
