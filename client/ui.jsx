/** Shared feedback layer: one toast for every page, optional undo. */
export function createUi(React) {
  const h = React.createElement;
  function Toast({message, actionLabel, onAction, onClose}) {
    React.useEffect(() => {
      if (!message) return undefined;
      const timer = setTimeout(() => onClose?.(), 6000);
      return () => clearTimeout(timer);
    }, [message]);
    if (!message) return null;
    return h('div', {className: 'dotv2-toast', role: 'status'},
      h('span', null, message),
      actionLabel ? h('button', {type: 'button', onClick: onAction}, actionLabel) : null,
      h('button', {type: 'button', onClick: onClose, 'aria-label': '关闭'}, '×'));
  }
  function injectStyles(doc, css) {
    if (!doc?.head || typeof css !== 'string' || !css) return;
    if (doc.head.querySelector('style[data-dot-v2]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-dot-v2', '');
    style.textContent = css;
    doc.head.appendChild(style);
  }
  return {Toast, injectStyles};
}
