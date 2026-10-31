/**
 * Editable WeChat configuration, persisted to `~/.dsh-wechat/config.json`.
 *
 * Merge order (later wins): built-in defaults ← composition `config:` block
 * ← config.json (edited from the Settings page).
 */
import fs from "node:fs";
import path from "node:path";
import { LEGACY_SURFACE_PROMPTS } from "./config.js";
export const EDITABLE_KEYS = [
    "baseUrl",
    "cdnBaseUrl",
    "botType",
    "cwd",
    "textChunkLimit",
    "cardTimeoutMs",
    "crossSessionNotify",
    "notifyTaskEvents",
    "silent",
    "finalOnly",
    "finalOnlyIdleMs",
    "finalOnlyCeilingMs",
    "surfacePromptEnabled",
    "surfacePrompt",
    "sendWechatRateLimitPerMinute",
    "allowedUsers",
];
export class ConfigStore {
    filePath;
    overrides = {};
    constructor(storageDir) {
        this.filePath = path.join(storageDir, "config.json");
        this.overrides = this.load();
    }
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
                if (parsed && typeof parsed === "object") {
                    // A stored prompt equal to a superseded built-in default was never
                    // edited by the user: drop it so the current default applies.
                    if (typeof parsed.surfacePrompt === "string"
                        && LEGACY_SURFACE_PROMPTS.includes(parsed.surfacePrompt)) {
                        delete parsed.surfacePrompt;
                    }
                    // A hand-edited `config.json` bypasses `update()`'s guards, and the
                    // inbound allowlist is compared against every message: keeping a
                    // non-string member would make the list look non-empty (so the
                    // first-user fallback is off) while never matching anyone.
                    if (parsed.allowedUsers !== undefined) {
                        if (Array.isArray(parsed.allowedUsers)) {
                            parsed.allowedUsers = parsed.allowedUsers.filter((id) => typeof id === "string");
                        }
                        else {
                            delete parsed.allowedUsers;
                        }
                    }
                    return parsed;
                }
            }
        }
        catch {
            // fall through to defaults
        }
        return {};
    }
    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.overrides, null, 2), "utf-8");
    }
    /** Resolve the effective config: composition defaults overridden by stored values. */
    resolve(base) {
        const out = { ...base };
        for (const key of EDITABLE_KEYS) {
            const value = this.overrides[key];
            if (value !== undefined) {
                out[key] = value;
            }
        }
        return out;
    }
    /** Apply a patch and persist it. Returns the new effective overrides. */
    update(patch) {
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined)
                continue;
            if (!EDITABLE_KEYS.includes(key))
                continue;
            if ((key === "surfacePromptEnabled" || key === "silent" || key === "crossSessionNotify" || key === "notifyTaskEvents" || key === "finalOnly") && typeof value !== "boolean")
                continue;
            if ((key === "finalOnlyIdleMs" || key === "finalOnlyCeilingMs") && (typeof value !== "number" || !Number.isFinite(value) || value <= 0))
                continue;
            // 0 is meaningful here (unlimited), so the guard only rejects a value
            // that cannot describe a rate at all: non-numeric, non-finite or
            // negative. A negative limit would refuse EVERY push.
            if (key === "sendWechatRateLimitPerMinute" && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
                continue;
            // The allowlist gates inbound processing, so a malformed value must
            // not be stored: `["u1", 42]` would compare against a number forever.
            if (key === "allowedUsers" && (!Array.isArray(value) || value.some((id) => typeof id !== "string")))
                continue;
            if (key === "surfacePrompt" && typeof value !== "string")
                continue;
            this.overrides[key] = value;
        }
        this.save();
        return { ...this.overrides };
    }
    /** The raw stored overrides (for display in the settings page). */
    stored() {
        return { ...this.overrides };
    }
}
//# sourceMappingURL=config-store.js.map