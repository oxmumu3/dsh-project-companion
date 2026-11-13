/** The right-hand conversation rail (DESIGN.md 2.2 conversation, 3.5).
 *
 * The rail itself is only a frame: the host's native conversation is passed in
 * as children so approval, attachments and tool results render natively. When
 * the native view cannot mount, the same frame shows the retained text and a
 * copy action instead of pretending a message was delivered.
 */
import {zh} from './strings.zh.js';

export function createDockView(React) {
  const h = React.createElement;

  function Dock({open, target, onClose, onExpand, problem, children, retainedText, onCopyRetained, onClearRetained}) {
    if (!open) return null;
    return h('aside', {className: 'dotv2-dock', 'data-dot-dock': true, 'aria-label': zh.today.dock.title},
      h('header', {className: 'dotv2-dock__head'},
        h('span', null, zh.today.dock.title),
        onExpand ? h('button', {type: 'button', className: 'dotv2-dock__link', onClick: onExpand}, '展开') : null,
        h('button', {type: 'button', className: 'dotv2-dock__close', 'aria-label': '收起对话', onClick: onClose}, '×')),
      h('div', {className: 'dotv2-dock__body'},
        problem ? h('p', {className: 'dotv2-dock__problem', role: 'status'}, problem) : null,
        children ?? h('p', {className: 'dotv2-dock__empty'}, zh.today.dock.empty)),
      retainedText ? h('div', {className: 'dotv2-dock__retained', 'data-dot-retained': true},
        h('strong', null, '这句话还在这里'),
        h('pre', null, retainedText),
        h('button', {type: 'button', onClick: onCopyRetained}, '复制'),
        onClearRetained ? h('button', {type: 'button', onClick: onClearRetained}, '知道了') : null) : null,
      target ? h('footer', {className: 'dotv2-dock__foot'}, '原生对话：审批、附件和工具结果都在这里；回车由你发送。') : null);
  }

  return {Dock};
}
