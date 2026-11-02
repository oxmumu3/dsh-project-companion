# QR-owner WeChat pairing

Approved direction: the user chose the best user experience and explicitly requested implementation on 2026-11-02. Normal use remains scan, confirm on the phone, and start talking. No technical ID entry is required.

The iLink QR response identifies the scanning user as `ilink_user_id` (Tencent/openclaw-weixin official protocol, read 2026-11-02). Use the stored QR identity as the single operator before receiving any message. An explicitly configured allowlist further restricts that identity; it never adds an operator. For legacy credentials without a QR identity, a single deliberately configured allowlist entry can supply the authority. A saved first sender alone is not authority.

Missing identity, conflicting saved identity, multiple saved users or an incompatible allowlist deny inbound commands, agent turns, replies, queue flushes and proactive sends. Show a fixed actionable pairing message in existing connection settings, with the existing re-login action. Do not delete state, edit allowlists, switch recipients, mint sessions or send a pairing message during migration. A matching old binding, session, queue and configuration remain intact.

Implement only in the embedded bridge and its setup projection. Keep external standalone bridges and Family routes independent. No production source reads, test messages, automatic re-login or daily installation are part of verification. Public and private Dot branches remain separate; never replace private .21.7 with the older public runtime.

Verify scanner-first pairing, an attacker arriving first, absent identity, explicit legacy authority, conflicts, restart continuity, revocation and file-read/config races before any network send. Verify exact final supported SDKs and official isolated Host lifecycle before public distribution. Preserve natural monitoring and observe its next existing run after 19:02Z.
