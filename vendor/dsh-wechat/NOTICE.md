# DSH Dot local maintenance fork

This is a locally maintained adaptation of pan17/dsh-wechat 0.11.0, not an official upstream release. The original MIT license and contributor copyright remain unchanged in LICENSE.

Upstream: https://github.com/pan17/dsh-wechat
Base tag: v0.11.0, commit 218537511681be7557589f5ae0eab84f80267dc8.
Original npm archive SHA256: 993e1e1afce3c0dcd2610bf9e84ffbfd6d08768f5c4b4fa30eeec50dc2e97d3f.

Maintenance for DSH Dot by 牛村木木山: conservative known-unsent queue retry, timeout and receipt correctness, queue budget preservation, redacted diagnostics and transport-only recovery admission. These changes do not imply upstream endorsement or guarantee phone delivery.

Local maintenance version: 0.11.1-dot.2. Empty-queue transport recovery is consumed before agent enqueue and receives one awaited bridge acknowledgement, guarded against unload, binding, live-agent, token and queue changes at dispatch. Nonempty flush status remains owned by the existing bridge path.

Embedded Dot adaptation 0.11.1-dot.3-embedded.1: QR login requests and polling accept a lifecycle abort signal. Disposing or replacing a login cancels it and prevents stale token writes. Transport, source permissions and ordinary delivery rules are unchanged. Exact base archive and local delta are recorded in bridge-maintenance/EMBEDDED.json of the containing Dot package.
