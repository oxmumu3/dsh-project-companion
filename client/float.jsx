/** Floating entry (DESIGN.md 2.2): a dot that opens a small Today. It never
 *  auto-opens; new work only changes the dot's color and label. */
import {zh} from './strings.zh.js';

export function createFloatView(React) {
  const h = React.createElement;
  const STATE = {needs_you: 'wait', stuck: 'stuck', doing: 'run', done: 'done'};
  function FloatEntry({model, onAct, onSay, onOpenToday, onExpand, dockOpen}) {
    const [open, setOpen] = React.useState(false);
    const [text, setText] = React.useState('');
    const first = model.needCards[0] ?? model.needRows[0] ?? null;
    const worst = model.urgent[0] ?? model.dots.find(row => row.state !== 'quiet') ?? null;
    const dotState = model.blind ? 'none' : worst?.state ?? (model.counts.done ? 'done' : 'quiet');
    const label = model.blind ? '看不到状态'
      : model.counts.wait ? `${model.counts.wait} 件等你`
        : model.counts.stuck ? `${model.counts.stuck} 件卡住`
          : model.counts.run ? '正在做'
            : model.counts.done ? '做完了' : '';
    return h('div', {className: 'dotv2-float', 'data-float-entry': true},
      h('button', {type: 'button', className: 'dotv2-float__dot', 'aria-expanded': open, onClick: () => setOpen(value => !value)},
        h('i', {className: `d ${STATE[dotState] ?? 'quiet'}`, 'aria-hidden': 'true'}), label ? h('span', null, label) : null),
      open ? h('div', {className: 'dotv2-float__panel', role: 'dialog', 'aria-label': zh.float.title},
        h('p', null, model.headline.text),
        first ? h('div', null,
          h('b', null, first.title),
          h('p', null, first.what || ''),
          h('div', {className: 'acts'},
            h('button', {className: 'btn primary sm', type: 'button', onClick: () => onAct?.(first.primaryAct, {projectId: first.projectId, cardId: first.cardId})}, first.primary),
            h('button', {className: 'btn quiet sm', type: 'button', onClick: () => onAct?.('snooze', {projectId: first.projectId, cardId: first.cardId})}, zh.today.later))) : h('p', null, model.blind ? zh.today.blindBody : zh.today.emptyNeed),
        h('form', {className: 'ask', onSubmit: event => { event.preventDefault(); const value = text.trim(); if (!value) return; setText(''); onSay?.(value); }},
          h('input', {value: text, onChange: event => setText(event.target.value), 'aria-label': zh.float.input, placeholder: zh.float.input, maxLength: 4000}),
          h('button', {className: 'btn line2 sm', type: 'submit'}, '发')),
        h('div', {className: 'dotv2-float__acts'},
          h('button', {type: 'button', onClick: () => { setOpen(false); onOpenToday?.(); }}, zh.float.open),
          dockOpen ? h('button', {type: 'button', onClick: () => { setOpen(false); onExpand?.(); }}, zh.float.expand) : null)) : null);
  }
  return {FloatEntry};
}
