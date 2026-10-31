/**
 * WeChat QR login flow + token persistence.
 * Ported from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getBotQrcode, getQrcodeStatus } from "./api.js";
function getAuthDir(storageDir) {
    return path.join(storageDir, "auth");
}
function getTokenPath(storageDir) {
    return path.join(getAuthDir(storageDir), "token.json");
}
export function loadToken(storageDir) {
    const tokenPath = getTokenPath(storageDir);
    if (!fs.existsSync(tokenPath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    }
    catch {
        return null;
    }
}
export function saveToken(storageDir, data) {
    const authDir = getAuthDir(storageDir);
    fs.mkdirSync(authDir, { recursive: true });
    const tokenPath = getTokenPath(storageDir);
    fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2), "utf-8");
}
export async function login(params) {
    const { baseUrl, botType, storageDir, log, renderQrUrl, signal } = params;
    signal?.throwIfAborted();
    log("Starting WeChat QR login...");
    const qrResp = await getBotQrcode({ baseUrl, botType, signal });
    signal?.throwIfAborted();
    const qrcodeUrl = qrResp.qrcode_img_content;
    log("Please scan the QR code with WeChat:");
    if (renderQrUrl) {
        renderQrUrl(qrcodeUrl);
    }
    else {
        log(`QR URL: ${qrcodeUrl}`);
    }
    const deadline = Date.now() + 5 * 60_000;
    let currentQrcode = qrResp.qrcode;
    let refreshCount = 0;
    while (Date.now() < deadline) {
        signal?.throwIfAborted();
        const statusResp = await getQrcodeStatus({ baseUrl, qrcode: currentQrcode, signal });
        signal?.throwIfAborted();
        switch (statusResp.status) {
            case "wait":
                break;
            case "scaned":
                log("QR scanned, please confirm in WeChat...");
                break;
            case "expired": {
                refreshCount++;
                if (refreshCount > 3) {
                    throw new Error("QR code expired multiple times, please retry");
                }
                log(`QR expired, refreshing (${refreshCount}/3)...`);
                const newQr = await getBotQrcode({ baseUrl, botType, signal });
                signal?.throwIfAborted();
                currentQrcode = newQr.qrcode;
                if (renderQrUrl) {
                    renderQrUrl(newQr.qrcode_img_content);
                }
                else {
                    log(`New QR URL: ${newQr.qrcode_img_content}`);
                }
                break;
            }
            case "confirmed": {
                log("Login successful!");
                const tokenData = {
                    token: statusResp.bot_token,
                    baseUrl: statusResp.baseurl || baseUrl,
                    accountId: statusResp.ilink_bot_id,
                    userId: statusResp.ilink_user_id,
                    savedAt: new Date().toISOString(),
                };
                signal?.throwIfAborted();
                saveToken(storageDir, tokenData);
                log(`Bot ID: ${tokenData.accountId}`);
                log(`Token saved to ${getTokenPath(storageDir)}`);
                return tokenData;
            }
        }
        await delay(1500, undefined, { signal });
    }
    throw new Error("Login timeout (5 minutes)");
}
