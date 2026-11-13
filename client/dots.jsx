/** Dots and the sentence made of them (DESIGN.md 2.2 Today). */
const STATE_CLASS = {needs_you: 'wait', wait: 'wait', stuck: 'stuck', doing: 'run', run: 'run', done: 'done', quiet: 'quiet', none: 'none', unknown: 'none'};

export function createDots(React, {zh}) {
  const h = React.createElement;
  function Dot({state = 'quiet', size = '', title}) {
    return h('i', {className: `d ${size} ${STATE_CLASS[state] ?? 'quiet'}`.trim(), ...(title ? {title} : {}), 'aria-hidden': 'true'});
  }
  function Sentence({model}) {
    if (model.state === 'blind') {
      return h('h1', {className: 'line'}, zh.today.headlineBlind);
    }
    if (model.state === 'loading') {
      return h('h1', {className: 'line'}, h('span', {className: 'lead'}, zh.today.headlineLoading));
    }
    if (model.state === 'empty') {
      return h('h1', {className: 'line'}, h('span', {className: 'lead'}, zh.today.headlineEmpty), zh.today.firstHint);
    }
    const counts = model.counts;
    const pieces = [];
    if (counts.done) pieces.push([`${zh.today.counted(counts.done)}件做完了`, 'done']);
    if (counts.wait) pieces.push([`${zh.today.counted(counts.wait)}件在等你`, 'wait']);
    if (counts.stuck) pieces.push([`${zh.today.counted(counts.stuck)}件卡住了`, 'stuck']);
    const runTail = counts.run ? `${pieces.length ? '还有' : '有'}${zh.today.counted(counts.run)}件在跑。${pieces.length ? '' : zh.today.headlineRunOnly}` : '';
    return h('h1', {className: 'line'},
      h('span', {className: 'lead'}, zh.today.leadNow),
      h('br'),
      pieces.map(([text, state], i) => h('span', {className: 'cl', key: state}, h('span', {className: 'ds'}, h(Dot, {state})), text, i < pieces.length - 1 ? '，' : runTail ? '，' : '。')),
      runTail ? h('span', {className: 'cl'}, runTail) : null,
    );
  }
  function Matrix({model, onOpen}) {
    return h('div', {className: 'matrix', 'aria-label': '全部项目，一个项目一个点'},
      model.dots.map(row => h('button', {
        key: row.id, type: 'button', title: row.name, onClick: () => onOpen?.(row.id),
        'aria-label': `${row.name}${row.state === 'unknown' ? '，状态未知' : row.state === 'quiet' ? '，今天没有动静' : ''}`,
      }, h(Dot, {state: row.state}))));
  }
  return {Dot, Sentence, Matrix, STATE_CLASS};
}
