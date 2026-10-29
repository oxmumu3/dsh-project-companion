# Third-party components and acknowledgements

DSH Project Companion / DeepSeek专属Dot is a community project by 牛村木木山. It is not an official DeepSeek or upstream-author product. Our own MIT LICENSE does not replace the notices below.

## pan17/dsh-wechat — separate runtime plugin

- Upstream: https://github.com/pan17/dsh-wechat
- Original npm release: 0.11.0, independently pinned by SHA256 `993e1e1afce3c0dcd2610bf9e84ffbfd6d08768f5c4b4fa30eeec50dc2e97d3f`.
- DSH Dot maintenance release: 0.11.1-dot.2, based on upstream source tag v0.11.0 at `218537511681be7637589f5ae0eab84f80267dc8`; locally reviewed source commit `19c3f40c85bcdd49525a09d07007978e61521f83`. This is a local maintained fork, not an upstream publication or endorsement.
- Copyright (c) 2026 dsh-wechat contributors. MIT; full text: `third-party-licenses/pan17-dsh-wechat.txt`.
- Reuse: separately installed WeChat login, message transport, approvals and session integration. Companion invokes its registered `send_wechat` tool, public local binding status and the maintenance version's synchronous transport-recovery admission hook. We do not claim original authorship of this transport.
- Maintenance by DSH Dot / 牛村木木山: conservative known-unsent queue retry, preserved message budgets, timeout/receipt correctness, redacted diagnostics and pre-enqueue transport-only recovery. Original LICENSE bytes and contributor copyright remain unchanged. The source delta, exact archive/source hashes, tests and rebuild instructions are shipped in `bridge-maintenance/`; the complete bridge runtime is a separate pinned package in the installer kit. Phone delivery is not inferred from a send wrapper or local tests.

## hanshanyike/dsh-yolo — selected library modules

- Upstream: https://github.com/hanshanyike/dsh-yolo
- Version 0.5.0; pinned commit: `c87d70105f975d86c5c0f98f34fbce66657a6934`.
- Copyright (c) 2026 dsh-plugin-yolo contributors. MIT; full text: `third-party-licenses/dsh-yolo.txt` and `vendor/yolo/LICENSE`.
- Selected files, original/generated SHA256 and reproducible type-stripping details: `vendor/yolo/SOURCE.json`.
- Reuse: SQLite schema, transactions, event repository and project scope identity. Our adapter stores bounded, source-labelled project context notes; it does not create an alternative formal task system.
- Adaptation: upstream TypeScript types removed and relative import suffixes changed to JavaScript; runtime logic otherwise retained. Our new adapter authorizes currently watched roots and opens only its own database in each selected project.
- Not loaded: upstream global service/catalog, all-session observers, automatic extraction, reminder engine or UI. Attention source is retained in the selected library set but is not currently used for ranking; we do not claim that capability.

## john-walks-slow/dsh-proactive — selected host scheduling library

- Upstream: https://github.com/john-walks-slow/dsh-proactive
- Version 0.3.1; associated research commit: `7a959839f6486aa521e6024a67425b33f098aa0b`.
- Copyright (c) 2026 dsh-proactive contributors. MIT; full text: `third-party-licenses/dsh-proactive.txt` and `vendor/proactive/LICENSE`.
- Runtime starts from the integrity-verified npm 0.3.1 distribution, independently pinned by tar integrity and original per-file hashes in `vendor/proactive/SOURCE.json`. The scheduler has one DSH Dot maintenance patch, recorded separately with original and patched hashes in that manifest and `vendor/proactive/PATCHES.md`. The npm archive is not claimed byte-equivalent to an unavailable gitHead mapping.
- Reuse: ProactiveStore, ProactiveScheduler, WakeDriver, alarm validation and their dependency closure. All selected runtime files except the explicitly recorded scheduler patch preserve their upstream bytes.
- Adaptation: our adapter provides an explicit project-local data directory, exact original-session target, current watched-root checks, binding checks, pause/cancel gates and a read-only tool policy for autonomous wakes. No upstream global tool/panel/settings registration, dynamic workspace target or default schedule is enabled.
- This package's tested SDK range describes the composed adapter. It does not alter or claim that the upstream plugin's peer range accepts SDK0.2.1.

## Distribution

Retain these notices and the full corresponding licenses when redistributing these vendored files. If shipping the separate WeChat plugin as part of an installer, retain that plugin's own copyright and license as well. Improvements may be contributed upstream without implying that upstream authors endorse this project.


## Public RSS source facts — AI Daily Digest provenance

- `assets/news-feeds.json` records 92 public feed/homepage URL facts matching `vigorX777/ai-daily-digest` at commit `1f484a3f2f101cb0f1a94a35b1a1befe0f672b82` and the user's prior source pool. See `docs/news-feed-provenance.md` for exact source links and verification.
- Upstream has no LICENSE file at that snapshot. We do not claim its code is MIT and do not redistribute its parser, ranking, summary, configuration or provider pipeline. Our bounded transport/parser/model/service implementation is independent.
- Publisher articles and RSS content remain their respective authors' material. They are fetched at runtime for bounded summaries and links, never bundled as an article archive. This project's MIT license does not license third-party articles or imply endorsement.
