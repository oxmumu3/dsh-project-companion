/** Global floating Today entry (DESIGN.md 2.2 floating entry).
 *
 * Presentation only: the data, the say/item calls and the decision about
 * whether this host page is Dot itself live in the client app. The launcher
 * never opens itself; new work only changes its dot and label.
 */
import {zh} from './strings.zh.js';
import {afterOverlaySay} from './overlay-state.js';

const DOT_CLASS = {needs_you: 'wait', wait: 'wait', stuck: 'stuck', doing: 'run', run: 'run', done: 'done', quiet: 'quiet', unknown: 'none'};

export function createTodayOverlay(React) {
  const h = React.createElement;

  function TodayOverlay({model, open, onToggle, onAct, onSay, onOpenToday, onExpand, sessionLine, pending, ack, error}) {
    const [text, setText] = React.useState('');
    const first = model?.needCards?.[0] ?? model?.needRows?.[0] ?? null;
    const worst = model?.urgent?.[0] ?? model?.dots?.find(row => row.state !== 'quiet') ?? null;
    const dotState = model?.blind ? 'none' : worst?.state ?? (model?.counts?.done ? 'done' : 'quiet');
    const label = model?.blind ? '看不到状态'
      : model?.counts?.wait ? `${model.counts.wait} 件等你`
        : model?.counts?.stuck ? `${model.counts.stuck} 件卡住`
          : model?.counts?.run ? '正在做'
            : model?.counts?.done ? '做完了' : '';
    const submit = async event => {
      event.preventDefault();
      const value = text.trim();
      if (!value) return;
      let result = null;
      try { result = await onSay?.(value); } catch { result = {delivered: false}; }
      // Only clear the overlay input when the words actually went somewhere we
      // can point at (session or the retained draft in the right rail). On a
      // plain failure the original text stays in the input.
      setText(afterOverlaySay(value, result));
    };
    return h('div', {className: 'dotv2-overlay', 'data-today-overlay': true},
      open ? h('section', {className: 'dotv2-overlay__panel', role: 'dialog', 'aria-label': zh.today.float.title},
        h('p', {className: 'dotv2-overlay__line'}, model?.headline?.text ?? zh.today.headlineBlind),
        first ? h('div', {className: 'dotv2-overlay__top'},
          h('b', null, first.title),
          first.what ? h('p', null, first.what) : null,
          h('div', {className: 'acts'},
            h('button', {type: 'button', className: 'btn primary sm', disabled: pending?.has(`${first.projectId}:${first.cardId}`), onClick: () => onAct?.(first.primaryAct, {projectId: first.projectId, cardId: first.cardId})}, first.primary),
            h('button', {type: 'button', className: 'btn quiet sm', onClick: () => onAct?.('snooze', {projectId: first.projectId, cardId: first.cardId})}, zh.today.later))) : h('p', {className: 'dotv2-overlay__calm'}, model?.blind ? zh.today.blindBody : zh.today.emptyNeed),
        sessionLine ? h('p', {className: 'dotv2-overlay__where'}, sessionLine) : null,
        ack ? h('p', {className: 'dotv2-overlay__ack', role: 'status'}, ack) : null,
        error ? h('p', {className: 'dotv2-overlay__error', role: 'alert'}, error) : null,
        h('form', {className: 'ask', onSubmit: submit},
          h('input', {value: text, onChange: event => setText(event.target.value), 'aria-label': zh.today.float.input, placeholder: zh.today.float.input, maxLength: 4000}),
          h('button', {type: 'submit', className: 'send', 'aria-label': zh.today.send}, '↑')),
        h('div', {className: 'dotv2-overlay__acts'},
          h('button', {type: 'button', onClick: onOpenToday}, zh.today.float.open),
          onExpand ? h('button', {type: 'button', onClick: onExpand}, zh.today.float.expand) : null)) : null,
      h('button', {type: 'button', className: 'dotv2-overlay__dot', 'aria-expanded': open, 'aria-label': open ? '收起小今天' : '打开小今天', onClick: () => onToggle?.(!open)},
        h('i', {className: `d ${DOT_CLASS[dotState] ?? 'quiet'}`, 'aria-hidden': 'true'}),
        label ? h('span', null, label) : null));
  }

  return {TodayOverlay};
}
