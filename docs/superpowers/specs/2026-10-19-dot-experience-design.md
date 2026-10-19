# Dot experience and reversible appearance

User-approved direction: advance the desktop workbench and global appearance while the user rests; keep real WeChat receipt and account authorization for the user. Build on 0.7 without changing binding, schedules, model selection or external credentials.

## Workbench

Present the selected project's goal, recent observed information, recorded blockers and suggested next steps before raw files. Use existing structured project memory and source-labelled observations. Do not generate inferred status, fabricate next steps, or treat assistant notes as verified completion. Move original files and older conversation records into expandable detail. Show meaningful known session titles when available and preserve explicit selection for multiple sessions.

Project-memory inspection must be genuinely read-only: no DB creation, migrations, metadata writes, model calls or session restoration. Missing memory is empty; rejected or failed reads are unavailable. Only watched canonical roots are permitted, with the existing ownership and symlink protections.

## Appearance

Create one coherent Dot visual direction: warm paper-like light surfaces, quiet ink text, restrained DeepSeek blue, rounded but compact controls; paired dark surfaces with matching hierarchy. Use system fonts with good Chinese fallbacks. No external fonts, assets, tracking or large dependencies.

Use the public theme token override API with light/dark pairs; apply to token consumers only. Keep the operating-system light/dark preference. Do not mutate persistent global font settings or unrelated preferences. Own page typography can be styled directly. Global font override is allowed only if its token and override order are verified and revocable.

Expose native/Dot appearance selection through the existing plugin's ConfigForm with an explicit normal non-secret config field. The default remains native for existing installs until the user or authorized local test explicitly chooses Dot. The theme adapter must fail independently and leave the workbench functional when the theme API is unavailable. Disabling/disposing restores prior token layers. No root/sidebar/composer replacement, no internal DOM selectors.

## Evidence

Run targeted meaningful regressions, two complete SDK matrices, independent spec and code review, package audit and official local upgrade. Verify actual desktop overview, configuration toggle, native restoration and final Dot appearance. Compare state/ledger/binding fingerprints and installed runtime. Save real before/after JPEGs with correct media type. Do not publish articles or claim phone acceptance.

## Concrete visual constraints

Direction: calm editorial workspace, warm paper with DeepSeek blue actions.
Canvas: light #f5f3ee, dark #17191c; no gradients or external assets.
Palette: ink #222b35 / #e7ebf0; blue #4176e6 / #7aaaff, fine neutral borders.
Typography: system sans with Chinese fallbacks, compact body, clear 28/19/13px hierarchy on Dot page.
Layout: project rail + readable main column; recorded goal first, blockers and next steps side by side, raw sources in disclosure.
Motion: no new animation. Avoid nested cards, loud badges or fabricated summaries.
