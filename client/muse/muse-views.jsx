/**
 * DSH Dot Muse v3.1 UI Views ("私人幕僚长 · 一屏一焦点 · 去框降噪")
 * Pure React.createElement components consuming `buildMuseViewModel`.
 */
import {TRAIT_PRESETS} from './muse-model.js';

export function createMuseViews(React) {
  const h = React.createElement;

  function MuseTopbar({tab, onTab, model, onOpenSettings, onOpenBrief, onOpenMobilePair}) {
    const tabs = [
      {id: 'today', label: '今天'},
      {id: 'threads', label: '脉络'},
      {id: 'memory', label: '记忆'},
      {id: 'connections', label: '连接'},
    ];
    const modeLabel = model.mode === 'synergy' ? '协同 · SuperAgent' : '独立模式';
    const mobilePaired = model.mobile?.paired === true;
    return h('header', {className: 'muse-topbar'},
      h('div', {className: 'muse-topbar-inner'},
        h('div', {className: 'muse-brand'},
          h('span', {className: 'muse-brand-mark', 'aria-hidden': true}, h('span', {className: 'muse-brand-dot'})),
          h('span', {className: 'muse-brand-name'}, 'Dot'),
          h('span', {className: 'muse-mode-label', 'data-muse-mode': model.mode}, modeLabel)),
        h('nav', {className: 'muse-nav', 'aria-label': 'Dot 视图切换'},
          ...tabs.map(item => h('button', {
            key: item.id,
            type: 'button',
            className: `muse-nav-btn${tab === item.id ? ' active' : ''}`,
            'data-muse-tab': item.id,
            'aria-current': tab === item.id ? 'page' : undefined,
            onClick: () => onTab?.(item.id),
          }, item.label))),
        h('div', {className: 'muse-topbar-right'},
          h('button', {
            type: 'button',
            className: 'muse-ghost-btn',
            'data-muse-open-mobile-pair': true,
            onClick: () => onOpenMobilePair?.(true),
          },
            h('span', {className: `muse-status-dot ${mobilePaired ? 'ok' : 'info'}`}),
            mobilePaired ? 'iPhone 已连' : '连手机'),
          h('button', {
            type: 'button',
            className: 'muse-ghost-btn',
            'data-muse-preview-brief': true,
            onClick: () => onOpenBrief?.(true),
          }, '今日早报'),
          h('button', {
            type: 'button',
            className: 'muse-ghost-btn',
            onClick: () => onOpenSettings ? onOpenSettings() : onTab?.('connections'),
          },
            h('span', {className: `muse-status-dot ${model.wechatConnected ? 'ok' : 'warn'}`}),
            model.wechatConnected ? '微信已连接' : '连接微信'))));
  }

  function MuseBriefDialog({open, model, onClose, onAsk}) {
    const dialogRef = React.useRef(null);
    React.useEffect(() => {
      const el = dialogRef.current;
      if (!el) return;
      if (open && !el.open) {
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      } else if (!open && el.open) {
        if (typeof el.close === 'function') el.close();
        else el.removeAttribute('open');
      }
    }, [open]);

    const lastDigest = model.digest?.lastDigest;
    const workspaceBrief = !model.sample ? model.workspaceBrief : null;
    const previewLines = [];
    if (lastDigest?.text) {
      previewLines.push(lastDigest.text);
    } else if (workspaceBrief?.text) {
      previewLines.push(`【工作区初见简报 · 已读懂 ${workspaceBrief.workspaceCount || workspaceBrief.workspaces?.length || 0} 个工作区】`);
      previewLines.push('');
      previewLines.push(workspaceBrief.text);
      previewLines.push('');
      previewLines.push(`提示：还没有连接外部日历/邮箱前，Dot 也能只读梳理你勾选的工作区；每天 ${model.digest.dailyTime} 定时简报可在「连接」页调整。`);
    } else {
      previewLines.push(`【试看预览 · 预计每天 ${model.digest.dailyTime}（${model.digest.timeZone}）生成】`);
      previewLines.push('');
      if (model.today.urgent.length > 0) {
        previewLines.push(`• 等你拍板的工作区事项（${model.today.urgent.length} 件）：先看「${model.today.urgent[0].title}」。`);
      } else {
        previewLines.push(`• 工作区动态：已关注 ${model.today.dots.length} 个本地项目目录，暂没有阻塞。`);
      }
      if (model.mode === 'synergy') {
        previewLines.push(`• SuperAgent 协同：${model.superagent.counts.inReview} 项待验收，${model.superagent.counts.inProgress} 项正在推进。`);
      }
      if (model.events.length > 0) {
        previewLines.push(`• 今日日程（${model.events.length} 场）：首场 ${model.events[0].timeText}「${model.events[0].title}」。`);
      } else {
        previewLines.push('• 今日日程：主日历暂未读到今天的新安排。');
      }
      if (model.today.promises.length > 0) {
        previewLines.push(`• 答应过的事（${model.today.promises.length} 项）：例如「${model.today.promises[0].what}」。`);
      }
      previewLines.push('');
      previewLines.push('提示：真实定时早报会在设定时刻由你授权的来源汇总后呈现，没有内容时保持安静。');
    }

    return h('dialog', {
      ref: dialogRef,
      className: 'muse-dialog',
      closedby: 'any',
      'data-muse-brief-dialog': true,
      onClose: () => onClose?.(),
      onCancel: event => {
        event.preventDefault();
        onClose?.();
      },
    },
      h('header', {className: 'muse-dialog-head'},
        h('div', null,
          h('h2', {className: 'muse-dialog-title'}, lastDigest?.text ? '最近一份早报' : workspaceBrief?.text ? '工作区初见简报' : '今天的第一份早报 · 试看'),
          h('p', {className: 'muse-sheet-sub'}, lastDigest?.at ? `整理时间：${lastDigest.at}` : workspaceBrief?.text ? `已只读梳理 ${workspaceBrief.workspaceCount || workspaceBrief.workspaces?.length || 0} 个工作区` : `节律设定：每天 ${model.digest.dailyTime}`)),
        h('button', {
          type: 'button',
          className: 'muse-btn-outline',
          'data-muse-dialog-close': true,
          onClick: () => onClose?.(),
        }, '关闭')),
      h('div', {className: 'muse-dialog-body'}, previewLines.join('\n')),
      h('footer', {className: 'muse-dialog-foot'},
        h('span', {className: 'muse-section-note'}, model.digest.deliveryMode === 'silent_pull' ? '当前设为静音，只在你主动点开时展示' : `投递习惯：${model.digest.dailyTime}`),
        h('button', {
          type: 'button',
          className: 'muse-btn-primary',
          onClick: () => {
            onClose?.();
            onAsk?.('对照今天早报和手头的安排，帮我定一下先做哪两件？');
          },
        }, '带进对话接着聊')));
  }

  function MuseMobilePairDialog({open, pair, loading = false, busy = false, onClose, onRotate}) {
    const dialogRef = React.useRef(null);
    const [copiedPin, setCopiedPin] = React.useState(false);

    React.useEffect(() => {
      const el = dialogRef.current;
      if (!el) return;
      if (open && !el.open) {
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      } else if (!open && el.open) {
        if (typeof el.close === 'function') el.close();
        else el.removeAttribute('open');
      }
      if (!open) setCopiedPin(false);
    }, [open]);

    const expLabel = React.useMemo(() => {
      if (!pair?.expiresAt || !Number.isFinite(pair.expiresAt)) return '15 分钟内有效';
      try {
        return `${new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(pair.expiresAt))} 前有效`;
      } catch {
        return '15 分钟内有效';
      }
    }, [pair?.expiresAt]);

    const handleCopyPin = () => {
      if (!pair?.pin) return;
      try {
        void navigator.clipboard?.writeText?.(pair.pin);
        setCopiedPin(true);
        setTimeout(() => setCopiedPin(false), 1800);
      } catch {
        // Ignore clipboard errors in restricted contexts
      }
    };

    return h('dialog', {
      ref: dialogRef,
      className: 'muse-dialog muse-mobile-pair-dialog',
      closedby: 'any',
      'data-muse-mobile-dialog': true,
      onClose: () => onClose?.(),
      onCancel: event => {
        event.preventDefault();
        onClose?.();
      },
    },
      h('header', {className: 'muse-dialog-head'},
        h('div', null,
          h('h2', {className: 'muse-dialog-title'}, '把 Dot 装进 iPhone'),
          h('p', {className: 'muse-sheet-sub'}, pair?.deviceName ? `${pair.deviceName} · 端到端加密直连` : '无需账号 · 同 Wi-Fi 或 5G 即连')),
        h('button', {
          type: 'button',
          className: 'muse-btn-outline',
          'data-muse-mobile-close': true,
          onClick: () => onClose?.(),
        }, '关闭')),
      h('div', {className: 'muse-dialog-body muse-pair-dialog-body'},
        loading && !pair
          ? h('p', {className: 'muse-pair-loading'}, '正在生成 6 位动态配对码与二维码…')
          : pair
            ? h('div', {className: 'muse-pair-layout'},
              h('div', {className: 'muse-pair-qr-col'},
                h('div', {className: 'muse-pair-qr-box', 'data-muse-mobile-qr': true},
                  h('svg', {
                    viewBox: pair.qrViewBox || '0 0 64 64',
                    className: 'muse-pair-qr-svg',
                    role: 'img',
                    'aria-label': 'iPhone DSH Dot 扫码配对二维码',
                  },
                    h('rect', {width: '100%', height: '100%', fill: 'white'}),
                    h('path', {d: pair.qrPathD || '', stroke: 'transparent', fill: '#111111'}))),
                h('p', {className: 'muse-pair-qr-caption'}, '在手机点「扫码」对准这里')),
              h('div', {className: 'muse-pair-code-col'},
                h('div', {className: 'muse-pair-code-meta'},
                  h('span', {className: 'muse-pair-eyebrow'}, '6 位动态配对码'),
                  h('span', {className: 'muse-section-note'}, expLabel)),
                h('div', {
                  className: 'muse-pair-pin',
                  'data-muse-mobile-pin': pair.pin,
                }, pair.pinFormatted || pair.pin),
                h('div', {className: 'muse-pair-code-actions'},
                  h('button', {
                    type: 'button',
                    className: 'muse-btn-link',
                    'data-muse-mobile-rotate': true,
                    disabled: busy || loading,
                    onClick: () => onRotate?.(),
                  }, '换一个新码'),
                  h('button', {
                    type: 'button',
                    className: 'muse-btn-link',
                    onClick: handleCopyPin,
                  }, copiedPin ? '已复制 6 位码' : '复制 6 位码')),
                h('div', {className: 'muse-pair-routes'},
                  h('span', {className: 'muse-pair-route-item'},
                    h('span', {className: `muse-status-dot ${pair.bridgeActive ? 'ok' : 'info'}`}),
                    pair.bridgeActive ? '局域网直连已就绪' : '正在准备局域网直连'),
                  h('span', {className: 'muse-pair-route-item'},
                    h('span', {className: `muse-status-dot ${pair.tunnelReady ? 'ok' : 'info'}`}),
                    pair.tunnelReady ? '出门 5G 加密隧道已就绪' : '同 Wi-Fi 下无需公网隧道即可配对')),
                h('ol', {className: 'muse-pair-steps'},
                  h('li', null, '在 iPhone 打开 DSH Dot，点「扫码」扫左侧二维码，或手动输入上方 6 位数字。'),
                  h('li', null, '不用注册账号、不用打开终端；配对后同 Wi-Fi 与出门 5G 会自动无感重连。'))))
            : h('p', {className: 'muse-pair-loading'}, '暂时没能读取到配对码，请点右侧按钮重试。')),
      h('footer', {className: 'muse-dialog-foot'},
        h('span', {className: 'muse-section-note'}, pair?.paired ? `已有 ${pair.pairedCount || 1} 台手机配对过` : '仅在主动确认时开放本机只读投影'),
        h('button', {
          type: 'button',
          className: 'muse-btn-primary',
          onClick: () => onClose?.(),
        }, '完成')));
  }

  function FocusCard({focus, busy, onAction, onSaveDraft, onAsk}) {
    const [editingDraft, setEditingDraft] = React.useState(false);
    const [draftValue, setDraftValue] = React.useState(focus?.draftSlip || '');
    const [copiedDraft, setCopiedDraft] = React.useState(false);

    React.useEffect(() => {
      setEditingDraft(false);
      setDraftValue(focus?.draftSlip || '');
      setCopiedDraft(false);
    }, [focus?.key, focus?.draftSlip]);

    if (!focus) return null;

    const handlePrimary = () => {
      if (focus.primaryAction?.type === 'dispatch_promise') {
        const nextDraft = editingDraft ? draftValue.trim() : (focus.draftSlip || focus.primaryAction.draftText);
        onAction?.({...focus.primaryAction, ...(nextDraft ? {draftText: nextDraft} : {})}, focus);
        return;
      }
      onAction?.(focus.primaryAction, focus);
    };

    return h('article', {className: 'muse-focus-card', 'data-muse-focus-card': focus.kind},
      h('div', {className: 'muse-focus-meta'},
        h('span', {className: 'muse-focus-source'}, focus.sourceLabel),
        focus.timeText ? h('time', null, focus.timeText) : null),
      h('h2', {className: 'muse-focus-title'}, focus.title),
      focus.body ? h('p', {className: 'muse-focus-body'}, focus.body) : null,
      focus.draftSlip
        ? h('div', {className: 'muse-draft-slip', 'data-muse-draft-slip': focus.kind},
          focus.editableDraft
            ? h('div', {className: 'muse-draft-slip-head'},
              h('span', {className: 'muse-section-note'}, focus.draftKind === 'edited' ? '已按你的修改保存' : 'Dot 替你预拟好了草稿'),
              !editingDraft
                ? h('div', {className: 'muse-hairline-actions'},
                  h('button', {
                    type: 'button',
                    className: 'muse-btn-link',
                    'data-muse-draft-edit': true,
                    disabled: busy,
                    onClick: () => {
                      setDraftValue(focus.draftSlip || '');
                      setEditingDraft(true);
                    },
                  }, '改两句'),
                  h('button', {
                    type: 'button',
                    className: 'muse-btn-link',
                    'data-muse-draft-copy': true,
                    onClick: () => {
                      try { void globalThis.navigator?.clipboard?.writeText?.(focus.draftSlip || ''); } catch {}
                      setCopiedDraft(true);
                    },
                  }, copiedDraft ? '已复制' : '复制草稿'))
                : null)
            : null,
          editingDraft && focus.editableDraft
            ? h('div', {className: 'muse-draft-editor-wrap'},
              h('textarea', {
                className: 'muse-input muse-draft-textarea',
                'data-muse-draft-editor': true,
                rows: 4,
                value: draftValue,
                disabled: busy,
                onChange: event => setDraftValue(event.target.value),
                onKeyDown: event => {
                  if (event.key === 'Escape') {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    setDraftValue(focus.draftSlip || '');
                    setEditingDraft(false);
                  }
                },
              }),
              h('div', {className: 'muse-hairline-actions', style: {marginTop: 8}},
                h('button', {
                  type: 'button',
                  className: 'muse-btn-primary',
                  'data-muse-draft-save': true,
                  disabled: busy || !draftValue.trim(),
                  onClick: async () => {
                    await onSaveDraft?.(focus, draftValue.trim());
                    setEditingDraft(false);
                  },
                }, '保存这版草稿'),
                h('button', {
                  type: 'button',
                  className: 'muse-btn-outline',
                  'data-muse-draft-cancel': true,
                  onClick: () => {
                    setDraftValue(focus.draftSlip || '');
                    setEditingDraft(false);
                  },
                }, '取消')))
            : focus.draftSlip)
        : null,
      h('div', {className: 'muse-focus-actions'},
        h('button', {
          type: 'button',
          className: 'muse-btn-primary',
          disabled: busy,
          onClick: handlePrimary,
        }, focus.primaryLabel),
        focus.secondaryLabel
          ? h('button', {
            type: 'button',
            className: 'muse-btn-outline',
            disabled: busy,
            onClick: () => onAction?.(focus.secondaryAction, focus),
          }, focus.secondaryLabel)
          : null,
        focus.laterAction
          ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            disabled: busy,
            onClick: () => onAction?.(focus.laterAction, focus),
          }, focus.laterLabel || '稍后再看')
          : null,
        focus.handledAction
          ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            disabled: busy,
            onClick: () => onAction?.(focus.handledAction, focus),
          }, '记为已处理')
          : null,
        focus.askPrompt && focus.primaryAction?.type !== 'ask'
          ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            disabled: busy,
            onClick: () => onAsk?.(focus.askPrompt),
          }, '问 Dot 一句')
          : null));
  }

  function MuseTodayView({
    model,
    busy,
    onAction,
    onSaveDraft,
    onPinFocus,
    onAsk,
    onOpenProject,
    onOpenWorkspacePicker,
    onOpenTab,
  }) {
    const visibleFolded = model.folded.slice(0, 3);
    const hiddenFolded = model.folded.slice(3);

    return h('div', {className: 'muse-stage'},
      h('section', {className: 'muse-hero'},
        h('p', {className: 'muse-kicker'}, model.dateText),
        h('h1', {className: 'muse-greeting'}, model.greeting),
        h('p', {className: 'muse-subline'}, model.heroSubline)),
      model.paused
        ? h('div', {className: 'muse-notice-line', role: 'status'},
          h('span', null, '项目主动协调目前已暂停；你可以继续自己点开对话或恢复提醒。'),
          h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenTab?.('connections')}, '去连接页查看'))
        : null,
      model.digest.isQuietToday
        ? h('div', {className: 'muse-notice-line info', role: 'status'},
          h('span', null, '今天已设为「先别敲我」，主动提醒保持安静。'),
          h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenTab?.('connections')}, '调整节律'))
        : null,
      model.sourceProblems.length > 0
        ? h('div', {className: 'muse-notice-line', role: 'status'},
          h('span', null, `部分连接需要重新确认：${model.sourceProblems.map(row => row.name).join('、')}。`),
          h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenTab?.('connections')}, '去处理授权'))
        : null,
      h('div', {className: 'muse-grid'},
        h('div', {className: 'muse-col-main'},
          h(FocusCard, {focus: model.focus, busy, onAction, onSaveDraft, onAsk}),
          model.folded.length > 0
            ? h('section', {className: 'muse-section', 'aria-label': '顺手排队的事项'},
              h('div', {className: 'muse-section-head'},
                h('h3', {className: 'muse-section-title'}, `排在后面的 ${model.folded.length} 件事`),
                h('span', {className: 'muse-section-note'}, '不抢桌面焦点，需要时点一下换上来')),
              ...visibleFolded.map(item => h('div', {key: item.key, className: 'muse-hairline-row', 'data-muse-folded': item.key},
                h('div', {className: 'muse-hairline-main'},
                  h('div', {className: 'muse-hairline-title'}, item.title),
                  h('div', {className: 'muse-hairline-sub'}, `${item.sourceLabel}${item.timeText ? ` · ${item.timeText}` : ''}`)),
                h('div', {className: 'muse-hairline-actions'},
                  h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onPinFocus?.(item.key)}, '切到焦点'),
                  item.askPrompt ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(item.askPrompt)}, '聊聊') : null))),
              hiddenFolded.length > 0
                ? h('details', {className: 'muse-more-disclosure'},
                  h('summary', null, `还有 ${hiddenFolded.length} 件安静收起的事项`),
                  ...hiddenFolded.map(item => h('div', {key: item.key, className: 'muse-hairline-row'},
                    h('div', {className: 'muse-hairline-main'},
                      h('div', {className: 'muse-hairline-title'}, item.title),
                      h('div', {className: 'muse-hairline-sub'}, item.sourceLabel)),
                    h('div', {className: 'muse-hairline-actions'},
                      h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onPinFocus?.(item.key)}, '切到焦点')))))
                : null)
            : null,
          h('section', {className: 'muse-section muse-workspace-section', 'aria-label': '在推进的工作区'},
            h('div', {className: 'muse-section-head'},
              h('h3', {className: 'muse-section-title'}, model.mode === 'synergy' ? '在推进的项目与协同里程碑' : '在推进的本地工作区'),
              h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenWorkspacePicker?.()}, '选关注文件夹')),
            model.workspaceRows.length > 0
              ? model.workspaceRows.map(row => h('div', {key: row.key, className: 'muse-hairline-row', 'data-muse-workspace-row': row.key},
                h('div', {className: 'muse-hairline-main'},
                  h('div', {className: 'muse-hairline-title'}, row.title),
                  h('div', {className: 'muse-hairline-sub'}, `${row.statusText}${row.summary ? ` · ${row.summary}` : ''}`)),
                h('div', {className: 'muse-hairline-actions'},
                  row.projectId
                    ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenProject?.(row.projectId)}, '打开项目')
                    : null,
                  h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(row.askPrompt)}, '问 Dot'))))
              : h('p', {className: 'muse-rail-empty'}, '还没有勾选要跟踪的工作区文件夹。点右上角「选关注文件夹」，即使不装 SuperAgent，Dot 也会把代码会话进度抽象到这里。'))),
        h('aside', {className: 'muse-col-rail', 'aria-label': '今日日程与答应过的事'},
          h('div', {className: 'muse-rail-group'},
            h('h3', {className: 'muse-rail-title'},
              h('span', null, '今日日程'),
              model.events.length ? h('span', {className: 'muse-section-note'}, `${model.events.length} 场`) : null),
            model.events.length > 0
              ? model.events.map(ev => h('div', {key: ev.id, className: 'muse-timeline-item'},
                h('div', {className: 'muse-timeline-time'}, ev.location ? `${ev.timeText} · ${ev.location}` : ev.timeText),
                h('div', {className: 'muse-timeline-text'}, ev.title)))
              : h('p', {className: 'muse-rail-empty'},
                model.today.sourcesPhase === 'reading'
                  ? '正在轻声核对主日历…'
                  : '主日历今天空着，或者还没在「连接」页授权日历。')),
          h('div', {className: 'muse-rail-group'},
            h('h3', {className: 'muse-rail-title'},
              h('span', null, '答应过的事'),
              model.today.promises.length ? h('span', {className: 'muse-section-note'}, `${model.today.promises.length} 项`) : null),
            model.today.promises.length > 0
              ? model.today.promises.map(row => h('div', {key: row.id, className: 'muse-hairline-row'},
                h('div', {className: 'muse-hairline-main'},
                  h('div', {className: 'muse-hairline-title'}, row.what),
                  h('div', {className: 'muse-hairline-sub'}, `${row.whenText ? `${row.whenText} · ` : ''}${row.from || '来源'} · ${row.note}`)),
                h('div', {className: 'muse-hairline-actions'},
                  row.dispatch
                    ? h('button', {type: 'button', className: 'muse-btn-link', disabled: busy, onClick: () => onAction?.({type: 'dispatch_promise', promiseId: row.id, what: row.what})}, '派去跟进')
                    : h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(`帮我看一下「${row.what}」现在推进得怎样了。`)}, '查看'))))
              : h('p', {className: 'muse-rail-empty'}, '没有积压在邮箱或清单里忘记回复的事。')))));
  }

  function MuseThreadsView({model, onAsk}) {
    const [filter, setFilter] = React.useState('all');
    const filters = [
      {id: 'all', label: '全部脉络'},
      {id: 'attention', label: '等待与承诺'},
      {id: 'workspace', label: '日程与工作区'},
      {id: 'memory', label: '记忆随手记'},
    ];
    const rows = filter === 'all' ? model.threads : model.threads.filter(item => item.group === filter);

    return h('div', {className: 'muse-stage-narrow'},
      h('section', {className: 'muse-hero'},
        h('p', {className: 'muse-kicker'}, 'Across Sources · 跨来源时间脉络'),
        h('h1', {className: 'muse-greeting'}, '近期事情是怎么连起来的'),
        h('p', {className: 'muse-subline'}, '把日历、答应过的事、工作区会话与你的随口便签按同一条时间线摊开，不靠堆弹窗。')),
      h('div', {className: 'muse-filter-bar', role: 'tablist', 'aria-label': '脉络筛选'},
        ...filters.map(item => h('button', {
          key: item.id,
          type: 'button',
          className: `muse-chip${filter === item.id ? ' active' : ''}`,
          onClick: () => setFilter(item.id),
        }, item.label))),
      rows.length > 0
        ? h('div', null, ...rows.map(item => h('article', {key: item.id, className: 'muse-thread-item'},
          h('div', {className: 'muse-thread-kicker'},
            h('span', {className: 'muse-focus-source'}, item.source),
            h('span', null, item.badge),
            item.timeText ? h('time', null, item.timeText) : null),
          h('h2', {className: 'muse-thread-title'}, item.title),
          item.body ? h('p', {className: 'muse-thread-body'}, item.body) : null,
          item.askPrompt
            ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(item.askPrompt)}, '带入下方对话追问')
            : null)))
        : h('p', {className: 'muse-rail-empty'}, '这一栏暂时还没有新的跨来源动态；打开「连接」页接上几个来源或工作区，这里会自然长出脉络。'));
  }

  function MuseMemoryView({model, busy, undoBanner, onMuseAct, onDismissUndo, onAsk}) {
    const [noteDraft, setNoteDraft] = React.useState('');
    const [alsoQueue, setAlsoQueue] = React.useState(false);
    const [editingCat, setEditingCat] = React.useState(null);
    const [traitLabel, setTraitLabel] = React.useState('');
    const [traitValue, setTraitValue] = React.useState('');
    const composing = React.useRef(false);

    const submitNote = async () => {
      const text = noteDraft.trim();
      if (!text || busy) return;
      setNoteDraft('');
      await onMuseAct?.({action: 'profile_add_note', text, category: 'note', source: 'desktop'});
      if (alsoQueue && model.mode === 'synergy') {
        await onMuseAct?.({action: 'superagent_pending', text, title: text.slice(0, 48)});
      }
    };

    const startEdit = (category, existing = null) => {
      setEditingCat(category);
      setTraitLabel(existing?.label || (category === 'rhythm' ? '作息节律' : category === 'tone' ? '沟通语气' : category === 'focus' ? '当前重心' : '顺手偏好'));
      setTraitValue(existing?.value || '');
    };

    const saveTrait = async category => {
      const label = traitLabel.trim();
      const value = traitValue.trim();
      if (!label || !value || busy) return;
      setEditingCat(null);
      await onMuseAct?.({action: 'profile_set_trait', category, label, value});
    };

    return h('div', {className: 'muse-stage-narrow'},
      undoBanner
        ? h('div', {className: 'muse-undo-bar', role: 'status', 'data-muse-undo-bar': true},
          h('span', null, undoBanner.message || '刚才那条记忆已经更新。'),
          h('div', {className: 'muse-hairline-actions'},
            undoBanner.token
              ? h('button', {
                type: 'button',
                className: 'muse-btn-link',
                'data-muse-undo-btn': true,
                onClick: () => onMuseAct?.({action: 'profile_undo', token: undoBanner.token}),
              }, '撤回刚才那步')
              : null,
            h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onDismissUndo?.()}, '知道了')))
        : null,
      h('article', {className: 'muse-portrait-sheet'},
        h('header', {className: 'muse-sheet-header'},
          h('h1', {className: 'muse-sheet-title'}, '关于你 · 个人记忆侧写'),
          h('p', {className: 'muse-sheet-sub'}, '这里只放你自己愿意让 Dot 记住的偏好、节律与随口便签；随时点一下改写或忘掉，绝不猜着用、也不擅自改你的文件。')),
        h('div', {className: 'muse-note-composer'},
          h('input', {
            type: 'text',
            className: 'muse-input',
            value: noteDraft,
            'data-muse-note-input': true,
            placeholder: '顺口记下一句话，比如：下周三出差一天，上午别排深思考任务…',
            onChange: event => setNoteDraft(event.target.value),
            onCompositionStart: () => { composing.current = true; },
            onCompositionEnd: () => { composing.current = false; },
            onKeyDown: event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                if (composing.current || event.nativeEvent?.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                void submitNote();
              }
            },
          }),
          h('button', {
            type: 'button',
            className: 'muse-btn-primary',
            'data-muse-note-save': true,
            disabled: busy || !noteDraft.trim(),
            onClick: () => void submitNote(),
          }, '记下来')),
        model.mode === 'synergy'
          ? h('label', {style: {display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dot-muted)', marginBottom: 18}},
            h('input', {type: 'checkbox', checked: alsoQueue, onChange: event => setAlsoQueue(event.target.checked)}),
            '这条顺口如果是工程任务，同时放进 SuperAgent「待确认」栏')
          : null,
        ...model.traitGroups.map(group => h('section', {key: group.category, className: 'muse-trait-group'},
          h('div', {style: {display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}},
            h('h3', {className: 'muse-trait-group-title'}, `${group.label} · ${group.hint}`),
            h('button', {type: 'button', className: 'muse-btn-link', onClick: () => startEdit(group.category)}, '点一下就能改')),
          group.items.length > 0
            ? group.items.map(item => h('div', {key: item.id, className: 'muse-trait-row'},
              h('div', null,
                h('span', {className: 'muse-trait-label'}, item.label),
                h('div', {className: 'muse-trait-value'}, item.value)),
              h('div', {className: 'muse-hairline-actions'},
                h('button', {type: 'button', className: 'muse-btn-link', onClick: () => startEdit(group.category, item)}, '改一下'),
                h('button', {type: 'button', className: 'muse-btn-link danger', disabled: busy, onClick: () => onMuseAct?.({action: 'profile_remove_trait', id: item.id})}, '忘掉'))))
            : h('p', {className: 'muse-rail-empty'}, '还没有写下这条偏好。'),
          editingCat === group.category
            ? h('div', {className: 'muse-note-composer', style: {marginTop: 10}},
              h('input', {type: 'text', className: 'muse-input', style: {flex: '0 1 140px'}, value: traitLabel, placeholder: '条目名', onChange: event => setTraitLabel(event.target.value)}),
              h('input', {type: 'text', className: 'muse-input', value: traitValue, placeholder: '希望 Dot 怎么配合你', onChange: event => setTraitValue(event.target.value)}),
              h('button', {type: 'button', className: 'muse-btn-primary', disabled: busy, onClick: () => void saveTrait(group.category)}, '保存'),
              h('button', {type: 'button', className: 'muse-btn-outline', onClick: () => setEditingCat(null)}, '取消'))
            : null)),
        model.profile.traits.length === 0
          ? h('div', {style: {marginBottom: 18}},
            h('span', {className: 'muse-section-note'}, '不想从零打字？选一条常用默契直接写入：'),
            h('div', {className: 'muse-preset-row'},
              ...TRAIT_PRESETS.map(preset => h('button', {
                key: preset.label,
                type: 'button',
                className: 'muse-chip',
                disabled: busy,
                onClick: () => onMuseAct?.({action: 'profile_set_trait', ...preset}),
              }, `+ ${preset.label}：${preset.value}`))))
          : null,
        h('section', {className: 'muse-section'},
          h('div', {className: 'muse-section-head'},
            h('h3', {className: 'muse-section-title'}, `近期顺口记下的事（${model.profile.notes.length}）`),
            h('span', {className: 'muse-section-note'}, '删除后 2 分钟内随时可以撤回')),
          model.profile.notes.length > 0
            ? model.profile.notes.map(note => h('div', {key: note.id, className: 'muse-hairline-row', 'data-muse-note-id': note.id},
              h('div', {className: 'muse-hairline-main'},
                h('div', {className: 'muse-hairline-title'}, note.text),
                h('div', {className: 'muse-hairline-sub'}, `${note.source === 'wechat' ? '微信顺口记' : note.source === 'agent' ? '对话顺手记' : '桌面随记'} · 刚才或近期记下`)),
              h('div', {className: 'muse-hairline-actions'},
                h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(`基于我记下的「${note.text}」，今天我要准备什么？`)}, '聊聊'),
                h('button', {
                  type: 'button',
                  className: 'muse-btn-link danger',
                  'data-muse-note-delete': note.id,
                  disabled: busy,
                  onClick: () => onMuseAct?.({action: 'profile_delete_note', id: note.id}),
                }, '忘掉'))))
            : h('p', {className: 'muse-rail-empty'}, '这里还没有随记；在上方输入一句行程、心情或边界规则，Dot 会立刻记住。')),
        Array.isArray(model.staleProjectMemories) && model.staleProjectMemories.length > 0
          ? h('section', {className: 'muse-section', 'data-muse-stale-memories': true},
            h('div', {className: 'muse-section-head'},
              h('h3', {className: 'muse-section-title'}, `项目旧账核对建议（${model.staleProjectMemories.length}）`),
              h('span', {className: 'muse-section-note'}, '代码或进展似乎已收口；Dot 不擅自删记忆，由你点一下决定')),
            ...model.staleProjectMemories.map(item => h('div', {key: `${item.projectRoot}::${item.id}`, className: 'muse-hairline-row', 'data-muse-stale-id': item.id},
              h('div', {className: 'muse-hairline-main'},
                h('div', {className: 'muse-hairline-title'}, `[${item.projectLabel} · ${item.kind === 'blocker' ? '阻塞' : '下一步'}] ${item.text}`),
                h('div', {className: 'muse-hairline-sub'}, item.reason)),
              h('div', {className: 'muse-hairline-actions'},
                h('button', {
                  type: 'button',
                  className: 'muse-btn-link danger',
                  'data-muse-stale-archive': item.id,
                  disabled: busy,
                  onClick: () => onMuseAct?.({action: 'project_memory_archive_stale', projectRoot: item.projectRoot, memoryId: item.id}),
                }, '划掉归档'),
                h('button', {
                  type: 'button',
                  className: 'muse-btn-link',
                  'data-muse-stale-keep': item.id,
                  disabled: busy,
                  onClick: () => onMuseAct?.({action: 'project_memory_keep_stale', projectRoot: item.projectRoot, memoryId: item.id}),
                }, '继续留着')))))
          : null));
  }

  function MuseConnectionsView({model, busy, onMuseAct, onOpenBrief, onOpenMobilePair, onOpenWorkspacePicker, renderConnectionsHost}) {
    const times = ['07:30', '08:00', '08:30', '09:00', '10:00', '12:30', '18:00', '21:00'];
    const deliveryModes = [
      {value: 'wechat_and_desktop', label: '桌面和微信一起提醒'},
      {value: 'desktop_only', label: '只在电脑桌面静静准备好'},
      {value: 'silent_pull', label: '保持安静，只在我想看时点开'},
    ];
    const nudgeCounts = [
      {value: '0', label: '0 次 · 完全不打扰'},
      {value: '1', label: '最多 1 次'},
      {value: '2', label: '最多 2 次'},
      {value: '3', label: '最多 3 次'},
    ];

    return h('div', {className: 'muse-stage-narrow'},
      h('article', {className: 'muse-rhythm-sheet', 'data-muse-rhythm-sheet': true},
        h('header', {className: 'muse-sheet-header'},
          h('h1', {className: 'muse-sheet-title'}, '连接与提醒节律'),
          h('p', {className: 'muse-sheet-sub'}, '像跟真人助手交代默契一样，用一句话设定早报时间、安静模式和桌面协同。')),
        h('div', {className: 'muse-madlib'},
          '每天早上 ',
          h('select', {
            className: 'muse-inline-select',
            'aria-label': '每日早报时间',
            'data-muse-rhythm-time': true,
            disabled: busy,
            value: times.includes(model.digest.dailyTime) ? model.digest.dailyTime : '09:00',
            onChange: event => onMuseAct?.({action: 'rhythm_configure', dailyTime: event.target.value}),
          }, ...times.map(t => h('option', {key: t, value: t}, t))),
          '（', model.digest.timeZone, '），请以 ',
          h('select', {
            className: 'muse-inline-select',
            'aria-label': '早报呈现方式',
            'data-muse-rhythm-mode': true,
            disabled: busy,
            value: model.digest.deliveryMode,
            onChange: event => onMuseAct?.({action: 'rhythm_configure', deliveryMode: event.target.value}),
          }, ...deliveryModes.map(item => h('option', {key: item.value, value: item.value}, item.label))),
          ' 的方式给我一份今日简报；除此之外，每天最多主动敲我 ',
          h('select', {
            className: 'muse-inline-select',
            'aria-label': '每日最多提醒次数',
            disabled: busy,
            value: String(model.digest.maxDailyNudges),
            onChange: event => onMuseAct?.({action: 'rhythm_configure', maxDailyNudges: Number(event.target.value)}),
          }, ...nudgeCounts.map(item => h('option', {key: item.value, value: item.value}, item.label))),
          '。'),
        h('div', {className: 'muse-focus-actions'},
          h('button', {
            type: 'button',
            className: model.digest.isQuietToday ? 'muse-btn-primary' : 'muse-btn-outline',
            'data-muse-quiet-today': true,
            disabled: busy,
            onClick: () => onMuseAct?.({action: 'rhythm_configure', quietToday: !model.digest.isQuietToday}),
          }, model.digest.isQuietToday ? '已开启：今天先别打扰我（点此恢复）' : '今天先别打扰我'),
          h('button', {
            type: 'button',
            className: 'muse-btn-outline',
            onClick: () => onOpenBrief?.(true),
          }, '预览今天的第一份早报'),
          h('button', {
            type: 'button',
            className: 'muse-btn-link',
            onClick: () => onOpenWorkspacePicker?.(),
          }, '管理关注工作区'))),
      h('section', {className: 'muse-section'},
        h('div', {className: 'muse-section-head'},
          h('h3', {className: 'muse-section-title'}, 'iPhone 随身端 · DSH Dot iOS（零命令行直连）'),
          h('span', {className: 'muse-section-note'}, model.mobile?.paired ? '已配对 · 同 Wi-Fi / 5G 自动同步' : '支持扫码或 6 位动态配对码')),
        h('div', {className: 'muse-source-row muse-mobile-pair-row', 'data-muse-mobile-connection-row': true},
          h('div', {className: 'muse-hairline-main'},
            h('div', {className: 'muse-hairline-title'},
              h('span', {className: `muse-status-dot ${model.mobile?.paired ? 'ok' : 'info'}`, style: {display: 'inline-block', marginRight: 7, verticalAlign: 'middle'}}),
              model.mobile?.paired ? 'iPhone 随身端已配对' : '把电脑上的 Dot 装进 iPhone'),
            h('div', {className: 'muse-hairline-sub'}, model.mobile?.paired
              ? `配对设备数：${model.mobile?.pairedCount || 1} · 可随时查看新的 6 位配对码或扫码绑定新设备`
              : '不用记终端命令。点右侧按钮获取 6 位配对码或二维码，在 iPhone 打开 DSH Dot 即可连上。')),
          h('button', {
            type: 'button',
            className: 'muse-btn-outline',
            'data-muse-conn-mobile-pair': true,
            disabled: busy,
            onClick: () => onOpenMobilePair?.(true),
          }, model.mobile?.paired ? '查看 6 位码 / 扫码加设备' : '查看 6 位配对码 / 扫码连接'))),
      h('section', {className: 'muse-section'},
        h('div', {className: 'muse-section-head'},
          h('h3', {className: 'muse-section-title'}, '外部信息与工作台连接（按需只读，不主动全盘扫描）'),
          h('span', {className: 'muse-section-note'}, model.mode === 'synergy' ? 'SuperAgent 台账已挂载' : '未检测到 SuperAgent，独立运行')),
        ...model.connectionSources.map(src => h('div', {key: src.id, className: 'muse-source-row'},
          h('div', {className: 'muse-hairline-main'},
            h('div', {className: 'muse-hairline-title'}, src.name),
            h('div', {className: 'muse-hairline-sub'}, src.desc)),
          h('span', {className: 'muse-section-note'}, src.ready ? '已就绪' : src.enabled ? '已开启' : '未启用'))),
        renderConnectionsHost
          ? h('details', {className: 'muse-more-disclosure', open: !model.wechatConnected || undefined},
            h('summary', null, '展开账号授权、微信扫码与详细连接面板'),
            renderConnectionsHost())
          : null));
  }

  function MuseCapsule({
    draft,
    onDraft,
    mode,
    busy,
    conversationOpen,
    onToggleConversation,
    onSendChat,
    onSaveNote,
    onQueuePending,
    renderConversation,
  }) {
    const composing = React.useRef(false);
    const inputRef = React.useRef(null);

    const submit = async () => {
      const text = (draft || '').trim();
      if (!text || busy) return;
      onDraft?.('');
      await onSendChat?.(text);
    };

    const quickNote = async () => {
      const text = (draft || '').trim();
      if (!text || busy) return;
      onDraft?.('');
      await onSaveNote?.(text);
    };

    const queueBoard = async () => {
      const text = (draft || '').trim();
      if (!text || busy) return;
      onDraft?.('');
      await onQueuePending?.(text);
    };

    return h('div', {className: 'muse-capsule-dock'},
      conversationOpen
        ? h('section', {className: 'muse-drawer-sheet', 'data-muse-conversation-sheet': true, 'aria-label': '与 Dot 对话'},
          h('header', {className: 'muse-drawer-head'},
            h('span', null, '与 Dot 的原生会话 · 上下文保留在本机工作台'),
            h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onToggleConversation?.(false)}, '收起抽屉')),
          h('div', {className: 'muse-drawer-body'},
            renderConversation ? renderConversation() : h('p', {style: {padding: 16}}, '正在准备原生会话…')))
        : null,
      h('div', {className: 'muse-capsule', 'data-muse-capsule': true},
        h('button', {
          type: 'button',
          className: 'muse-capsule-toggle',
          'data-muse-capsule-toggle': true,
          onClick: () => onToggleConversation?.(!conversationOpen),
        }, conversationOpen ? '收起对话' : '对话'),
        h('input', {
          ref: inputRef,
          type: 'text',
          className: 'muse-capsule-input',
          'data-muse-capsule-input': true,
          value: draft || '',
          placeholder: '直接说一句，或交代 Dot 一件事…',
          onChange: event => onDraft?.(event.target.value),
          onCompositionStart: () => { composing.current = true; },
          onCompositionEnd: () => { composing.current = false; },
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              if (composing.current || event.nativeEvent?.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              void submit();
            }
          },
        }),
        (draft || '').trim()
          ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            disabled: busy,
            onClick: () => void quickNote(),
          }, '记进记忆')
          : null,
        mode === 'synergy' && (draft || '').trim()
          ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            'data-muse-queue-pending': true,
            disabled: busy,
            onClick: () => void queueBoard(),
          }, '入看板')
          : null,
        h('button', {
          type: 'button',
          className: 'muse-capsule-send',
          'data-muse-capsule-send': true,
          disabled: busy || !(draft || '').trim(),
          onClick: () => void submit(),
        }, '发送')));
  }

  function MuseWorkbench({
    model,
    tab = 'today',
    onTab,
    busy = false,
    feedback = null,
    undoBanner = null,
    onDismissUndo,
    onAction,
    onSaveDraft,
    onMuseAct,
    onPinFocus,
    onAsk,
    onOpenProject,
    onOpenWorkspacePicker,
    onOpenSettings,
    capsuleDraft = '',
    onCapsuleDraft,
    conversationOpen = false,
    onToggleConversation,
    onSendChat,
    renderConversation,
    renderConnectionsHost,
    briefOpen = false,
    onBriefOpen,
    mobilePairOpen = false,
    mobilePairData = null,
    mobilePairLoading = false,
    onOpenMobilePair,
    onRotateMobilePair,
  }) {
    const scrollRef = React.useRef(null);
    React.useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [tab]);

    return h('div', {className: 'pc_dot_muse', 'data-muse-root': true, 'data-muse-tab-active': tab},
      h(MuseTopbar, {
        tab,
        onTab,
        model,
        onOpenSettings,
        onOpenBrief: onBriefOpen,
        onOpenMobilePair,
      }),
      h('main', {ref: scrollRef, className: 'muse-scroll', 'data-muse-scroll': true},
        feedback
          ? h('div', {className: `${tab === 'today' ? 'muse-stage' : 'muse-stage-narrow'} muse-notice-line ${feedback.kind === 'error' ? '' : 'info'}`, role: 'status'},
            h('span', null, feedback.text),
            feedback.actionLabel && typeof feedback.onAction === 'function'
              ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => feedback.onAction()}, feedback.actionLabel)
              : null)
          : null,
        tab === 'today'
          ? h(MuseTodayView, {
            model,
            busy,
            onAction,
            onSaveDraft,
            onPinFocus,
            onAsk,
            onOpenProject,
            onOpenWorkspacePicker,
            onOpenTab: onTab,
          })
          : tab === 'threads'
            ? h(MuseThreadsView, {model, onAsk})
            : tab === 'memory'
              ? h(MuseMemoryView, {
                model,
                busy,
                undoBanner,
                onMuseAct,
                onDismissUndo,
                onAsk,
              })
              : h(MuseConnectionsView, {
                model,
                busy,
                onMuseAct,
                onOpenBrief: onBriefOpen,
                onOpenMobilePair,
                onOpenWorkspacePicker,
                renderConnectionsHost,
              })),
      h(MuseCapsule, {
        draft: capsuleDraft,
        onDraft: onCapsuleDraft,
        mode: model.mode,
        busy,
        conversationOpen,
        onToggleConversation,
        onSendChat,
        onSaveNote: text => onMuseAct?.({action: 'profile_add_note', text, category: 'note', source: 'desktop'}),
        onQueuePending: text => onMuseAct?.({action: 'superagent_pending', text, title: text.slice(0, 48)}),
        renderConversation,
      }),
      h(MuseBriefDialog, {
        open: briefOpen,
        model,
        onClose: () => onBriefOpen?.(false),
        onAsk,
      }),
      h(MuseMobilePairDialog, {
        open: mobilePairOpen,
        pair: mobilePairData,
        loading: mobilePairLoading,
        busy,
        onClose: () => onOpenMobilePair?.(false),
        onRotate: () => onRotateMobilePair?.(),
      }));
  }

  return {
    MuseWorkbench,
    MuseTopbar,
    MuseTodayView,
    MuseThreadsView,
    MuseMemoryView,
    MuseConnectionsView,
    MuseCapsule,
    MuseBriefDialog,
    MuseMobilePairDialog,
  };
}
