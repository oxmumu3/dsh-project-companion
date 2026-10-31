/**
 * Configuration types and defaults for dsh-wechat.
 */
import path from "node:path";
import os from "node:os";
/** Default WeChat surface prompt — injected as a runtime-context snapshot. */
export const DEFAULT_SURFACE_PROMPT = "你正在通过微信(WeChat)与用户聊天。回复会发送到微信，请使用适合微信阅读的格式（支持简单的 Markdown、适度使用 emoji、避免过长的表格）。";
/**
 * Superseded built-in prompts. `surfacePrompt` is persisted verbatim once the
 * settings page is saved, so a stored value equal to one of these is an
 * untouched default rather than a user customization: it is dropped on load so
 * the current {@link DEFAULT_SURFACE_PROMPT} applies. Genuinely edited prompts
 * never match and are always preserved.
 */
export const LEGACY_SURFACE_PROMPTS = [
    "你正在通过微信(WeChat)与用户聊天。回复会发送到微信，请使用适合微信阅读的格式（纯文本、适度使用 emoji、避免过长的表格）。",
];
export function defaultStorageDir() {
    return path.join(os.homedir(), ".dsh-wechat");
}
export function defaultConfig() {
    return {
        baseUrl: "https://ilinkai.weixin.qq.com",
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        botType: "3",
        storageDir: defaultStorageDir(),
        cwd: process.cwd(),
        textChunkLimit: 4000,
        cardTimeoutMs: 30 * 60_000,
        crossSessionNotify: false,
        notifyTaskEvents: false,
        silent: false,
        finalOnly: false,
        finalOnlyIdleMs: 45_000,
        finalOnlyCeilingMs: 10 * 60_000,
        surfacePromptEnabled: false,
        surfacePrompt: DEFAULT_SURFACE_PROMPT,
        sendWechatRateLimitPerMinute: 10,
        allowedUsers: [],
    };
}
//# sourceMappingURL=config.js.map