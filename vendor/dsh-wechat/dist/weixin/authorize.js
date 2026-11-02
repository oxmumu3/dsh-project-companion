/** A fresh local guard runs before every transport attempt, including retries. */
export function assertAuthorized(authorize) {
    if (authorize !== undefined && authorize() !== true)
        throw Object.assign(new Error("WeChat pairing authorization changed"), { code: "PEER_AUTHORIZATION_CHANGED", definitelyUnsent: true });
}
