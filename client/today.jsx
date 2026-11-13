/** The Today page (DESIGN.md 2.2 today). Renders the pure model; no copy or
 *  counting lives here. */
import {createDots} from './dots.jsx';
import {zh} from './strings.zh.js';
import {starterDraft} from './today-model.js';

export function createTodayView(React) {
  const h = React.createElement;
  const {Dot, Sentence, Matrix} = createDots(React, {zh});

  function Composer({onSay, disabled, draft = '', onDraft = () => {}, inputRef}) {
    const fallback = React.useRef(null);
    const input = inputRef ?? fallback;
    const submit = async event => {
      event.preventDefault();
      const value = draft.trim();
      if (!value || disabled) return;
      onDraft('');
      await onSay?.(value);
      input.current?.focus?.();
    };
    return h('form', {className: 'ask', onSubmit: submit, 'data-composer-seat': true},
      h('input', {ref: input, value: draft, onChange: event => onDraft(event.target.value), 'aria-label': zh.today.placeholder, placeholder: zh.today.placeholder, maxLength: 4000}),
      h('button', {className: 'send', type: 'submit', 'aria-label': zh.today.send, disabled}, '↑'));
  }

  function InlineWechat({mode, connection, error, qrFailed, onRefresh, onSettings, onQrError}) {
    const state = connection?.state;
    const copy = {
      missing: '微信桥接尚未就绪。先在电脑上聊，也可到连接页查看微信设置。',
      unknown: '微信连接状态暂未确认，保留原连接；先在电脑上继续。',
      'waiting-qr': '微信扫一扫 · 等待扫码',
      scanned: '已扫码，请在手机上确认。',
      'awaiting-message': '已确认扫码账号。用这个微信给小助手发送“你好”，开始聊天。',
      bound: '微信已连接，沿用已有入口。',
      failed: '微信连接暂时受阻。先查看已有连接状态，不会重置绑定。',
    };
    if (mode === 'guide') return h('section', {className: 'pc_dot_inline_wechat', 'data-dot-inline-wechat': true, 'data-dot-wechat-guide': true, 'aria-label': '微信连接提示'},
      h('div', {className: 'pc_dot_pair_copy'}, h('h2', null, '把 Dot 带到微信里'), h('p', null, '微信还没连接。需要时到连接页查看现有微信设置，扫码不会自动开启推送。'), h('button', {type: 'button', onClick: onSettings}, '查看微信设置')));
    return h('section', {className: 'pc_dot_inline_wechat', 'data-dot-inline-wechat': true, 'aria-label': '连接微信'},
      h('div', {className: 'pc_dot_pair_copy'},
        h('h2', null, state === 'bound' ? '微信已连接' : '把 Dot 带到微信里'),
        h('p', null, '在手机上交代任务、收结果，也能收到你已开启的提醒。'),
        h('p', {className: 'pc_dot_muted'}, '电脑和 Harness 需保持在线。扫码不会自动开启推送。')),
      h('div', {className: 'pc_dot_inline_code'},
        h('p', {role: 'status'}, error || (qrFailed ? '二维码暂不可用，请刷新连接状态。' : copy[state] ?? '正在读取现有微信连接…')),
        state === 'waiting-qr' && connection?.qrAvailable === true && !qrFailed
          ? h('img', {src: '/wechat/api/qr-image' + (/^[a-f0-9]{16}$/.test(connection.qrRevision ?? '') ? `?v=${connection.qrRevision}` : ''), alt: '用微信扫描，连接 Dot', onError: onQrError})
          : null,
        h('button', {type: 'button', onClick: onRefresh}, '刷新连接状态'),
        state === 'missing' || state === 'failed' ? h('button', {type: 'button', onClick: onSettings}, '查看微信设置') : null));
  }

  function NeedCard({item, onAct, pending}) {
    const key = `${item.projectId}:${item.cardId}`;
    const waiting = pending?.has(key) === true;
    const buttons = [
      h('button', {key: 'a', className: 'btn primary', type: 'button', disabled: waiting, onClick: () => onAct?.(item.primaryAct, {projectId: item.projectId, cardId: item.cardId})}, waiting ? zh.today.retryPending : item.primary),
      item.second && item.secondAct ? h('button', {key: 'b', className: 'btn line2', type: 'button', onClick: () => onAct?.(item.secondAct, {projectId: item.projectId, cardId: item.cardId})}, item.second) : null,
      h('span', {key: 's', className: 'sp'}),
      h('button', {key: 'l', className: 'btn quiet', type: 'button', disabled: waiting, onClick: () => onAct?.('snooze', {projectId: item.projectId, cardId: item.cardId})}, zh.today.later),
      h('button', {key: 'd', className: 'btn quiet', type: 'button', disabled: waiting, onClick: () => onAct?.('handled', {projectId: item.projectId, cardId: item.cardId})}, zh.today.handled),
    ];
    return h('article', {className: `focus is-${item.state}`},
      h('div', {className: 'meta'}, h(Dot, {state: item.state}), h('b', null, item.state === 'needs_you' ? '等你拍板' : '卡住了'), h('span', null, item.projectName), item.at ? h('time', null, item.at) : null),
      h('h3', null, item.title),
      item.what && item.what !== item.title ? h('p', {className: 'what'}, item.what) : null,
      waiting ? h('p', {className: 'what', role: 'status'}, zh.today.retryPending) : null,
      h('div', {className: 'acts'}, ...buttons));
  }

  function rowAction(item, onAct) {
    return h('div', {className: 'tail', key: 'tail'},
      item.at ? h('time', null, item.at) : null,
      h('button', {className: 'btn line2 sm', type: 'button', onClick: () => onAct?.(item.primaryAct, {projectId: item.projectId, cardId: item.cardId})}, item.primary),
      h('button', {className: 'btn quiet sm', type: 'button', onClick: () => onAct?.('snooze', {projectId: item.projectId, cardId: item.cardId})}, zh.today.later));
  }

  function TodayPage({model, onAct, onSay, onOpenProject, onOpenSession, onClearSample, pending, wechatMode = null, inlineConnection = null, inlineConnectionError = '', qrFailed = false, onRefreshInline, onOpenSettings, onQrError}) {
    const empty = model.state === 'empty';
    const [draft, setDraft] = React.useState('');
    const inputRef = React.useRef(null);
    const focusComposer = () => (globalThis.requestAnimationFrame ?? (fn => queueMicrotask(fn)))(() => inputRef.current?.focus?.());
    const useStarter = text => { const next = starterDraft(draft, text); if (next !== draft) setDraft(next); focusComposer(); };
    const dateText = new Intl.DateTimeFormat('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'}).format(new Date());
    const warnings = model.sourceProblems.map(row => h('span', {className: 'srcwarn', key: row.id, role: 'status'}, zh.today.sourceFix[row.id] ?? `${row.name}要重新连接`));

    const hero = h('div', {className: 'hero'},
      h('div', null,
        h('div', {className: 'when-row'},
          h('p', {className: 'when'}, dateText),
          model.sample ? h('button', {className: 'ulink sample-clear', type: 'button', onClick: onClearSample}, zh.today.sampleClear) : null,
          ...warnings),
        model.sample ? h('p', {className: 'sample-mark'}, zh.today.sampleMark) : null,
        h(Sentence, {model}),
        h(Composer, {onSay, disabled: false, draft, onDraft: setDraft, inputRef}),
        wechatMode ? h(InlineWechat, {mode: wechatMode, connection: inlineConnection, error: inlineConnectionError, qrFailed, onRefresh: onRefreshInline, onSettings: onOpenSettings, onQrError}) : null,
        (empty || model.sample) ? h('div', {className: 'starters'}, zh.today.starters.map(text => h('button', {key: text, type: 'button', onClick: () => useStarter(text)}, text))) : null),
      h(Matrix, {model, onOpen: onOpenProject}));

    const moreActive = Math.max(0, model.field.active.length - 6);
    const summary = [
      moreActive > 0 ? zh.today.moreActive(moreActive) : '',
      model.field.quiet > 0 ? zh.today.quietLine(model.field.quiet) : '',
    ].filter(Boolean).join('，');
    const field = h('section', {className: `field ${empty ? 'is-empty' : ''}`, 'aria-label': '今天有动静的项目'},
      ...model.field.active.slice(0, 6).map(row => h('button', {key: row.id, className: `cell is-${row.state}`, type: 'button', onClick: () => onOpenProject?.(row.id)},
        h(Dot, {state: row.state}),
        h('div', null, h('b', null, row.name), h('span', null, row.count > 1 ? `${row.count} 件` : row.state === 'done' ? '做完了' : row.state === 'needs_you' ? '等你' : row.state === 'stuck' ? '卡住了' : '正在做')))),
      summary ? h('div', {className: 'rest'}, h('p', null, summary)) : null);

    const needChildren = [
      h('h2', {key: 'title'}, model.blind ? zh.today.blindTitle : zh.today.needTitle, !model.blind && model.urgent.length ? h('small', null, `${model.urgent.length} 件`) : null),
    ];
    if (model.blind) needChildren.push(h('p', {key: 'blind', className: 'empty'}, zh.today.blindBody));
    else if (model.urgent.length === 0 && model.doneGroups.length === 0) needChildren.push(h('p', {key: 'empty', className: 'empty'}, zh.today.emptyNeed));
    if (model.sample) needChildren.push(h('div', {key: 'sample', className: 'sample-card'}, h('p', null, zh.today.sampleMark)));
    for (const item of model.needCards) needChildren.push(h(NeedCard, {key: item.projectId + item.state, item, onAct, pending}));
    if (model.needRows.length) {
      needChildren.push(h('div', {key: 'rows', className: 'rows'}, ...model.needRows.map(item => h('div', {className: 'row', key: item.projectId + item.state},
        h(Dot, {state: item.state, size: 'm'}), h('b', null, item.projectName), h('p', null, item.title), rowAction(item, onAct)))));
    }
    if (model.doneGroups.length) {
      const rows = model.doneGroups.map(group => h('div', {className: 'row', key: group.projectId},
        h(Dot, {state: 'done', size: 'm'}), h('b', null, group.name),
        h('p', null, group.count > 1 ? `做完了 ${group.count} 件。最近一件：${group.latest.what}` : group.latest.what),
        h('div', {className: 'tail'},
          group.latest.at ? h('time', null, group.latest.at) : null,
          h('button', {className: 'btn line2 sm', type: 'button', onClick: () => onOpenProject?.(group.projectId)}, '看结果'),
          h('button', {className: 'btn quiet sm', type: 'button', onClick: () => onAct?.('handled-all', {projectId: group.projectId})}, group.count > 1 ? '全部已处理' : zh.today.handled))));
      needChildren.push(h('div', {key: 'done'},
        h('h2', {style: {marginTop: 34}}, zh.today.doneTitle, h('small', null, zh.today.doneSub)),
        h('div', {className: 'rows'}, ...rows)));
    }
    if (model.doneMore) needChildren.push(h('p', {key: 'more', className: 'next'}, zh.today.doneMore(model.doneMore)));
    const need = h('section', {'aria-label': '需要你'}, ...needChildren);

    const promiseItems = model.promises.length
      ? model.promises.map(row => h('li', {key: row.id},
        h('time', null, row.whenText),
        h('b', null, row.what),
        h('div', {className: 'link'},
          h(Dot, {state: row.state, size: 's'}),
          h('span', null, `${row.from}，${row.note}`),
          row.handledBy ? h('button', {className: 'ulink', type: 'button', onClick: () => onOpenSession?.(row.handledBy.sessionId)}, '看它做到哪了') : null,
          row.related && row.related.cardId ? h('button', {className: 'ulink', type: 'button', onClick: () => onAct?.('open', {projectId: row.related.projectId, cardId: row.related.cardId})}, '看看最近的会话') : null,
          row.dispatch ? h('button', {className: 'ulink', type: 'button', onClick: () => onAct?.('dispatch', {promiseId: row.id})}, zh.today.dispatch) : null)))
      : [h('li', {key: 'none'}, h('span', null, model.blind ? zh.today.blindBody : zh.today.emptyNeed))];
    const promiseWarnings = model.sourceProblems.map(row => h('p', {className: 'next', key: row.id, role: 'status'}, zh.today.sourceFix[row.id] ?? `${row.name}要重新连接`));
    const promisePartials = (model.sourcePartials ?? []).map(row => h('p', {className: 'next', key: `partial:${row.id}`, role: 'status'}, row.note));
    const aside = h('aside', {'aria-label': zh.today.promisesTitle},
      h('h2', null, zh.today.promisesTitle, h('small', null, zh.today.promisesSub)),
      h('ul', {className: 'promise'}, ...promiseItems),
      ...promiseWarnings, ...promisePartials);

    const stage = h('div', {className: 'stage'}, hero, field, h('div', {className: `cols ${empty ? 'is-flush' : ''}`}, need, aside));
    return h('div', {className: 'dotv2', 'data-today-state': model.state}, stage);
  }

  return {TodayPage, Composer};
}
