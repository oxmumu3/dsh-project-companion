/**
 * Shared network-error utilities.
 *
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 * Centralises the transient-network-error classifier used by the WeChat
 * iLink client retry policy.
 */
/**
 * Transient-network-error codes we retry on. The classifier walks the
 * cause chain looking for any of these — undici-style names
 * (`UND_ERR_*`) and Node `errno`-style codes both appear depending on
 * the platform / Node version.
 */
export const RETRYABLE_NETWORK_ERROR_CODES = new Set([
    // undici (Node fetch's default backend in Node 18+)
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    // Node libuv errno-style codes
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
]);
/**
 * Walk the cause chain looking for any `code` matching a known transient
 * network-failure code. Returns false for `AbortError` (the per-attempt
 * timeout sentinel), for plain non-Error values, and for any error
 * without a recognised code in its chain.
 */
export function isRetryableNetworkError(err) {
    if (!err || typeof err !== "object")
        return false;
    let current = err;
    const seen = new Set();
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const obj = current;
        if (obj.name === "AbortError")
            return false;
        if (typeof obj.code === "string" && RETRYABLE_NETWORK_ERROR_CODES.has(obj.code)) {
            return true;
        }
        current = obj.cause;
    }
    return false;
}
/** A connection could not be established, so no message request was written.
 * Socket resets and generic timeouts deliberately do not qualify: the gateway
 * may already have accepted a message before the response was lost.
 */
export function isDefinitelyUnsentNetworkError(err) {
    const safe = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"]);
    let current = err;
    let found = false;
    const seen = new Set();
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const item = current;
        if (item.sendOutcome === "uncertain")
            return false;
        if (item.name === "AbortError" || ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(item.code)))
            return false;
        if (typeof item.code === "string" && safe.has(item.code))
            found = true;
        current = item.cause;
    }
    return found;
}
//# sourceMappingURL=network.js.map