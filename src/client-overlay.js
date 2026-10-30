/**
 * Pure client factories. The client entry embeds these definitions verbatim in
 * its official single-file ModuleLoader factory; do not add module-scope deps.
 */
export function createDotOverlay(React, adapters = {}) {
  const h = React.createElement;
  const css = `
.dot_overlay{font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);color:var(--dsw-alias-label-primary,#222b35)}
.dot_overlay_dock{position:absolute;right:max(20px,env(safe-area-inset-right,0px));bottom:max(28px,calc(env(safe-area-inset-bottom,0px) + 24px));display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}
.dot_overlay button{font:inherit;cursor:pointer;color:inherit}.dot_overlay button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:3px}
.dot_overlay_launcher{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:9px 15px;border:1px solid var(--dsw-alias-border-l3,rgba(44,55,68,.12));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fffdf8);box-shadow:0 5px 24px rgba(22,34,48,.14);font-size:14px!important;font-weight:600!important}
.dot_overlay_mark{display:inline-flex;color:var(--dsw-alias-state-business-primary,#4176e6)}
.dot_overlay_panel{pointer-events:auto;display:flex;flex-direction:column;width:min(420px,calc(100vw - 32px));height:min(620px,calc(100vh - var(--dsh-frame-overlay-top,68px) - 104px));height:min(620px,calc(100dvh - var(--dsh-frame-overlay-top,68px) - 104px));max-height:100%;border:1px solid var(--dsw-alias-border-l3,rgba(44,55,68,.12));border-radius:18px;background:var(--dsw-alias-bg-layer-2,#fffdf8);box-shadow:0 12px 48px rgba(22,34,48,.18);overflow:hidden}
.dot_overlay_header{display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l4,rgba(44,55,68,.08));flex-shrink:0}
.dot_overlay_heading{min-width:0;flex:1}.dot_overlay_title{font-size:15px;font-weight:650}.dot_overlay_subtitle{font-size:11px;color:var(--dsw-alias-label-secondary,#5c6672);margin-top:2px}
.dot_overlay_action{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border:0;border-radius:8px;background:transparent}.dot_overlay_action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(48,63,79,.06))}
.dot_overlay_body{position:relative;display:flex;flex:1;min-height:0;overflow:hidden}.dot_overlay_body> *{flex:1;min-height:0;min-width:0}
.dot_overlay_fallback{padding:20px;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary,#5c6672)}
.dot_overlay_notice{pointer-events:auto;max-width:min(320px,calc(100vw - 40px));padding:10px 14px;border:1px solid var(--dsw-alias-border-l3,rgba(44,55,68,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fffdf8);font-size:12px;line-height:1.5;box-shadow:0 4px 20px rgba(22,34,48,.1)}
@media(max-width:560px){.dot_overlay_dock{right:max(12px,env(safe-area-inset-right,0px));bottom:max(18px,calc(env(safe-area-inset-bottom,0px) + 14px))}.dot_overlay_panel{width:calc(100vw - 24px);height:calc(100dvh - var(--dsh-frame-overlay-top,68px) - 88px);border-radius:14px}.dot_overlay_subtitle{display:none}}
@media(max-height:440px){.dot_overlay_dock{bottom:max(8px,env(safe-area-inset-bottom,0px));gap:6px}.dot_overlay_panel{height:calc(100dvh - var(--dsh-frame-overlay-top,68px) - 66px)}.dot_overlay_header{padding:7px 12px}.dot_overlay_launcher{min-height:36px;padding:5px 13px}}
`;
  const mark = () => h('span', { className: 'dot_overlay_mark', 'aria-hidden': true },
    h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
      h('circle', { cx: 12, cy: 12, r: 8, stroke: 'currentColor', strokeWidth: 1.7 }),
      h('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor' }),
      h('path', { d: 'M17.7 3.6l2.7 2.7', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' })));
  const icon = kind => h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true },
    h('path', { d: kind === 'close' ? 'M5 5l10 10M15 5L5 15' : 'M11 4h5v5M16 4l-7 7M7 4H4v12h12v-3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  return function DotOverlay(props = {}) {
    const [open, setOpen] = React.useState(false);
    const [error, setError] = React.useState('');
    const launcher = React.useRef(null);
    const panel = React.useRef(null);
    const pendingWorkbench = React.useRef(false);
    const returnFocus = React.useRef(false);
    const live = React.useRef(true);
    React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    React.useEffect(() => {
      if (open) { panel.current?.focus?.(); return; }
      if (pendingWorkbench.current) {
        pendingWorkbench.current = false;
        returnFocus.current = false;
        // Child Conversation effects have unmounted before this passive effect.
        // Reuse the normal workbench action, rather than mount another editor.
        Promise.resolve().then(() => {
          if (!live.current) return;
          if (typeof adapters.activateDesktop !== 'function') throw new Error('workbench unavailable');
          return adapters.activateDesktop();
        }).catch(() => {
          if (live.current) setError('工作台暂未打开，请从左侧 DSH Dot 继续。');
        });
      } else if (returnFocus.current) {
        returnFocus.current = false;
        if (launcher.current?.isConnected !== false) launcher.current?.focus?.();
      }
    }, [open]);
    const close = () => { returnFocus.current = true; setOpen(false); };
    const openWorkbench = () => { pendingWorkbench.current = true; setError(''); setOpen(false); };
    const escape = event => {
      if (!open || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault?.(); event.stopPropagation?.(); close();
    };
    const content = open
      ? typeof adapters.renderConversation === 'function'
        ? adapters.renderConversation({ ...props, location: 'overlay', onOpenWorkbench: openWorkbench })
        : h('div', { className: 'dot_overlay_fallback' }, '请打开完整工作台，与 Dot 继续对话。')
      : null;
    return h('div', { className: 'dot_overlay', style: { position: 'absolute', inset: 0, pointerEvents: 'none' }, 'data-dot-overlay': true },
      h('style', null, css),
      h('div', { className: 'dot_overlay_dock' },
        error && h('div', { className: 'dot_overlay_notice', role: 'status' }, error),
        open && h('section', { className: 'dot_overlay_panel', id: 'dsh-dot-overlay-dialog', ref: panel, tabIndex: -1, role: 'dialog', 'aria-label': '与 Dot 对话', onKeyDown: escape },
          h('header', { className: 'dot_overlay_header' }, mark(),
            h('div', { className: 'dot_overlay_heading' }, h('div', { className: 'dot_overlay_title' }, 'Dot'), h('div', { className: 'dot_overlay_subtitle' }, '你的一句交代，我接着跟进。')),
            h('button', { className: 'dot_overlay_action', type: 'button', 'aria-label': '打开完整工作台', title: '打开完整工作台', onClick: openWorkbench }, icon('expand')),
            h('button', { className: 'dot_overlay_action', type: 'button', 'aria-label': '收起 Dot 对话', title: '收起', onClick: close }, icon('close'))),
          h('div', { className: 'dot_overlay_body' }, content)),
        h('button', { className: 'dot_overlay_launcher', type: 'button', ref: launcher, 'aria-label': open ? '收起 Dot 对话' : '打开 Dot 对话', 'aria-expanded': open, 'aria-controls': open ? 'dsh-dot-overlay-dialog' : undefined, onKeyDown: escape,
          onClick: () => { setError(''); if (open) close(); else setOpen(true); } }, mark(), h('span', null, 'Dot'))));
  };
}

export function registerDotOverlay(ctx, Component) {
  if (typeof ctx?.effect !== 'function' || typeof ctx?.slots?.inject !== 'function' || typeof ctx?.slots?.register !== 'function') return false;
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-dot-launcher', order: 30,
    children: { 'dot.overlay.conversation': { kind: 'single', scope: 'session' } },
  }, Component)));
  return true;
}
