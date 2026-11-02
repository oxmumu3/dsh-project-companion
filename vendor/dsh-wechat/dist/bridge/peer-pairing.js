/** Local authorization, never inferred from the order of incoming messages. */
const identity = value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/\s/.test(value);

export function resolvePeerPairing(token, allowedUsers, users, outbound) {
    if (!token || !identity(token.token))
        return { state: "identity-unavailable" };
    if (!Array.isArray(allowedUsers) || allowedUsers.some(id => !identity(id)))
        return { state: "allowlist-conflict" };
    const scanner = identity(token.userId) ? token.userId : null;
    // A single manually configured ID is explicit local authority for old
    // credentials. An old first-sender state record is never authority.
    const legacy = token.userId == null && allowedUsers.length === 1;
    const userId = scanner ?? (legacy ? allowedUsers[0] : null);
    if (!userId)
        return { state: "identity-unavailable" };
    if (allowedUsers.length && !allowedUsers.includes(userId))
        return { state: "allowlist-conflict" };
    if (!Array.isArray(users) || users.length > 1 || users.some(user => user.userId !== userId) || outbound && outbound.peerUserId !== userId)
        return { state: "binding-conflict" };
    return { state: "ready", userId, authority: scanner ? "qr" : "allowlist" };
}

export const PAIRING_MESSAGES = Object.freeze({
    "identity-unavailable": "无法确认微信账号。请在此页点击重新扫码，确认本人账号后继续；原有记录会保留。",
    "binding-conflict": "当前扫码账号不是原绑定账号，已暂停微信控制。请用原账号重新扫码；原有会话和待发记录仍保留。",
    "allowlist-conflict": "入站白名单与扫码账号不一致，已暂停微信控制。请在此页核对白名单设置。",
});
