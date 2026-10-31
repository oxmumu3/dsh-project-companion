/**
 * Inbound adapter: convert WeChat messages to DSH content blocks.
 * Ported and adapted from wechat-opencode (MIT) —
 * https://github.com/pan17/wechat-opencode (src/adapter/inbound.ts)
 */
import type { WeixinMessage, MessageItem } from "../weixin/types.js";
export interface PromptBlock {
    type: "text";
    text: string;
}
/**
 * Detect an image file's real format from its magic bytes. WeChat image
 * media is often PNG (or WebP/GIF) while the protocol gives no extension,
 * so a fixed `.jpg` name would leave the agent with a mislabeled file.
 * Returns the extension WITHOUT the leading dot; falls back to "jpg".
 */
export declare function detectImageExtension(buffer: Buffer): string;
/**
 * Extract text body from a WeChat message's item_list.
 */
export declare function extractText(itemList?: MessageItem[]): string;
/**
 * Convert a WeChat message to prompt content blocks for a DSH session.
 *
 * The WeChat surface context is NOT injected here — it lives in a
 * global runtime context (index.ts `dsh-wechat-surface`) so
 * user-message content stays clean: the session-title generator reads the
 * user message verbatim, and a hint block would pollute session titles.
 */
export declare function weixinMessageToPrompt(msg: WeixinMessage, cdnBaseUrl: string, log: (msg: string) => void, tempDir: string): Promise<PromptBlock[]>;
//# sourceMappingURL=inbound.d.ts.map