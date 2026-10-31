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
export declare const RETRYABLE_NETWORK_ERROR_CODES: ReadonlySet<string>;
/**
 * Walk the cause chain looking for any `code` matching a known transient
 * network-failure code. Returns false for `AbortError` (the per-attempt
 * timeout sentinel), for plain non-Error values, and for any error
 * without a recognised code in its chain.
 */
export declare function isRetryableNetworkError(err: unknown): boolean;
/** A connection could not be established, so no message request was written.
 * Socket resets and generic timeouts deliberately do not qualify: the gateway
 * may already have accepted a message before the response was lost.
 */
export declare function isDefinitelyUnsentNetworkError(err: unknown): boolean;
//# sourceMappingURL=network.d.ts.map