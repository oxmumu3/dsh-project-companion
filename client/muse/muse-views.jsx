/**
 * DSH Dot Muse desktop views.
 * Pure React.createElement components consuming `buildMuseViewModel`.
 */
import {MEMORY_BUCKETS, TRAIT_PRESETS} from './muse-model.js';

export function createMuseViews(React) {
  const h = React.createElement;

  function MuseTopbar({tab, onTab, model, onOpenSettings, onOpenBrief, onOpenMobilePair}) {
    const tabs = [
      {id: 'today', label: '今天'},
      {id: 'threads', label: model.v10 ? '在办' : '脉络'},
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

  function SessionStatus({session}) {
    return h('span', {className: `muse-session-status is-${session.status}`},
      h('span', {className: `muse-session-dot is-${session.status}`, 'aria-hidden': true}),
      session.statusLabel);
  }

  function PrebakeDismiss({session, busy, onMuseAct}) {
    return h('button', {
      type: 'button',
      className: 'muse-btn-link muse-dismiss',
      'data-muse-prebake-dismiss': session.id,
      'aria-label': `忽略预办：${session.title}`,
      disabled: busy,
      onClick: () => onMuseAct?.({action: 'dossier_act', id: session.id, operation: 'dismiss_prebake'}),
    }, '×');
  }

  function SessionFocus({session, busy, onOpenSession, onMuseAct}) {
    return h('article', {className: 'muse-focus-card muse-session-focus', 'data-muse-focus-card': 'session'},
      h('div', {className: 'muse-focus-meta'},
        h(SessionStatus, {session}),
        h('span', null, `工作区 ${session.workspaceTitle}`)),
      h('h2', {className: 'muse-focus-title'}, session.title),
      session.whyHere ? h('p', {className: 'muse-focus-body'}, session.whyHere) : null,
      h('div', {className: 'muse-focus-actions'},
        h('button', {
          type: 'button',
          className: 'muse-btn-link muse-session-detail',
          'data-muse-session-open': session.id,
          onClick: () => onOpenSession?.(session.id),
        }, [session.progressLabel, '查看详情 ›'].filter(Boolean).join(' · ')),
        session.status === 'prebake' ? h(PrebakeDismiss, {session, busy, onMuseAct}) : h('button', {
          type: 'button',
          className: 'muse-btn-outline muse-compact-button',
          'data-muse-session-complete': session.id,
          disabled: busy,
          onClick: () => onMuseAct?.({action: 'dossier_act', id: session.id, operation: 'complete'}),
        }, '办妥')));
  }

  function PrebakeDetail({session, busy, onClose, onMuseAct, onOpenSession}) {
    const dialog = React.useRef(null);
    React.useEffect(() => {
      if (typeof dialog.current?.showModal === 'function') dialog.current.showModal();
      else dialog.current?.setAttribute('open', '');
    }, []);
    const trigger = session.prebakeTrigger;
    const cost = Number.isFinite(trigger?.tokenCost) ? `${trigger.tokenCost.toLocaleString('zh-CN')} Token` : '';
    const metadata = [trigger?.source, trigger?.workspace && `工作区 ${trigger.workspace}`, cost].filter(Boolean);
    return h('dialog', {
      ref: dialog,
      className: 'muse-dialog muse-prebake-detail',
      'aria-labelledby': 'muse-prebake-title',
      'data-muse-prebake-detail': session.id,
      onCancel: event => { event.preventDefault(); onClose(); },
    },
    h('header', {className: 'muse-dialog-head'},
      h('div', null,
        h(SessionStatus, {session}),
        h('h2', {className: 'muse-dialog-title', id: 'muse-prebake-title'}, session.title),
        metadata.length ? h('p', {className: 'muse-sheet-sub muse-prebake-trigger'}, `触发于 ${metadata.join(' · ')}`) : null),
      h('button', {type: 'button', className: 'muse-btn-outline', onClick: onClose}, '关闭')),
    h('div', {className: 'muse-dialog-body'},
      session.whyHere ? h('p', null, session.whyHere) : null,
      session.checklist.length ? h('ul', {className: 'muse-prebake-checklist'},
        ...session.checklist.map((step, index) => h('li', {key: step.id ?? index},
          `${step.checked ? '✓ ' : '○ '}${step.text || step.title || step.label || ''}`))) : null,
      session.artifactMarkdown ? h('pre', {className: 'muse-prebake-draft'}, session.artifactMarkdown) : null),
    h('footer', {className: 'muse-dialog-foot'},
      h('button', {
        type: 'button', className: 'muse-btn-link', disabled: busy,
        onClick: async () => {
          const result = await onMuseAct?.({action: 'dossier_act', id: session.id, operation: 'dismiss_prebake'});
          if (result?.ok) onClose();
        },
      }, '忽略预办'),
      h('button', {
        type: 'button', className: 'muse-btn-primary', disabled: busy,
        'data-muse-prebake-adopt': session.id,
        onClick: async () => {
          const result = await onMuseAct?.({action: 'dossier_act', id: session.id, operation: 'adopt_prebake'});
          if (result?.ok) {
            onClose();
            onOpenSession?.(session.id);
          }
        },
      }, '继续对话 ›')));
  }

  const timelineIcons = {
    work: 'M2 4h4l1.5 1.5H12v6H2z',
    admin: 'M3.5 2h7v10l-1.8-1-1.7 1-1.8-1-1.7 1zM5.5 5h3M5.5 7.4h3',
    life: 'M2.7 5h8.6l.8 7H1.9zM4.8 5V4a2.2 2.2 0 0 1 4.4 0v1',
    birthday: 'M2 11.7h10V7.5H2zM7 7.5V5.3M7 3.8c-1.7 0-.8-1.8 0-2.3.8.5 1.7 2.3 0 2.3ZM2 9.3h10',
    note: 'M4 2.4h6v9.3L7 9.5l-3 2.2z',
  };

  function Stage4TimelineRow({row, onOpenSession, onAsk, busy}) {
    const [expanded, setExpanded] = React.useState(false);
    const icon = timelineIcons[row.iconCategory] || timelineIcons[row.kind === 'reminder' ? 'note' : 'work'];
    const group = row.groupedNames?.length > 1;
    const detail = group ? row.groupedNames.join('、') : row.subtitle || row.location || row.sourceLabel;
    const action = row.actionLabel && row.actionPrompt && !(row.kind === 'reminder' && row.iconCategory === 'life');
    return h('div', {className: 'muse-day-entry', 'data-muse-timeline-row': row.id},
      h('div', {className: 'muse-day-grid'},
        h('span', {className: `muse-day-time${row.overdue ? ' is-overdue' : ''}`}, row.timeLabel),
        h('svg', {viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.45, strokeLinejoin: 'round', strokeLinecap: 'round'},
        h('path', {d: icon})),
        h('div', {className: 'muse-day-title'}, row.title),
        h('div', {className: 'muse-day-action'}, action ? h('button', {
          type: 'button', className: 'muse-btn-link', disabled: busy, 'data-muse-timeline-action': row.id,
          onClick: () => onAsk?.(row.actionPrompt),
        }, h('span', {className: 'muse-session-dot is-ai-inline', 'aria-hidden': true}), row.actionLabel) : null),
        row.kind === 'reminder'
          ? h('span', {className: 'muse-day-terminal', role: 'img', 'aria-label': '未完成'}, h('span', {className: 'muse-day-ring'}))
          : row.linkedDossierId || detail ? h('button', {
            type: 'button', className: 'muse-btn-link muse-day-terminal',
            'aria-label': `${group ? '展开生日名单' : '查看日程'}：${row.title}`,
            'aria-expanded': row.linkedDossierId ? undefined : expanded,
            onClick: () => row.linkedDossierId ? onOpenSession?.(row.linkedDossierId) : setExpanded(!expanded),
          }, group ? (expanded ? '▾' : '▸') : '›') : h('span', {className: 'muse-day-terminal'})),
      expanded && detail ? h('p', {className: 'muse-hairline-sub muse-day-expanded'}, detail) : null);
  }

  function MuseTodayView({
    model,
    busy,
    onAction,
    onSaveDraft,
    onPinFocus,
    onAsk,
    onCarryPrompt,
    onOpenProject,
    onOpenSession,
    onOpenWorkspacePicker,
    onOpenTab,
    onMuseAct,
  }) {
    const visibleFolded = model.folded.slice(0, 3);
    const hiddenFolded = model.folded.slice(3);
    const eventCount = model.stage4Timeline?.filter(row => row.kind === 'event').length ?? model.events.length;
    const ordinaryCount = model.carouselCards.length - model.prebakeCount;
    const headlineCounts = [
      model.prebakeCount ? `${model.prebakeCount} 项预办` : '',
      eventCount ? `${eventCount} 场日程` : '',
      ordinaryCount ? `${ordinaryCount} 件在办` : '',
    ].filter(Boolean);

    return h('div', {className: 'muse-stage'},
      h('section', {className: 'muse-hero'},
        h('p', {className: 'muse-kicker'}, model.dateText),
        h('h1', {className: 'muse-greeting'},
          model.proactiveSettings || model.prebakeCount
            ? [`${model.greetingPrefix}，`,
              h('span', {key: 'prebakes', className: 'muse-today-prebakes'},
                model.prebakeCount ? h('span', {className: 'muse-session-dot is-prebake', 'aria-hidden': true}) : null,
                headlineCounts.join('，') || '今日清净。')]
            : model.greeting),
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
          model.focus?.session
            ? h(SessionFocus, {session: model.focus.session, busy, onOpenSession, onMuseAct})
            : h(FocusCard, {focus: model.focus, busy, onAction, onSaveDraft, onAsk}),
          model.folded.length > 0
            ? h('section', {className: 'muse-section', 'aria-label': '顺手排队的事项'},
              h('div', {className: 'muse-section-head'},
                h('h3', {className: 'muse-section-title'}, `排在后面的 ${model.folded.length} 件事`),
                h('span', {className: 'muse-section-note'}, '不抢桌面焦点，需要时点一下换上来')),
              ...visibleFolded.map(item => h('div', {key: item.key, className: 'muse-hairline-row', 'data-muse-folded': item.key},
                h('div', {className: 'muse-hairline-main'},
                  h('div', {className: 'muse-hairline-title'}, item.title),
                  h('div', {className: 'muse-hairline-sub muse-session-meta'},
                    item.session ? h(SessionStatus, {session: item.session}) : null,
                    `${item.sourceLabel}${item.timeText ? ` · ${item.timeText}` : ''}`)),
                h('div', {className: 'muse-hairline-actions'},
                  h('button', {
                    type: 'button', className: 'muse-btn-link',
                    onClick: () => model.prebakeCount && item.session ? onOpenSession?.(item.session.id) : onPinFocus?.(item.key),
                  }, model.prebakeCount && item.session ? '查看详情 ›' : '切到焦点'),
                  item.session?.status === 'prebake' ? h(PrebakeDismiss, {session: item.session, busy, onMuseAct}) : null,
                  item.askPrompt ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onAsk?.(item.askPrompt)}, '聊聊') : null))),
              hiddenFolded.length > 0
                ? h('details', {className: 'muse-more-disclosure'},
                  h('summary', null, `还有 ${hiddenFolded.length} 件安静收起的事项`),
                  ...hiddenFolded.map(item => h('div', {key: item.key, className: 'muse-hairline-row'},
                    h('div', {className: 'muse-hairline-main'},
                      h('div', {className: 'muse-hairline-title'}, item.title),
                      h('div', {className: 'muse-hairline-sub muse-session-meta'},
                        item.session ? h(SessionStatus, {session: item.session}) : null,
                        item.sourceLabel)),
                    h('div', {className: 'muse-hairline-actions'},
                      h('button', {
                        type: 'button', className: 'muse-btn-link',
                        onClick: () => model.prebakeCount && item.session ? onOpenSession?.(item.session.id) : onPinFocus?.(item.key),
                      }, model.prebakeCount && item.session ? '查看详情 ›' : '切到焦点'),
                      item.session?.status === 'prebake' ? h(PrebakeDismiss, {session: item.session, busy, onMuseAct}) : null))))
                : null)
            : null,
          model.proactiveSettings && model.carouselCards.length > 5
            ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenTab?.('threads')},
              `全部 ${model.carouselCards.length} 件 ›`) : null,
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
          model.stage4Timeline ? h('div', {className: 'muse-rail-group'},
            h('h3', {className: 'muse-rail-title'}, '日程与随手提醒'),
            model.stage4Timeline.length ? model.stage4Timeline.map(row => h(Stage4TimelineRow, {
              key: `${row.kind}:${row.id}`, row, busy, onOpenSession, onAsk: onCarryPrompt ?? onAsk,
            })) : h('p', {className: 'muse-rail-empty'},
              model.today.sourcesPhase === 'reading' ? '正在核对日程…' : '今天没有待处理的日程或随手提醒。')) : h('div', {className: 'muse-rail-group'},
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

  function SessionRow({session, busy, onOpenSession, onMuseAct, showWorkspace = false}) {
    return h('article', {className: 'muse-session-row', 'data-muse-session-id': session.id},
      h('button', {
        type: 'button',
        className: 'muse-session-open',
        'data-muse-session-open': session.id,
        onClick: () => onOpenSession?.(session.id),
      },
      h('span', {className: 'muse-session-meta'},
        h(SessionStatus, {session}),
        showWorkspace ? h('span', null, `工作区 ${session.workspaceTitle}`) : null,
        session.progressLabel ? h('span', null, session.progressLabel) : null),
      h('span', {className: 'muse-thread-title'}, session.title),
      session.whyHere ? h('span', {className: 'muse-thread-body muse-session-summary'}, session.whyHere) : null),
      session.status === 'prebake' ? h(PrebakeDismiss, {session, busy, onMuseAct}) : h('button', {
        type: 'button',
        className: `muse-compact-button ${session.archived ? 'muse-btn-link' : 'muse-btn-outline'}`,
        [session.archived ? 'data-muse-session-reopen' : 'data-muse-session-complete']: session.id,
        disabled: busy,
        onClick: () => onMuseAct?.({action: 'dossier_act', id: session.id, operation: session.archived ? 'reopen' : 'complete'}),
      }, session.archived ? '恢复' : '办结'));
  }

  function MuseSessionsView({model, busy, onMuseAct, onOpenSession}) {
    const counts = model.carouselCards.reduce((result, session) => {
      result[session.status] = (result[session.status] || 0) + 1;
      return result;
    }, {});
    const summary = [
      {status: 'wait', label: '待拍板'},
      {status: 'run', label: '跟进中'},
      {status: 'prebake', label: '预办'},
    ].filter(item => counts[item.status]);
    return h('div', {className: 'muse-stage-narrow'},
      h('section', {className: 'muse-hero'},
        h('h1', {className: 'muse-greeting'}, model.proactiveSettings ? 'Dot 在办，' : `眼下在办，${model.carouselCards.length} 个会话`),
        model.proactiveSettings && summary.length
          ? h('p', {className: 'muse-session-meta muse-status-overview'},
            ...summary.map(item => h(SessionStatus, {key: item.status, session: {...item, statusLabel: `${counts[item.status]} ${item.label}`}})))
          : null),
      model.sessionGroups.length
        ? model.sessionGroups.map(group => h('section', {key: group.workspaceTitle, className: 'muse-session-group'},
          h('h2', {className: 'muse-section-title'}, `工作区 ${group.workspaceTitle}`),
          ...group.items.map(session => h(SessionRow, {key: session.id, session, busy, onOpenSession, onMuseAct}))))
        : h('p', {className: 'muse-rail-empty'}, '眼下没有在办会话。'),
      h('details', {className: 'muse-more-disclosure', 'data-muse-session-archive': true},
        h('summary', null, `查看已办妥与全部历史会话（${model.archivedSessions.length}）`),
        model.archivedSessions.length
          ? model.archivedSessions.map(session => h(SessionRow, {
            key: session.id, session, busy, onOpenSession, onMuseAct, showWorkspace: true,
          }))
          : h('p', {className: 'muse-rail-empty'}, '还没有已办妥的会话。')));
  }

  function MuseThreadsView({model, onAsk, busy, onMuseAct, onOpenSession}) {
    const [filter, setFilter] = React.useState('all');
    if (model.v10) return h(MuseSessionsView, {model, busy, onMuseAct, onOpenSession});
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

  function MuseUndoBar({undoBanner, onMuseAct, onDismissUndo}) {
    const {token, message, kind} = undoBanner;
    return h('div', {className: 'muse-undo-bar', role: 'status', 'data-muse-undo-bar': true},
      h('span', null, message || '已更新。'),
      h('div', {className: 'muse-hairline-actions'},
        token ? h('button', {
          type: 'button',
          className: 'muse-btn-link',
          'data-muse-undo-btn': true,
          onClick: () => onMuseAct?.(kind === 'dossier'
            ? {action: 'dossier_undo', undoToken: token}
            : {action: 'profile_undo', token}),
        }, '撤回') : null,
        h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onDismissUndo?.()}, '知道了')));
  }

  function MemoryEvidence({item, busy, onMuseAct}) {
    const [draft, setDraft] = React.useState(null);
    const composing = React.useRef(false);
    const save = async event => {
      event.preventDefault();
      const text = draft?.trim();
      if (!text || busy || composing.current) return;
      const result = await onMuseAct?.({action: 'memory_item', id: item.id, text});
      if (result?.ok) setDraft(null);
    };
    return h('details', {className: 'muse-memory-evidence', 'data-muse-note-id': item.id},
      h('summary', {className: item.active === false ? 'muse-memory-paused' : undefined},
        h('span', {className: 'muse-memory-text'}, item.text),
        item.tagBadge ? h('span', {className: 'muse-memory-badge'},
          h('span', {className: 'muse-session-dot is-ai-inline', 'aria-hidden': true}), item.tagBadge) : null,
        item.active === false ? h('span', {className: 'muse-section-note'}, '已暂停') : null),
      h('div', {className: 'muse-memory-proof'},
        item.quote ? h('blockquote', null, item.quote) : null,
        h('p', {className: 'muse-hairline-sub'},
          [item.quoteSource || item.provenance, item.quotedInVerified ? '已核对原话' : ''].filter(Boolean).join(' · ')),
        item.replacedOld ? h('p', {className: 'muse-hairline-sub'}, `此前记的是：${item.replacedOld}`) : null,
        item.effect ? h('p', {className: 'muse-hairline-sub'}, item.effect) : null,
        h('div', {className: 'muse-focus-actions'},
          h('button', {
            type: 'button', className: 'muse-btn-outline muse-compact-button',
            'data-muse-memory-toggle': item.id, disabled: busy,
            onClick: () => onMuseAct?.({action: 'memory_item', id: item.id, active: item.active === false}),
          }, item.active === false ? '恢复生效' : '暂停生效'),
          h('button', {
            type: 'button', className: 'muse-btn-link',
            onClick: () => setDraft(item.text),
            'aria-expanded': draft !== null,
          }, '开口改一句'),
          h('button', {
            type: 'button', className: 'muse-btn-link danger',
            'data-muse-note-delete': item.id, disabled: busy,
            onClick: () => onMuseAct?.({action: 'memory_item', id: item.id, remove: true}),
          }, '彻底忘掉')),
        draft !== null ? h('form', {className: 'muse-note-composer muse-memory-edit', onSubmit: save},
          h('input', {
            className: 'muse-input', type: 'text', value: draft, autoFocus: true, maxLength: 240,
            'aria-label': '改写这条记忆',
            onChange: event => setDraft(event.target.value),
            onCompositionStart: () => { composing.current = true; },
            onCompositionEnd: () => { composing.current = false; },
            onKeyDown: event => {
              if (event.key === 'Enter' && (composing.current || event.nativeEvent?.isComposing || event.keyCode === 229)) {
                event.preventDefault();
              }
            },
          }),
          h('button', {type: 'submit', className: 'muse-btn-primary', disabled: busy || !draft.trim()}, '保存'),
          h('button', {type: 'button', className: 'muse-btn-outline', onClick: () => setDraft(null)}, '取消')) : null));
  }

  function MemoryLedger({model, busy, onMuseAct}) {
    const flomo = model.connectorGroups.find(group => group.id === 'external_apps')?.items.find(row => row.id === 'flomo');
    const digestCompleted = ['sent', 'quiet'].includes(model.digest.lastStatus);
    const existingItems = model.stage4Memory ? model.legacyMemoryItems : model.memoryItems;
    const existingRows = existingItems.map(item => h('article', {
      key: item.id, className: 'muse-hairline-row', 'data-muse-note-id': item.id,
    },
      h('button', {
        type: 'button',
        className: `muse-session-open${item.active === false ? ' muse-memory-paused' : ''}`,
        'data-muse-memory-toggle': item.id,
        'aria-pressed': item.active !== false,
        disabled: busy,
        onClick: () => onMuseAct?.({action: 'memory_item', id: item.id, active: item.active === false}),
      },
      h('span', {className: 'muse-memory-text'}, item.text),
      h('span', {className: 'muse-hairline-sub'}, [item.provenance, item.effect, item.active === false ? '已暂停' : ''].filter(Boolean).join(' · '))),
      h('button', {
        type: 'button', className: 'muse-btn-link danger', 'data-muse-note-delete': item.id,
        disabled: busy, onClick: () => onMuseAct?.({action: 'memory_item', id: item.id, remove: true}),
      }, '忘掉')));
    return [
      model.stage4Memory ? h('section', {key: 'stage4-memory', className: 'muse-section'},
        h('div', {className: 'muse-section-head'},
          h('h2', {className: 'muse-section-title'}, '活体记忆'),
          h('span', {className: 'muse-memory-budget', 'data-muse-memory-budget': true},
            model.memoryBytes === null ? '4 KB' : `${(model.memoryBytes / 1024).toFixed(1)} / 4 KB`)),
        ...model.memoryGroups.map(group => h('section', {key: group.id, className: 'muse-memory-bucket', 'data-muse-memory-group': group.id},
          h('h3', {className: 'muse-trait-group-title'}, group.label),
          group.items.length
            ? group.items.map(item => h(MemoryEvidence, {key: item.id, item, busy, onMuseAct}))
            : h('p', {className: 'muse-rail-empty'}, '暂未记下。')))) : null,
      h('section', {key: 'routines', className: 'muse-section'},
        h('h2', {className: 'muse-section-title'}, '动态例行与守候'),
        model.routines.length
          ? model.routines.map(routine => h('article', {key: routine.id, className: 'muse-hairline-row', 'data-muse-routine-id': routine.id},
            h('div', {className: 'muse-hairline-main'},
              h('h3', {className: 'muse-memory-text'}, routine.title),
              h('p', {className: 'muse-hairline-sub'}, [routine.scheduleLabel, routine.instruction || routine.summary].filter(Boolean).join(' · ')),
              routine.lastReceipt
                ? h('p', {className: `muse-routine-receipt${routine.id === 'daily-digest' && digestCompleted ? ' is-done' : ''}`},
                  routine.id === 'daily-digest' && digestCompleted ? `✓ ${routine.lastReceipt}` : routine.lastReceipt)
                : null),
            h('div', {className: 'muse-hairline-actions'},
              h('button', {
                type: 'button',
                className: 'muse-btn-outline muse-compact-button',
                'data-muse-routine-toggle': routine.id,
                'aria-pressed': routine.active === true,
                disabled: busy,
                onClick: () => onMuseAct?.({action: 'routine_toggle', id: routine.id, active: !routine.active}),
              }, routine.active ? '守候中' : '已暂停'))))
          : h('p', {className: 'muse-rail-empty'}, '还没有设定例行。')),
      existingRows.length || flomo?.enabled && flomo.connected || !model.stage4Memory
        ? h('section', {key: 'memory', className: 'muse-section'},
        h('div', {className: 'muse-section-head'},
          h('h2', {className: 'muse-section-title'}, model.stage4Memory ? '其他来源记忆' : '对话与工作区沉淀的记忆'),
          flomo?.enabled && flomo.connected ? h('button', {
            type: 'button',
            className: 'muse-btn-link',
            disabled: busy,
            onClick: () => onMuseAct?.({action: 'flomo_memory_refresh'}),
          }, '取回最近的 flomo 笔记') : null),
        existingRows.length ? existingRows : h('p', {className: 'muse-rail-empty'}, '在上方记下一条偏好或分寸。')) : null,
    ];
  }

  function MuseMemoryView({model, busy, undoBanner, onMuseAct, onDismissUndo, onAsk}) {
    const [noteDraft, setNoteDraft] = React.useState('');
    const [memoryCategory, setMemoryCategory] = React.useState(null);
    const category = memoryCategory ?? (model.stage4Memory ? 'working_style' : 'preference');
    const [alsoQueue, setAlsoQueue] = React.useState(false);
    const [editingCat, setEditingCat] = React.useState(null);
    const [editingTraitId, setEditingTraitId] = React.useState(null);
    const [traitLabel, setTraitLabel] = React.useState('');
    const [traitValue, setTraitValue] = React.useState('');
    const composing = React.useRef(false);

    const submitNote = async () => {
      const text = noteDraft.trim();
      if (!text || busy) return;
      const result = await onMuseAct?.(model.memoryItems
        ? {action: 'memory_item', text, category, sourceKind: 'manual'}
        : {action: 'profile_add_note', text, category: 'note', source: 'desktop'});
      if (result?.ok === false || result === null) return;
      setNoteDraft(current => current === noteDraft ? '' : current);
      if (alsoQueue && model.mode === 'synergy') {
        await onMuseAct?.({action: 'superagent_pending', text, title: text.slice(0, 48)});
      }
    };

    const startEdit = (category, existing = null) => {
      setEditingCat(category);
      setEditingTraitId(existing?.id ?? null);
      setTraitLabel(existing?.label || (category === 'rhythm' ? '作息节律' : category === 'tone' ? '沟通语气' : category === 'focus' ? '当前重心' : '顺手偏好'));
      setTraitValue(existing?.value || '');
    };

    const saveTrait = async category => {
      const label = traitLabel.trim();
      const value = traitValue.trim();
      if (!label || !value || busy) return;
      setEditingCat(null);
      await onMuseAct?.({action: 'profile_set_trait', ...(editingTraitId ? {id: editingTraitId} : {}), category, label, value});
    };

    return h('div', {className: 'muse-stage-narrow'},
      undoBanner ? h(MuseUndoBar, {undoBanner, onMuseAct, onDismissUndo}) : null,
      h('article', {className: 'muse-portrait-sheet'},
        h('header', {className: 'muse-sheet-header'},
          h('h1', {className: 'muse-sheet-title'}, model.stage4Memory ? '关于你，' : model.memoryItems
            ? `关于你，记着 ${model.memoryItems.length} 条记忆与 ${model.routines.length} 项例行`
            : '关于你 · 个人记忆侧写'),
          model.stage4Memory ? h('p', {className: 'muse-sheet-sub'},
            `有了 ${model.memoryGroups.reduce((count, group) => count + group.items.length, 0)} 条活记忆与 ${model.routines.length} 项守候。`) : null,
          !model.memoryItems ? h('p', {className: 'muse-sheet-sub'}, '随时改写或忘掉已经记下的偏好、节律与随记。') : null),
        h('div', {className: 'muse-note-composer'},
          model.memoryItems ? h('select', {
            className: 'muse-inline-select',
            'aria-label': '记忆类型',
            value: category,
            disabled: busy,
            onChange: event => setMemoryCategory(event.target.value),
          },
          ...(model.stage4Memory ? MEMORY_BUCKETS : [
            {id: 'preference', label: '偏好'}, {id: 'boundary', label: '分寸'}, {id: 'note', label: '随记'},
          ]).map(item => h('option', {key: item.id, value: item.id}, item.label))) : null,
          h('input', {
            type: 'text',
            className: 'muse-input',
            value: noteDraft,
            'data-muse-note-input': true,
            'aria-label': '记下一条偏好或随记',
            placeholder: model.memoryItems ? '顺口记一条偏好或分寸…' : '顺口记下一句话，比如：下周三出差一天，上午别排深思考任务…',
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
        model.memoryItems ? h(MemoryLedger, {model, busy, onMuseAct}) : null,
        h(model.memoryItems ? 'details' : 'div', {className: model.memoryItems ? 'muse-more-disclosure' : undefined},
        model.memoryItems ? h('summary', null, '编辑分类偏好') : null,
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
          : null),
        !model.memoryItems ? h('section', {className: 'muse-section'},
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
            : h('p', {className: 'muse-rail-empty'}, '在上方输入一句行程、心情或边界规则，Dot 会记住。')) : null,
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
    const times = [...new Set(['07:30', '08:00', '08:30', '09:00', '10:00', '12:30', '18:00', '21:00', model.digest.dailyTime])].sort();
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

    const macConnected = model.connectorGroups[0].items.find(row => row.id === 'mac_bridge')?.connected === true;
    const paired = model.mobile?.paired === true;
    const pairCount = model.mobile?.pairedCount || 1;
    const modeOptions = [
      {id: 'full_local', label: '已授权目录内的工作背景'},
      {id: 'curated_only', label: '工作区记忆文件'},
    ];
    const renderRow = row => h('div', {key: row.id, className: 'muse-source-row', 'data-muse-connector': row.id},
      h('div', {className: 'muse-hairline-main'},
        h('div', {className: 'muse-hairline-title'}, row.title),
        row.id === 'workspace_grants' && model.mountedWorkspaces.length > 0
          ? h('p', {className: 'muse-hairline-sub'}, `已授权 ${model.mountedWorkspaces.join(' · ')}`)
          : row.subtitle ? h('p', {className: 'muse-hairline-sub'}, row.subtitle) : null,
        row.boundaryNote ? h('p', {className: 'muse-hairline-sub'}, row.boundaryNote) : null,
        row.id === 'workspace_grants' ? h('div', {className: 'muse-hairline-actions muse-context-modes'},
          ...modeOptions.map(option => h('button', {
            key: option.id,
            type: 'button',
            className: model.contextMode === option.id ? 'muse-chip active' : 'muse-chip',
            'aria-pressed': model.contextMode === option.id,
            'data-muse-context-mode': option.id,
            disabled: busy || row.canToggle !== true || model.contextMode === option.id,
            onClick: () => onMuseAct?.({action: 'connector_toggle', id: row.id, contextMode: option.id}),
          }, option.label))) : null),
      row.canToggle === true && row.group !== 'iphone_system' && row.id !== 'workspace_grants'
        ? h('button', {
          type: 'button',
          className: 'muse-btn-outline muse-compact-button',
          'data-muse-connector-toggle': row.id,
          'aria-label': `${row.enabled ? '停用' : '启用'} ${row.title}`,
          'aria-pressed': row.enabled === true,
          disabled: busy,
          onClick: () => onMuseAct?.({action: 'connector_toggle', id: row.id, enabled: !row.enabled}),
        }, row.statusText || (row.enabled ? '已开启' : '未启用'))
        : h('span', {className: 'muse-section-note'}, row.statusText || (row.enabled ? '已开启' : row.known ? '未启用' : '在 iPhone 查看')));

    return h('div', {className: 'muse-stage-narrow'},
      h('section', {className: 'muse-hero'},
        h('div', {className: 'muse-connector-heading'},
          h('h1', {className: 'muse-greeting'}, model.proactiveSettings ? '连接边界，' : '连接'),
          h('span', {className: 'muse-section-note muse-session-meta'},
            h('span', {className: `muse-session-dot ${macConnected ? 'is-done' : 'is-quiet'}`, 'aria-hidden': true}),
            `Mac ${macConnected ? '已连接' : '未连接'} · 已开 ${model.connectorEnabledCount}/${model.connectorTotalCount} 项`)),
        model.proactiveSettings ? h('p', {className: 'muse-subline'}, '只连你点头的来源，两边都能管。') : null),
      model.proactiveSettings ? h('section', {className: 'muse-rhythm-sheet muse-proactive-settings', 'aria-label': '主动巡检'},
        h('h2', {className: 'muse-sheet-title'}, '主动巡检'),
        h('div', {className: 'muse-proactive-controls'},
          h('label', null, '巡检频率',
            h('select', {
              className: 'muse-inline-select', 'data-muse-proactive-cadence': true,
              value: model.proactiveSettings.cadence, disabled: busy,
              onChange: event => onMuseAct?.({action: 'proactive_settings_update', cadence: event.target.value}),
            },
              h('option', {value: '10m'}, '每 10 分钟'),
              h('option', {value: 'twice_daily'}, '早晚各一次'),
              h('option', {value: 'off'}, '暂停主动巡检'))),
          h('label', null,
            h('input', {
              type: 'checkbox', 'data-muse-proactive-prebake': true,
              checked: model.proactiveSettings.autoPrebake === true, disabled: busy,
              onChange: event => onMuseAct?.({action: 'proactive_settings_update', autoPrebake: event.target.checked}),
            }), '自动预办')),
        h('div', {className: 'muse-focus-actions'},
          h('button', {
            type: 'button', className: 'muse-btn-link', disabled: busy,
            'data-muse-proactive-dream': true,
            onClick: () => onMuseAct?.({action: 'proactive_dream_run', force: true}),
          }, '现在复盘提醒分寸'),
          model.lastDreamAt ? h('time', {className: 'muse-section-note', dateTime: model.lastDreamAt},
            `最近复盘 ${new Date(model.lastDreamAt).toLocaleString('zh-CN', {dateStyle: 'short', timeStyle: 'short'})}`) : null)) : null,
      h('article', {className: 'muse-rhythm-sheet', 'data-muse-rhythm-sheet': true},
        h('header', {className: 'muse-sheet-header'},
          h('h2', {className: 'muse-sheet-title'}, '守候与打扰分寸')),
        h('div', {className: 'muse-madlib'},
          '每天早上 ',
          h('select', {
            className: 'muse-inline-select',
            'aria-label': '每日早报时间',
            'data-muse-rhythm-time': true,
            disabled: busy,
            value: model.digest.dailyTime,
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
          }, '预览今天的早报'))),
      ...model.connectorGroups.map(group => h('section', {
        key: group.id, className: 'muse-section', 'data-muse-connector-group': group.id,
      },
      h('div', {className: 'muse-section-head'},
        h('h2', {className: 'muse-section-title'}, group.title),
        group.id === 'mac_base'
          ? h('button', {type: 'button', className: 'muse-btn-link', onClick: () => onOpenWorkspacePicker?.()}, '管理关注工作区')
          : null),
      group.id === 'iphone_system'
        ? h('div', {className: 'muse-source-row muse-mobile-pair-row', 'data-muse-mobile-connection-row': true},
          h('div', {className: 'muse-hairline-main'},
            h('div', {className: 'muse-hairline-title'}, paired ? `已配对 ${pairCount} 台 iPhone` : 'iPhone 尚未配对'),
            h('div', {className: 'muse-hairline-sub'}, '系统权限在 iPhone 上管理，原始数据留在手机。')),
          h('button', {
            type: 'button',
            className: 'muse-btn-outline',
            'data-muse-conn-mobile-pair': true,
            disabled: busy,
            onClick: () => onOpenMobilePair?.(true),
          }, paired ? '添加设备' : '获取配对码')) : null,
      ...group.items.map(renderRow),
      group.id === 'external_apps' && renderConnectionsHost
        ? h('details', {className: 'muse-more-disclosure'},
          h('summary', null, '管理账号授权与微信扫码'),
          renderConnectionsHost())
        : null)));
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
    liveInsight,
    onMuseAct,
    onCarryInsight,
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
      liveInsight && !conversationOpen && !(draft || '').trim() ? h('section', {
        className: 'muse-whisper-tray', 'data-muse-live-insight': liveInsight.id, 'aria-label': '参谋轻提醒',
      },
      h('div', {className: 'muse-whisper-copy'},
        h('div', {className: 'muse-whisper-label'},
          h('span', {className: 'muse-session-dot is-prebake', 'aria-hidden': true}),
          h('span', null, liveInsight.title || '参谋轻提醒')),
        h('p', null, liveInsight.eyebrow || liveInsight.prompt)),
      h('button', {
        type: 'button', className: 'muse-btn-link muse-whisper-carry', disabled: busy,
        'data-muse-insight-carry': liveInsight.id,
        onClick: async () => {
          const result = await onMuseAct?.({action: 'proactive_insight_act', id: liveInsight.id, operation: 'mark_read'});
          if (result?.ok) onCarryInsight?.(liveInsight.prompt);
        },
      }, '带进对话 ›'),
      h('button', {
        type: 'button', className: 'muse-btn-link muse-dismiss', disabled: busy,
        'aria-label': '忽略这条轻提醒', 'data-muse-insight-dismiss': liveInsight.id,
        onClick: () => onMuseAct?.({action: 'proactive_insight_act', id: liveInsight.id, operation: 'dismiss'}),
      }, '×')) : h('div', {className: 'muse-capsule', 'data-muse-capsule': true},
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
    onOpenSession,
    onOpenWorkspacePicker,
    onOpenSettings,
    capsuleDraft = '',
    onCapsuleDraft,
    conversationOpen = false,
    onToggleConversation,
    onSendChat,
    onCarryInsight,
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
    const [prebakeDetailId, setPrebakeDetailId] = React.useState(null);
    const prebakeDetail = model.carouselCards.find(item => item.id === prebakeDetailId && item.status === 'prebake');
    const selectSession = id => {
      if (model.carouselCards.some(item => item.id === id && item.status === 'prebake')) setPrebakeDetailId(id);
      else onOpenSession?.(id);
    };
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
        undoBanner && tab !== 'memory'
          ? h('div', {className: 'muse-stage-narrow'}, h(MuseUndoBar, {undoBanner, onMuseAct, onDismissUndo}))
          : null,
        tab === 'today'
          ? h(MuseTodayView, {
            model,
            busy,
            onAction,
            onSaveDraft,
            onPinFocus,
            onAsk,
            onCarryPrompt: onCarryInsight,
            onOpenProject,
            onOpenSession: selectSession,
            onMuseAct,
            onOpenWorkspacePicker,
            onOpenTab: onTab,
          })
          : tab === 'threads'
            ? h(MuseThreadsView, {model, onAsk, busy, onMuseAct, onOpenSession: selectSession})
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
        liveInsight: model.liveInsight,
        onMuseAct,
        onCarryInsight: onCarryInsight ?? onAsk,
        onSaveNote: text => onMuseAct?.({action: 'profile_add_note', text, category: 'note', source: 'desktop'}),
        onQueuePending: text => onMuseAct?.({action: 'superagent_pending', text, title: text.slice(0, 48)}),
        renderConversation,
      }),
      prebakeDetail ? h(PrebakeDetail, {
        key: prebakeDetail.id, session: prebakeDetail, busy, onMuseAct, onOpenSession,
        onClose: () => setPrebakeDetailId(null),
      }) : null,
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
