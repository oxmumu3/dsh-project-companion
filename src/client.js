/* Client half: reuse the official settings shell and the upstream QR viewer. */
window.__ModuleLoader__.load({
  id:'dsh-project-companion',
  factory:require=>{
    const React=require('react');
    const {Modal,SettingsForm,SettingsSecretField,SettingsValueField}=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement;
    const endpoint='/api/project_companion/onboarding';
    const inject=['slots','uiWorkspace','configForms','layout','sessions'];
    const css=`.pc_setup{display:flex;flex-direction:column;gap:18px;padding:0 24px 24px;line-height:1.6}.pc_setup h2,.pc_setup h3,.pc_setup p{margin:0}.pc_setup h2{font-size:21px;font-weight:600}.pc_setup h3{font-size:15px;font-weight:600}.pc_setup .pc_card{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.25));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}.pc_setup .pc_muted{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}.pc_setup .pc_actions{display:flex;gap:10px;flex-wrap:wrap}.pc_setup button{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.4));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:8px 14px;cursor:pointer}.pc_setup button:disabled{opacity:.5;cursor:default}.pc_setup button.pc_primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:white}.pc_setup button:focus-visible,.pc_setup input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px}.pc_setup label{display:flex;gap:10px;align-items:flex-start;font-size:14px}.pc_setup input{margin-top:5px}.pc_setup .pc_brief{white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere}.pc_setup .pc_error{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:13px}.pc_setup img{width:200px;height:200px;max-width:100%;align-self:center}.pc_setup .pc_connect_heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.pc_setup .pc_connect_heading h2{margin-bottom:4px}.pc_setup .pc_connect_row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2))}.pc_setup .pc_connect_row>div{min-width:0}.pc_setup .pc_connect_row button{flex-shrink:0}.pc_setup .pc_connect_status{font-size:12px;margin-top:4px}.pc_setup .pc_connect_badge{font-size:11px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));border-radius:20px;white-space:nowrap}.pc_setup .pc_google_connect{background:var(--dsw-alias-bg-layer-2,transparent)}.pc_setup .pc_connect_help{font-size:13px;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));padding-top:12px}.pc_setup .pc_connect_help summary{cursor:pointer}.pc_setup .pc_connect_help p{margin:10px 0}.pc_setup .pc_connect_authorizing,.pc_setup .pc_connect_notice{padding:12px 14px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.07));border-radius:8px;font-size:13px;overflow-wrap:anywhere}.pc_setup .pc_connect_authorizing a{color:var(--dsw-alias-state-business-primary,#4176e6);display:inline-block;margin-top:8px}.pc_setup_modal{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px 0 0}.pc_setup_modal .pc_setup{padding-top:0}@media(max-width:560px){.pc_setup .pc_connect_heading,.pc_setup .pc_connect_row{align-items:flex-start;flex-direction:column;gap:8px}.pc_setup .pc_connect_row{padding:14px 0}.pc_setup{padding:0 16px 20px}.pc_setup .pc_actions button{flex:1}}`;

    // Public ui-theme token pairs form one disposable layer. The font token is
    // presented after persistent font variables, so removing this layer restores
    // the user's own preference without writing to the ui-theme namespace.
    const dotFont='-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif';
    const dotAppearanceTokens={
      '--dsw-font-family':{light:dotFont,dark:dotFont},
      '--dsw-alias-bg-base':{light:'#f5f3ee',dark:'#17191c'},
      '--dsw-alias-bg-layer-1':{light:'#eeece6',dark:'#202328'},
      '--dsw-alias-bg-layer-2':{light:'#fffdf8',dark:'#272b31'},
      '--dsw-alias-bg-layer-3':{light:'#ffffff',dark:'#30363d'},
      '--dsw-alias-bg-module-platform':{light:'#eeece6',dark:'#202328'},
      '--dsw-alias-label-primary':{light:'#222b35',dark:'#e7ebf0'},
      '--dsw-alias-label-secondary':{light:'#5c6672',dark:'#aab4c1'},
      '--dsw-alias-label-tertiary':{light:'#747d88',dark:'#83909f'},
      '--dsw-alias-label-caption':{light:'#9098a2',dark:'#6d7887'},
      '--dsw-alias-border-l1':{light:'rgba(44,55,68,.22)',dark:'rgba(207,219,235,.24)'},
      '--dsw-alias-border-l2':{light:'rgba(44,55,68,.16)',dark:'rgba(207,219,235,.18)'},
      '--dsw-alias-border-l3':{light:'rgba(44,55,68,.12)',dark:'rgba(207,219,235,.14)'},
      '--dsw-alias-border-l4':{light:'rgba(44,55,68,.08)',dark:'rgba(207,219,235,.10)'},
      '--dsw-alias-interactive-bg-hover':{light:'rgba(48,63,79,.06)',dark:'rgba(190,207,230,.08)'},
      '--dsw-alias-interactive-bg-active':{light:'rgba(65,118,230,.12)',dark:'rgba(122,170,255,.16)'},
      '--dsw-alias-state-business-primary':{light:'#4176e6',dark:'#7aaaff'},
      '--dsw-radius-xs':{light:'4px',dark:'4px'},
      '--dsw-radius-sm':{light:'8px',dark:'8px'},
      '--dsw-radius-md':{light:'12px',dark:'12px'},
      '--dsw-radius-lg':{light:'16px',dark:'16px'},
      '--dsw-radius-xl':{light:'20px',dark:'20px'},
      '--dsw-radius-panel':{light:'24px',dark:'24px'},
    };

    function createDotAppearance(ctx){
      const listeners=new Set();
      let form,theme,offForm,releaseLayer,pending;
      let closed=false,saving=false,themeFailed=false,restorationUncertain=false,error='';
      let saved={ready:false,writable:false,revision:undefined,mode:'native'};
      let state=Object.freeze({mode:'native',applied:false,available:false,writable:false,busy:false,restorationUncertain:false,error:''});
      const optional=name=>{try{return(typeof ctx.get==='function'?ctx.get(name,false):undefined)??ctx[name];}catch{return undefined;}};
      const notify=next=>{
        if(closed)return;
        if(Object.keys(next).every(key=>state[key]===next[key]))return;
        state=Object.freeze(next);
        for(const fn of [...listeners]){try{fn();}catch{}}
      };
      const release=()=>{
        if(typeof releaseLayer!=='function')return;
        try{
          releaseLayer();releaseLayer=undefined;
          if(restorationUncertain)error='';
          restorationUncertain=false;
        }catch{restorationUncertain=true;error='原生外观恢复结果未确认，请重试恢复；若仍失败，请重新加载此页。';}
      };
      const supported=()=>Boolean(form&&typeof form.getSnapshot==='function'&&typeof form.subscribe==='function'&&typeof form.mutate==='function'&&typeof theme?.overrideTokens==='function');
      const publish=()=>notify({
        mode:releaseLayer?'dot':'native',applied:Boolean(releaseLayer),
        available:supported()&&!themeFailed&&saved.ready,
        writable:supported()&&!themeFailed&&saved.ready&&saved.writable,
        busy:saving,restorationUncertain,error,
      });
      const sync=(clearError=false)=>{
        if(closed)return;
        if(clearError&&!themeFailed&&!restorationUncertain)error='';
        try{
          const view=form?.getSnapshot();
          saved={ready:view?.status==='ready',writable:view?.writable===true&&view?.revision!==undefined&&view?.revision!==null,revision:view?.revision,mode:view?.value?.dotAppearance==='dot'?'dot':'native'};
        }catch{saved={ready:false,writable:false,revision:undefined,mode:'native'};error='外观配置暂不可用，请稍后重试。';}
        if(!supported()||!saved.ready||saved.mode==='native'){
          release();
          if(saved.mode==='native'){themeFailed=false;if(clearError&&!restorationUncertain)error='';}
          if(!supported()&&!restorationUncertain)error='当前宿主暂不支持 Dot 外观设置。';
        }else if(!releaseLayer&&!themeFailed){
          try{
            const dispose=theme.overrideTokens('dsh-project-companion',dotAppearanceTokens);
            if(typeof dispose!=='function')throw new Error('missing theme disposer');
            releaseLayer=dispose;
          }catch{themeFailed=true;error='Dot 外观暂不可用，已保留原生外观。';}
        }
        publish();
      };
      try{theme=optional('theme');form=optional('configForms')?.get('project-companion');}catch{}
      if(supported()){
        try{offForm=form.subscribe(()=>sync(true));}catch{form=undefined;}
      }
      sync();
      const setAppearance=mode=>{
        if(closed||!['native','dot'].includes(mode))return Promise.resolve(false);
        if(saving)return pending??Promise.resolve(false);
        if(mode==='native'&&saved.mode==='native'&&releaseLayer){sync(true);return Promise.resolve(!releaseLayer);}
        if(!state.writable||!saved.ready||saved.mode===mode)return Promise.resolve(false);
        const revision=saved.revision;
        saving=true;error='';publish();
        pending=(async()=>{
          try{
            const accepted=await form.mutate([{op:'set',path:['dotAppearance'],value:mode}],revision);
            if(closed)return false;
            if(accepted!==true){error='外观设置未保存，请刷新后重试。';return false;}
            // Acceptance alone is not a mode echo: read the official snapshot.
            sync();return true;
          }catch{
            if(!closed)error='外观设置未保存，请刷新后重试。';
            return false;
          }finally{
            saving=false;pending=undefined;
            if(!closed)sync();
          }
        })();
        return pending;
      };
      const close=()=>{
        if(!closed){
          closed=true;saving=false;
          try{offForm?.();}catch{}
          offForm=undefined;listeners.clear();
        }
        release();
        state=Object.freeze({...state,mode:releaseLayer?'dot':'native',applied:Boolean(releaseLayer),available:false,writable:false,busy:false,restorationUncertain,error});
      };
      return{getSnapshot:()=>state,subscribe:fn=>{if(closed||typeof fn!=='function')return()=>{};listeners.add(fn);return()=>listeners.delete(fn);},setAppearance,close};
    }

    async function prepareDotDraft(ctx,sessionId,prompt,signal){
      const optional=name=>{try{return ctx[name]??ctx.get?.(name,false);}catch{return undefined;}};
      const sessions=optional('sessions');
      if(typeof sessionId!=='string'||!sessionId||typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw new Error('请先写一句要交代的事。');
      if(typeof sessions?.retain!=='function'||typeof ctx.uiWorkspace?.openSession!=='function')throw new Error('当前宿主的原生会话入口不可用，请打开 Dot 会话继续。');
      signal?.throwIfAborted?.();
      const reference=sessions.retain(sessionId,{source:'controllerOperation',...(signal?{signal}:{})});
      try{
        await reference.ready;signal?.throwIfAborted?.();
        const binding=reference.binding;
        if(binding?.sessionId!==sessionId||typeof sessions.binding==='function'&&sessions.binding(sessionId)!==binding)throw new Error('Dot 会话已变化，未放入草稿。');
        const scope=binding.ctx??sessions.scope?.(sessionId);
        const conversation=scope?.get?.('conversation',false);
        if(typeof conversation?.input?.requestDraftInitialization!=='function')throw new Error('目标会话的原生草稿服务尚未就绪，请在 Dot 会话核对。');
        const status=conversation.input.requestDraftInitialization(binding,{prompt,clearPreviousDraft:false});
        if(status==='blocked')throw new Error('Dot 会话正在提交或草稿暂不可用；未自动重试。');
        if(status!=='applied'&&status!=='preserved')throw new Error('原生草稿状态未知，请在 Dot 会话核对。');
        if(status==='preserved')return{status};
        await ctx.uiWorkspace.openSession(sessionId);signal?.throwIfAborted?.();ctx.layout?.selectPanel?.(null);
        return{status};
      }finally{reference.release();}
    }

    function apply(ctx){
      const appearance=createDotAppearance(ctx);
      ctx.effect(()=>()=>appearance.close());
      function useAppearance(){
        const [value,setValue]=React.useState(()=>appearance.getSnapshot());
        React.useEffect(()=>{const update=()=>setValue(appearance.getSnapshot());const stop=appearance.subscribe(update);update();return stop;},[]);
        return value;
      }
      function AppearancePanel(){
        const value=useAppearance();
        return h('section',{className:'pc_setup','data-dot-appearance':true},h('h3',null,'界面外观'),h('p',{className:'pc_muted'},'Dot 外观使用暖纸底色、清晰字体和配对深色主题。跟随原有明暗设置，随时恢复原生外观。'),h('div',{className:'pc_actions'},...['native','dot'].map(mode=>h('button',{type:'button',key:mode,disabled:!value.writable||value.busy,'aria-pressed':value.mode===mode,onClick:()=>appearance.setAppearance(mode)},mode==='native'?'原生外观':'Dot 外观'))),value.error?h('p',{className:'pc_muted',role:'status'},value.error):null);
      }
      ctx.effect(()=>{
        if(typeof document==='undefined')return;
        const tag=document.createElement('style');tag.dataset.pluginCss='dsh-project-companion/onboarding';tag.textContent=css;document.head.appendChild(tag);
        return()=>tag.remove();
      });
      function Surface(props,onboarding){
        const [snapshot,setSnapshot]=React.useState(null);
        const [selected,setSelected]=React.useState([]);
        const [busy,setBusy]=React.useState(false);
        const [error,setError]=React.useState('');
        const [pollStopped,setPollStopped]=React.useState(false);
        const active=React.useRef(false);
        const latest=React.useRef(null);
        const inFlight=React.useRef(false);
        const controllers=React.useRef(new Set());
        const finished=React.useRef(false);
        const startedWelcome=React.useRef(false);
        const mutationUncertain=React.useRef({selection:false,welcome:false});
        const pollStarted=React.useRef(Date.now());
        const update=(value,authoritativeRead=false)=>{
          if(!active.current)return;
          latest.current=value;
          if(value.connection.state==='bound'){
            // The selection action only adds known projects and is idempotent.
            // A fresh Host read reconciles a lost selection response safely.
            if(authoritativeRead)mutationUncertain.current.selection=false;
            mutationUncertain.current.welcome=value.welcome?.status==='unknown';
            const known=new Set(value.projects.map(project=>project.id));
            const watched=value.projects.filter(project=>project.watched).map(project=>project.id);
            setSelected(current=>[...new Set([...watched,...current.filter(id=>known.has(id))])].slice(0,5));
          }
          setSnapshot(value);
        };
        const invalidateConnection=()=>{
          if(!active.current)return;
          const value={...(latest.current??{version:1,projects:[]}),completed:false,connection:{state:'unknown'}};
          latest.current=value;setSnapshot(value);
        };
        const request=async body=>{
          const controller=new AbortController();controllers.current.add(controller);
          try{
            const response=await fetch(endpoint,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
            if(!response.ok){
              const failure=new Error(response.status===401||response.status===403?'请在已登录的 Harness 窗口中打开此页，然后刷新连接状态。':response.status===404?'当前宿主尚不支持此引导，请核对项目助理版本。':'本次操作未完成，请刷新连接状态后重试。');
              failure.status=response.status;
              // A generic 400 can also follow a post-admission persistence error.
              failure.beforeAdmission=[401,403,404,405,413,415].includes(response.status);
              throw failure;
            }
            const value=await response.json();
            if(!value||value.version!==1||!value.connection||!Array.isArray(value.projects))throw new Error('连接状态暂不可用，请刷新后重试。');
            return value;
          }finally{controllers.current.delete(controller);}
        };
        const refresh=async()=>{
          if(inFlight.current)return;
          inFlight.current=true;
          try{const value=await request();update(value,true);if(active.current)setError(mutationUncertain.current.welcome?'首份简报的接收状态还不确定，未重复提交。请打开 Dot 会话核对。':mutationUncertain.current.selection?'项目关注状态还不确定，请恢复连接后刷新核对。':'');}
          catch(failure){if(active.current){invalidateConnection();setError(failure.message||'连接状态暂不可用。');}}
          finally{inFlight.current=false;}
        };
        React.useEffect(()=>{
          active.current=true;void refresh();
          return()=>{active.current=false;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
        },[]);
        const state=snapshot?.connection?.state;
        React.useEffect(()=>{
          if(!state||['bound','missing'].includes(state))return;
          const timer=setInterval(()=>{
            if(Date.now()-pollStarted.current>=600000){clearInterval(timer);if(active.current)setPollStopped(true);return;}
            void refresh();
          },state==='unknown'?5000:2000);return()=>clearInterval(timer);
        },[state]);
        React.useEffect(()=>{
          if(onboarding&&snapshot?.completed&&(!startedWelcome.current||snapshot?.welcome?.receipt?.status==='user_confirmed')&&!finished.current){finished.current=true;props.complete?.();}
        },[onboarding,snapshot?.completed]);
        React.useEffect(()=>{
          if(!onboarding||!snapshot||snapshot.completed||typeof document==='undefined')return;
          const root=document.getElementById('root');if(!root)return;
          const previous=root.inert;root.inert=true;return()=>{root.inert=previous;};
        },[onboarding,Boolean(snapshot),snapshot?.completed]);

        const mutate=async body=>{
          const current=latest.current;
          if(inFlight.current||!active.current||current?.connection.state!=='bound')return;
          if(body.action==='complete'&&current.welcome?.status==='accepted'){await refresh();return;}
          if(body.action==='complete')startedWelcome.current=true;
          if(mutationUncertain.current.selection||(body.action==='complete'&&mutationUncertain.current.welcome))return;
          inFlight.current=true;setBusy(true);setError('');
          try{
            const value=await request(body);if(!active.current)return;update(value);
            if(body.action==='complete'&&value.welcome?.status!=='accepted')setError(value.welcome?.status==='unknown'?'首份简报的接收状态还不确定，未重复提交。请打开 Dot 会话核对。':'会话正在处理任务或连接已变化，尚未提交首份简报。');
            if(body.action==='confirm_received'&&value.welcome?.receipt?.status==='user_confirmed'){
              if(onboarding&&!finished.current){finished.current=true;props.complete?.();}props.close?.();
            }
          }catch(failure){
            if(active.current){
              if(failure.beforeAdmission){
                if([401,403].includes(failure.status))invalidateConnection();
                setError(failure.message);
              }else{
                mutationUncertain.current[body.action==='complete'?'welcome':'selection']=true;
                setError('操作结果暂不确定，未自动重试。请刷新状态或打开 Dot 会话核对。');
              }
            }
          }finally{inFlight.current=false;if(active.current)setBusy(false);}
        };
        if(onboarding&&snapshot?.completed&&(!startedWelcome.current||snapshot?.welcome?.receipt?.status==='user_confirmed'))return null;
        const bound=state==='bound'&&typeof snapshot?.connection.sessionId==='string';
        const projects=snapshot?.projects??[];
        const saved=projects.filter(project=>project.watched).length;
        const selectedCount=new Set([...selected,...projects.filter(project=>project.watched).map(project=>project.id)]).size;
        const welcomeAccepted=bound&&snapshot?.welcome?.status==='accepted';
        const connectionText={missing:'请先安装并启用微信桥接，然后刷新此页。',unknown:'连接状态暂不可用，请刷新后重试。','waiting-qr':'用微信扫描下方二维码，并在手机上确认登录。',scanned:'手机已扫码，请在微信确认登录。','awaiting-message':'扫码已完成。请在微信给小助手发送首条消息“你好”，它会建立你的 Dot 会话。',bound:'已连接微信，沿用当前会话。',failed:'微信连接暂时失败。请到微信设置页查看状态，此页不会重置已有连接。'}[state]??'正在读取连接状态…';
        const body=h('div',{className:'pc_setup'},
          h('h2',null,'DSH Dot'),
          h('p',null,'长在微信里的项目助理。选好要关注的项目，先看一份简报，再直接用自然语言交代事情。'),
          h('section',{className:'pc_card'},h('h3',null,'1 · 连接微信'),h('p',{role:'status'},connectionText),
            state==='waiting-qr'&&snapshot?.connection.qrAvailable===true?h('img',{src:'/wechat/api/qr-image'+(/^[a-f0-9]{16}$/.test(snapshot.connection.qrRevision??'')?`?v=${snapshot.connection.qrRevision}`:''),alt:'用微信扫描登录二维码'}):null,
            pollStopped&&!bound?h('p',{className:'pc_muted'},'已停止自动刷新。需要时点击“刷新连接状态”继续查看。'):null,
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy,onClick:refresh},'刷新连接状态'),bound?h('button',{type:'button',disabled:busy,onClick:()=>{ctx.uiWorkspace.openSession(snapshot.connection.sessionId);props.close?.();}},'打开 Dot 会话'):null,
              props.openSection?h('button',{type:'button',onClick:()=>{props.complete?.();props.openSection('wechat');}},'查看微信设置'):null)),
          h('section',{className:'pc_card'},h('h3',null,'2 · 选择关注的项目'),
            h('p',{className:'pc_muted'},'最多关注 5 个项目。只读取你选择的项目说明和已观察到的会话；不会自动扫全部历史。'),
            projects.length?projects.map(project=>h('label',{key:project.id},h('input',{type:'checkbox',checked:selected.includes(project.id)||project.watched,disabled:busy||!bound||project.watched||(!selected.includes(project.id)&&selectedCount>=5),onChange:event=>{setSelected(current=>event.target.checked?[...new Set([...current,...projects.filter(p=>p.watched).map(p=>p.id),project.id])].slice(0,5):current.filter(id=>id!==project.id));}}),h('span',null,project.label,project.watched?'（已关注）':''))):h('p',{className:'pc_muted'},'还没有可选择的已知项目。先在 Harness 添加一个项目，再刷新。'),
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||!bound||!selected.length||mutationUncertain.current.selection,onClick:()=>mutate({action:'select_projects',projectIds:selected})},'保存关注并预览简报'))),
          bound&&snapshot?.firstBrief?h('section',{className:'pc_card'},h('h3',null,'项目资料预览'),h('div',{className:'pc_brief'},snapshot.firstBrief),h('p',{className:'pc_muted'},'这是有来源的资料预览。开始使用后，由 Dot 在当前微信会话整理第一份只读简报。')):null,
          welcomeAccepted?h('section',{className:'pc_card','data-dot-first-value':true},h('h3',null,'首份简报到哪一步了'),h('p',{className:'pc_muted'},snapshot?.welcome?.outcome?.status==='generated'?'简报已生成，手机是否收到由你确认。':snapshot?.welcome?.outcome?.status==='running'?'Dot 正在整理这次简报。':'任务已提交；生成和手机收件状态仍待核对。'),snapshot?.welcome?.outcome?.reply?h('div',{className:'pc_brief'},snapshot.welcome.outcome.reply):null,snapshot?.welcome?.receipt?.status==='user_confirmed'?h('p',{role:'status'},'你已确认在微信收到这份简报。'):h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy,onClick:refresh},'刷新简报状态'),h('button',{type:'button',className:'pc_primary',disabled:busy,onClick:()=>mutate({action:'confirm_received'})},'我已在微信收到这份简报')),h('p',{className:'pc_muted'},'只有你实际看见后才点确认；电脑收到回复不等于微信送达。')):null,
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          h('p',{className:'pc_muted'},'电脑和 Harness 需保持在线。提醒、日报和周期跟进都由你另行指定时间，安装不会自动开启推送计划。'),
          h('div',{className:'pc_actions'},h('button',{type:'button',className:'pc_primary',disabled:busy||!bound||(!welcomeAccepted&&(!saved||mutationUncertain.current.selection||mutationUncertain.current.welcome)),onClick:()=>mutate({action:'complete'})},busy?'正在处理…':welcomeAccepted?'查看已提交的首份简报':'生成首份简报并回到微信'),onboarding?h('button',{type:'button',disabled:busy,onClick:()=>props.complete?.()},'稍后设置'):null));
        return onboarding&&snapshot?h(Modal,{open:true,closeLabel:'关闭',title:'DSH Dot',headless:true,className:'pc_setup_modal',onClose:()=>props.complete?.()},body):body;
      }
      function CredentialForm(props={}){
        const formRef=React.useRef(null);
        if(formRef.current===null){try{const forms=typeof ctx.get==='function'?ctx.get('configForms',false):ctx.configForms;formRef.current=forms?.get('project-companion')??false;}catch{formRef.current=false;}}
        const form=formRef.current;
        const [view,setView]=React.useState(()=>form?form.getSnapshot():{status:'unavailable',writable:false});
        const [drafts,setDrafts]=React.useState({});
        const [saving,setSaving]=React.useState(false);
        const [failed,setFailed]=React.useState(false);
        const active=React.useRef(false),current=React.useRef(view),changes=React.useRef({}),baseline=React.useRef(undefined),inFlight=React.useRef(false);
        current.current=view;
        React.useEffect(()=>{
          active.current=true;
          const sync=()=>{if(active.current&&form){current.current=form.getSnapshot();setView(current.current);}};
          const stop=form?form.subscribe(sync):null;sync();
          return()=>{active.current=false;changes.current={};baseline.current=undefined;stop?.();};
        },[]);
        const fields=[['flomoToken','flomo MCP Token',true],['didaToken','滴答清单 API 口令',true],['googleClientId','Google Desktop Client ID',false],['googleClientSecret','Google Desktop Client Secret',true],['googleRefreshToken','Google Refresh Token',true]];
        const stage=(field,value)=>{
          if(!active.current||inFlight.current||current.current.status!=='ready'||!current.current.writable)return;
          if(!Object.keys(changes.current).length)baseline.current=current.current.revision;
          const next={...changes.current,[field]:value};
          if(value===''&&field!=='googleClientId')delete next[field];
          changes.current=next;setDrafts(next);setFailed(false);
          if(!Object.keys(next).length)baseline.current=undefined;
        };
        const discard=()=>{changes.current={};baseline.current=undefined;if(active.current){setDrafts({});setFailed(false);}};
        const invalid=Object.values(drafts).some(value=>value!==null&&(typeof value!=='string'||value.length>16384));
        const save=async()=>{
          if(!active.current||inFlight.current||!form||current.current.status!=='ready'||!current.current.writable||invalid)return;
          const ops=Object.entries(changes.current).map(([field,value])=>value===null||value===''?{op:'unset',path:[field]}:{op:'set',path:[field],value});
          if(!ops.length)return;
          inFlight.current=true;setSaving(true);setFailed(false);
          try{
            const accepted=await form.mutate(ops,baseline.current);
            if(active.current){if(accepted===true){discard();current.current=form.getSnapshot();setView(current.current);void props.onSaved?.();}else setFailed(true);}
          }catch{if(active.current)setFailed(true);}
          finally{inFlight.current=false;if(active.current)setSaving(false);}
        };
        if(typeof SettingsForm!=='function'&&typeof SettingsForm!=='string')return h('p',{className:'pc_error',role:'status'},'当前宿主的原生凭据表单不可用，请更新 Harness。');
        const blocked=view.status!=='ready'||!view.writable||saving;
        const configured=field=>field==='flomoToken'?props.sources?.some(row=>row.id==='flomo'&&row.configured):field==='didaToken'?props.sources?.some(row=>row.id==='dida'&&row.configured):field==='googleRefreshToken'?props.googleAuth?.refreshConfigured:props.googleAuth?.clientConfigured;
        return h(SettingsForm,{labels:{unavailable:'原生配置尚未就绪，请稍后重新打开此页；不会改用聊天接收密钥。',readOnly:'当前宿主配置只读，无法保存凭据。',saveFailed:'未确认保存成功，未自动重试。请核对原生配置后重试。',save:'保存连接凭据',saving:'正在保存…'},state:{available:view.status==='ready',writable:view.writable===true,dirty:Object.keys(drafts).length>0,invalid,saving,failed},onSave:save,onDiscard:discard},
          fields.map(([field,label,secret])=>{
            const staged=Object.hasOwn(drafts,field);
            const value=staged?drafts[field]??'':secret?'':typeof view.value?.[field]==='string'?view.value[field]:'';
            return h('div',{key:field},secret?h(SettingsSecretField,{id:`pc-credential-${field}`,label,hint:field==='googleRefreshToken'?'通常由 Google 授权自动保存；空白保留已有值，不会回显令牌。':'仅输入新值以替换；留空保留已有凭据，不会回显旧值。',text:value,disabled:blocked,onEdit:text=>stage(field,text),configured:configured(field)===true,stateLabel:staged&&drafts[field]===null?'保存后清除':configured(field)?'已配置，不回显':'尚未确认配置'}):h(SettingsValueField,{id:`pc-credential-${field}`,label,hint:'使用你自己创建的 Desktop OAuth 应用，Google 密钥不要发进聊天。',text:value,overridden:Object.hasOwn(view.user??{},field)||staged,invalid:false,overriddenLabel:'自定义值',resetLabel:'清除',invalidLabel:'请检查输入',disabled:blocked,onEdit:text=>stage(field,text),onReset:()=>stage(field,null)}),
              secret?h('button',{type:'button',disabled:blocked,onClick:()=>stage(field,null)},`清除 ${label}`):null);
          }),h('div',null,h('p',{className:'pc_muted'},'Google 授权记录由本人登录后自动保存，不在此显示或手填。清除本机记录后须重新授权并启用来源。'),...[['googleSuiteOAuthCredentials','Google 三件套'],['googleCalendarOAuthCredentials','Google 日历']].map(([field,label])=>h('button',{type:'button',key:field,disabled:blocked,onClick:()=>stage(field,null)},drafts[field]===null?`保存后清除 ${label}授权`:`清除 ${label}授权`))));
      }
      function ContextPanel(){
        const contextEndpoint='/api/project_companion/context';
        const sourceNames={gmail:'Gmail',calendar:'Google 日历',drive:'Google Drive',docs:'Google Docs',sheets:'Google Sheets',slides:'Google Slides',dida:'滴答清单',flomo:'flomo'};
        const sourceIds=Object.keys(sourceNames),googleIds=['gmail','calendar','drive'];
        const [snapshot,setSnapshot]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
        const [authorization,setAuthorization]=React.useState(null),[remaining,setRemaining]=React.useState(0),[notice,setNotice]=React.useState('');
        const active=React.useRef(false),inFlight=React.useRef(false),latest=React.useRef(null),authRef=React.useRef(null),controllers=React.useRef(new Set());
        const authNames={google:'Google 高级只读',googleCalendar:'Google 日历',googleSuite:'Google',flomo:'flomo',dida:'滴答清单'};
        const clearAuthorization=()=>{authRef.current=null;if(active.current)setAuthorization(null);};
        const invalidate=()=>{latest.current=null;if(active.current){setSnapshot(null);clearAuthorization();}};
        const authStatus=a=>{
          if(!a||typeof a!=='object'||Array.isArray(a)||!['clientConfigured','refreshConfigured','authInProgress'].every(k=>typeof a[k]==='boolean'))return null;
          return{clientConfigured:a.clientConfigured,refreshConfigured:a.refreshConfigured,authInProgress:a.authInProgress,...(typeof a.expiresAt==='string'&&a.expiresAt.length<=40&&Number.isFinite(Date.parse(a.expiresAt))?{expiresAt:a.expiresAt}:{})};
        };
        const rememberAuthorization=value=>{authRef.current=value;setAuthorization(value);setRemaining(Math.max(0,Math.ceil((value.deadline-Date.now())/1000)));};
        const accept=value=>{
          if(!value||!Array.isArray(value.sources)||value.sources.length!==sourceIds.length||!authStatus(value.googleAuth))throw new Error('invalid context status');
          const rows=sourceIds.map(id=>{
            const matches=value.sources.filter(row=>row?.id===id);if(matches.length!==1)throw new Error('invalid context source');
            const row=matches[0];if(typeof row.configured!=='boolean'||typeof row.enabled!=='boolean')throw new Error('invalid context access');
            return{id,name:sourceNames[id],configured:row.configured,enabled:row.enabled,status:row.status??row.state,lastReadAt:typeof row.lastReadAt==='string'&&row.lastReadAt.length<=80&&Number.isFinite(Date.parse(row.lastReadAt))?row.lastReadAt:null};
          });
          const state={sources:rows,googleAuth:authStatus(value.googleAuth)};
          for(const field of ['flomoAuth','didaAuth','googleCalendarAuth','googleSuiteAuth'])state[field]=authStatus(value[field]);
          if(state.googleSuiteAuth){const granted=value.googleSuiteAuth.grantedSources;if(!Array.isArray(granted)||granted.some(id=>!googleIds.includes(id))||new Set(granted).size!==granted.length)throw new Error('invalid Google service grants');state.googleSuiteAuth.grantedSources=[...granted];}
          if(active.current){
            latest.current=state;setSnapshot(state);
            const current=authRef.current;
            if(current){const status=state[current.source+'Auth'];if(!status||!status.authInProgress){clearAuthorization();setNotice(status?.refreshConfigured?'授权流程已结束，以下为当前已保存的权限。可启用需要的来源；尚未读取资料。':'授权流程已结束，尚未确认保存。可以重新连接。');}}
            else{const entry=Object.entries(authNames).find(([source])=>state[source+'Auth']?.authInProgress&&state[source+'Auth']?.expiresAt);if(entry){const[source]=entry,expiresAt=state[source+'Auth'].expiresAt,deadline=Math.min(Date.parse(expiresAt),Date.now()+300000);if(deadline>Date.now())rememberAuthorization({source,url:null,expiresAt,deadline});}}
          }
          return state;
        };
        const request=async body=>{
          const controller=new AbortController();controllers.current.add(controller);
          try{const response=await fetch(contextEndpoint,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error('context operation failed');return await response.json();}
          finally{controllers.current.delete(controller);}
        };
        const refresh=async(quiet=false)=>{
          if(!active.current||inFlight.current)return;inFlight.current=true;if(!quiet){setBusy(true);setError('');}
          try{const value=await request();if(active.current)accept(value);}
          catch{if(active.current){invalidate();setError('资料来源状态暂不可用，请刷新状态后重试。');}}
          finally{inFlight.current=false;if(active.current&&!quiet)setBusy(false);}
        };
        React.useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;authRef.current=null;for(const controller of controllers.current)controller.abort();controllers.current.clear();};},[]);
        // Observe only sanitized authorization state while this one flow is active.
        // No background source queries, retrying POSTs, or permanent polling.
        React.useEffect(()=>{
          if(!authorization)return;
          const timer=setInterval(async()=>{
            const current=authRef.current;if(!active.current||!current)return;
            const seconds=Math.max(0,Math.ceil((current.deadline-Date.now())/1000));setRemaining(seconds);
            if(!seconds){clearAuthorization();setNotice('授权链接已过期。点击重新连接即可再试，已有连接会保留。');return;}
            await refresh(true);
          },2000);
          return()=>clearInterval(timer);
        },[authorization?.source,authorization?.deadline]);
        const mutate=async(action,source)=>{
          if(!active.current||inFlight.current||!latest.current)return;
          const authSource={google_authorize:'google',google_calendar_authorize:'googleCalendar',google_suite_authorize:'googleSuite',flomo_authorize:'flomo',dida_authorize:'dida'}[action];
          if(authSource){
            if(authRef.current)return;
            if(authSource.startsWith('google')?!latest.current[authSource+'Auth']?.clientConfigured:!latest.current[authSource+'Auth'])return;
          }else{const row=latest.current.sources.find(item=>item.id===source);if(!row||(action==='connect'&&(!row.configured||row.enabled))||(action==='disconnect'&&!row.enabled))return;}
          inFlight.current=true;setBusy(true);setError('');setNotice('');
          try{
            const value=await request({action,...(source?{source}:{})});if(!active.current)return;
            if(authSource){
              const url=new URL(value?.url),target={google:['https://accounts.google.com','/o/oauth2/v2/auth'],googleCalendar:['https://accounts.google.com','/o/oauth2/v2/auth'],googleSuite:['https://accounts.google.com','/o/oauth2/v2/auth'],flomo:['https://flomoapp.com','/integration/grant'],dida:['https://dida365.com','/oauth/authorize']}[authSource];
              if(url.origin!==target[0]||url.pathname!==target[1]||url.username||url.password||url.hash||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())throw new Error('invalid authorization link');
              rememberAuthorization({source:authSource,url:url.toString(),expiresAt:value.expiresAt,deadline:Math.min(Date.parse(value.expiresAt),Date.now()+300000)});
              // The official Desktop forwards http(s) window.open to the system browser.
              // Web hosts may block it; always retain the validated click-only link.
              try{window.open?.(url.toString(),'_blank','noopener,noreferrer');}catch{}
            }else accept(value);
          }catch{if(active.current){invalidate();setError('操作结果暂不确定，请刷新状态核对后重试；不会重复提交。');}}
          finally{inFlight.current=false;if(active.current)setBusy(false);}
        };
        const rows=snapshot?.sources??sourceIds.map(id=>({id,name:sourceNames[id],configured:false,enabled:false,lastReadAt:null}));
        const rowFor=id=>rows.find(row=>row.id===id),google=snapshot?.googleAuth,suite=snapshot?.googleSuiteAuth,pending=Boolean(authorization);
        const statusText=row=>!snapshot?'状态未确认':!row.configured?'待账号授权':!row.enabled?'已授权，尚未启用':row.lastReadAt?'当前对话已启用':'当前对话已启用；本次启动暂无读取记录';
        const sourceRow=(id,description)=>{const row=rowFor(id);return h('div',{className:'pc_connect_row',key:id,'data-context-source':id},h('div',null,h('h3',null,row.name),description?h('p',{className:'pc_muted'},description):null,h('p',{className:'pc_connect_status',role:'status'},statusText(row)),row.enabled&&row.lastReadAt?h('p',{className:'pc_muted'},`上次读取：${row.lastReadAt}`):null),h('button',{type:'button',disabled:busy||!snapshot||(!row.enabled&&!row.configured),onClick:()=>mutate(row.enabled?'disconnect':'connect',id)},row.enabled?'停止此来源':row.configured?'启用只读来源':'等待授权'));};
        const authView=source=>authorization?.source===source?h('div',{className:'pc_connect_authorizing',role:'status'},h('strong',null,'请在浏览器完成授权'),h('p',{className:'pc_muted'},`返回这里后会自动更新 · 剩余 ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`),authorization.url?h('a',{href:authorization.url,target:'_blank',rel:'noopener noreferrer'},`浏览器未打开？继续到 ${authNames[source]} 授权`):h('p',{className:'pc_muted'},'请继续刚才的授权页；此处不会重复打开浏览器。')):null;
        const suiteStatus=!suite?'连接状态待确认，请刷新。':!suite.clientConfigured?'Google 连接准备中。':suite.authInProgress||authorization?.source==='googleSuite'?'正在等待你完成 Google 授权。':suite.refreshConfigured?suite.grantedSources.length===3?'Google 授权已保存，请启用要使用的来源。':'部分 Google 权限已保存。可以先用已授权来源，也可以重新连接补全。':'登录一次，连接你的 Gmail、日历和云盘。';
        return h('div',{className:'pc_setup pc_connections','data-context-panel':true},
          h('div',{className:'pc_connect_heading'},h('div',null,h('h2',null,'连接你的资料'),h('p',{className:'pc_muted'},'让 Dot 结合邮件、安排和文档，帮你推进手头的事。')),h('button',{type:'button',disabled:busy,onClick:()=>refresh()},busy?'正在更新…':'刷新资料来源状态')),
          h('p',{className:'pc_muted'},'连接是可选的，本地项目和 AI 资讯可以直接使用。登录不会自动扫描资料或开启推送。'),
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          notice?h('p',{className:'pc_connect_notice',role:'status'},notice):null,
          authorization?h('p',{className:'pc_connect_notice',role:'status','data-context-auth-pending':true},`正在完成 ${authNames[authorization.source]} 授权，其他登录按钮暂时不可用。请先完成当前授权；完成或超时后，未成功的来源可重新连接。`):null,
          h('section',{className:'pc_card pc_google_connect','data-google-suite-connect':true},
            h('div',{className:'pc_connect_heading'},h('div',null,h('h3',null,'Google 三件套'),h('p',{className:'pc_muted'},'Gmail、Google 日历、Google Drive · 只读')),h('span',{className:'pc_connect_badge'},'预览')),
            h('p',null,'查看需要跟进的邮件、接下来的日程，以及云盘里的项目资料。由你在 Google 页面决定是否授权。'),
            h('p',{'data-google-data-use-disclosure':true,className:'pc_connect_notice'},'同意连接后，Dot 仅按你的请求读取 Google 资料，内容会进入 Harness 会话并交给你配置的模型处理；从微信查询时，回复也会经过微信。请仅使用不将这些资料用于通用 AI 训练的模型服务。你可以随时停止来源或撤销授权。'),
            h('p',{className:'pc_muted'},h('a',{'data-google-privacy':true,href:'https://oxmumu3.github.io/dsh-project-companion/privacy.html',target:'_blank',rel:'noopener noreferrer'},'查看隐私说明与撤销授权的方法')),
            h('div',{className:'pc_actions'},h('button',{type:'button',className:'pc_primary','data-google-suite-login':true,disabled:busy||pending||!suite?.clientConfigured,onClick:()=>mutate('google_suite_authorize')},authorization?.source==='googleSuite'?'等待 Google 授权…':suite?.refreshConfigured?'同意并重新连接 Google':'同意并连接 Google')),
            h('p',{className:'pc_muted',role:'status'},suiteStatus),
            authView('googleSuite'),
            googleIds.map(id=>sourceRow(id,{gmail:'按需找邮件，查看正文并整理待办。',calendar:'主日历近期安排，单次最多 7 天、10 条。',drive:'查找文件名，按需读取支持的文本内容。'}[id])),
            h('details',{className:'pc_connect_help'},h('summary',null,'授权范围与连接帮助'),h('p',{className:'pc_muted'},'Google 连接可用范围由当前应用受众和审核状态决定。公开预览可能显示未验证提示或人数限制；若显示仅限测试账号，请以 Google 页面提示为准。'),h('p',{className:'pc_muted'},'三项均为只读，不发送邮件、不修改日历或文件。授权与启用分开；来源启用后，Dot 仍只按你的请求读取。授权保存在这台电脑，查询所需内容会交给你在 Harness 配置的模型处理。'),h('p',{className:'pc_muted'},'Drive 支持文件名搜索、纯文本和 Google 文档／演示的文本读取；表格按指定范围读取。PDF、图片和其他二进制文件暂不读取全文。'),snapshot?.googleCalendarAuth?.refreshConfigured?h('p',{className:'pc_muted'},'你之前单独连接的日历继续使用，不会被新的三件套授权覆盖。'):null),
            h('details',{'data-google-calendar-connect':true,className:'pc_connect_help'},h('summary',null,'只连接 Google 日历'),h('p',{className:'pc_muted'},'仅请求主日历事件只读权限。登录不会自动查询或开启推送。'),h('button',{type:'button',disabled:busy||pending||!snapshot?.googleCalendarAuth?.clientConfigured,onClick:()=>mutate('google_calendar_authorize')},'同意并登录 Google 日历'),h('p',{className:'pc_muted',role:'status'},!snapshot?.googleCalendarAuth?'Google 日历连接状态待确认。':!snapshot.googleCalendarAuth.clientConfigured?'Google 日历连接准备中。':snapshot.googleCalendarAuth.refreshConfigured?'单独日历授权已保存。':snapshot.googleCalendarAuth.authInProgress?'正在等待日历授权。':'尚未单独连接日历。'),authView('googleCalendar'))),
          h('section',{className:'pc_card'},h('h3',null,'任务与笔记'),h('p',{className:'pc_muted'},'直接在官方页面登录授权，返回后自动更新连接状态。'),
            ...['flomo','dida'].map(source=>h('div',{key:source},h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||pending||!snapshot?.[source+'Auth'],onClick:()=>mutate(source+'_authorize')},'登录 '+sourceNames[source]+' 授权')),authView(source),sourceRow(source,source==='flomo'?'找回笔记里的想法和背景。':'查看任务与截止时间，梳理下一步。')))),
          h('details',{className:'pc_card','data-context-advanced':true},h('summary',null,'高级连接设置与兼容凭据'),
            h('h3',null,'文档工具与兼容接口'),h('p',{className:'pc_muted'},'按需启用 Docs、Sheets、Slides 的独立读取工具。可用状态以各来源为准，不必为了连接 Google 三件套填写下方配置。'),
            ...['docs','sheets','slides'].map(id=>sourceRow(id)),
            h('h3',null,'开发者 MCP 连接'),h('p',{className:'pc_muted'},'这是旧 Google MCP Developer Preview 的兼容入口，需要相应资格和自己的 Desktop 应用。普通 Google 登录请使用上方按钮。'),
            h('p',{className:'pc_muted'},'下方原生插件配置仅供高级兼容。令牌不要发进聊天；日常登录不需要手填这些字段。'),
            h(CredentialForm,{sources:snapshot?.sources,googleAuth:google,onSaved:()=>refresh()}),
            h('p',{className:'pc_muted',role:'status'},!google?'兼容连接状态未确认':google.refreshConfigured?'兼容账号凭据已保存。':google.authInProgress?'正在等待兼容账号授权。':google.clientConfigured?'自定义 Desktop 应用已配置。':'尚未配置自定义 Desktop 应用。'),
            h('button',{type:'button',disabled:busy||pending||!google?.clientConfigured,onClick:()=>mutate('google_authorize')},'同意并连接 Google 账号（高级）'),authView('google')),
          h('p',{className:'pc_muted'},'停止来源后，Dot 不再通过当前对话读取它。需要彻底撤销授权，可前往对应服务的账号设置。读取记录不代表持续监控或内容完整。'));
      }
      const dotPanel='project-companion-dot';
      const workbenchEndpoint='/api/project_companion/workbench';
      const dotCss=`
        .pc_dot{height:100%;overflow:auto;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;line-height:1.6}
        .pc_dot *{box-sizing:border-box}.pc_dot_inner{max-width:1160px;margin:0 auto;padding:40px 36px 48px}
        .pc_dot h1,.pc_dot h2,.pc_dot h3,.pc_dot p{margin:0}.pc_dot h1{font-size:28px;font-weight:600;letter-spacing:-.6px;line-height:1.3}.pc_dot h2{font-size:19px;font-weight:600}.pc_dot h3{font-size:13px;font-weight:600}
        .pc_dot_eyebrow{font-size:11px;letter-spacing:1.4px;color:var(--dsw-alias-label-tertiary,#888);font-weight:500;margin-bottom:9px}.pc_dot_muted{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}
        .pc_dot_header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.pc_dot_header p{margin-top:8px;font-size:13px;color:var(--dsw-alias-label-secondary,#888)}
        .pc_dot_actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pc_dot button{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.25));border-radius:7px;padding:7px 12px;font:inherit;font-size:12px;line-height:1.5;background:transparent;color:inherit;cursor:pointer}.pc_dot button:hover{background:var(--dsw-alias-bg-mask,rgba(128,128,128,.06))}.pc_dot button:focus-visible,.pc_dot summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px}.pc_dot button:disabled{opacity:.5;cursor:default}.pc_dot button.pc_dot_primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border-color:transparent}
        .pc_dot_summary{display:flex;gap:36px;margin:28px 0 32px;padding:20px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2));border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2))}.pc_dot_metric{display:flex;gap:10px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary,#888)}.pc_dot_metric strong{font-size:23px;line-height:1.2;font-weight:500;color:var(--dsw-alias-label-primary,inherit);font-variant-numeric:tabular-nums}
        .pc_dot_grid{display:grid;grid-template-columns:220px minmax(0,1fr);gap:32px}.pc_dot_projects{display:flex;flex-direction:column;gap:8px}.pc_dot_projects h3{margin-bottom:8px}.pc_dot button.pc_dot_project{text-align:left;border-color:transparent;padding:12px;width:100%;display:flex;flex-direction:column;gap:5px;overflow-wrap:anywhere}.pc_dot button.pc_dot_project[aria-pressed=true]{border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.25));background:var(--dsw-alias-bg-mask,rgba(128,128,128,.045))}.pc_dot_project_title{font-size:13px;font-weight:500}.pc_dot_project small{font-size:11px;color:var(--dsw-alias-label-secondary,#888)}
        .pc_dot_overview_grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pc_dot_detail{min-width:0}.pc_dot_project_head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:22px}.pc_dot_section{margin-top:28px;padding-top:22px;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.2))}.pc_dot_section>h3{margin-bottom:12px}.pc_dot_source{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.14));font-size:13px;overflow-wrap:anywhere}.pc_dot_source:last-child{border-bottom:0}.pc_dot_source_head{display:flex;justify-content:space-between;gap:16px;font-size:12px;margin-bottom:6px}.pc_dot_source pre{font:inherit;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.pc_dot_source summary{font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#888);padding:8px 0}.pc_dot_excerpt{white-space:pre-wrap;font-size:13px}.pc_dot_row{padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.14));display:flex;justify-content:space-between;gap:16px;font-size:13px;overflow-wrap:anywhere}.pc_dot_row:last-child{border-bottom:0}.pc_dot_row p{margin-top:5px}.pc_dot_badge{display:inline-block;font-size:11px;line-height:1.5;padding:2px 7px;border-radius:5px;background:var(--dsw-alias-bg-mask,rgba(128,128,128,.08));white-space:nowrap}.pc_dot_notice{padding:12px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#888)}.pc_dot_error{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:13px;margin:16px 0}.pc_dot_empty{padding:32px 0;font-size:13px;color:var(--dsw-alias-label-secondary,#888)}.pc_dot_footer{margin-top:32px;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
        @media(max-width:850px){.pc_dot_inner{padding:28px 22px}.pc_dot_grid{grid-template-columns:170px minmax(0,1fr);gap:20px}.pc_dot_header{flex-direction:column;gap:16px}}
        @media(max-width:600px){.pc_dot_inner{padding:24px 16px}.pc_dot_overview_grid{grid-template-columns:1fr;gap:0}.pc_dot_grid{grid-template-columns:1fr;gap:24px}.pc_dot_projects{flex-direction:row;flex-wrap:wrap}.pc_dot_projects h3{width:100%;margin:0}.pc_dot button.pc_dot_project{width:auto;flex:1;min-width:130px}.pc_dot_summary{gap:20px;justify-content:space-between;margin:22px 0}.pc_dot_metric{flex-direction:column;gap:4px}.pc_dot_project_head{flex-direction:column}.pc_dot_source_head,.pc_dot_row{flex-wrap:wrap}.pc_dot h1{font-size:25px}}
      `;
      const personalCss='.pc_dot_tabs{display:flex;gap:24px;border-bottom:1px solid var(--dsw-alias-border-l3,#e5e7e9);margin:12px 0 28px}.pc_dot_tabs button,.pc_dot_drawer_tabs button{border:0;border-radius:0;background:transparent;padding:10px 0;border-bottom:2px solid transparent}.pc_dot_tabs button.active,.pc_dot_drawer_tabs button.active{border-bottom-color:var(--dsw-alias-state-business-primary,#3869e8)}.pc_dot_hero{max-width:790px;margin:18px auto 30px}.pc_dot_hero h1{font-size:32px;letter-spacing:-.8px;line-height:1.4}.pc_dot_hero>p{margin:12px 0}.pc_dot_composer{border:1px solid var(--dsw-alias-border-l3,#e5e7e9);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#fff);padding:18px;margin:20px 0 8px}.pc_dot textarea{width:100%;min-height:70px;resize:vertical;background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:9px;padding:10px;font:inherit}.pc_dot_composer textarea{border:0;padding:0;min-height:52px;outline-offset:4px}.pc_dot_compose_bottom{display:flex;justify-content:space-between;gap:16px;align-items:center}.pc_dot select,.pc_dot input{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:7px;padding:7px;max-width:100%}.pc_dot_home_grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(220px,1fr);gap:36px}.pc_dot_update,.pc_dot_project_mini{padding:17px 0;border-top:1px solid var(--dsw-alias-border-l3,#ddd)}.pc_dot_project_mini{display:block;width:100%;text-align:left!important;border-radius:0!important;background:none!important;border-width:1px 0 0!important}.pc_dot_project_card{border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:13px;padding:22px;margin-bottom:15px}.pc_dot_steps{display:flex;gap:16px;margin-top:32px}.pc_dot_steps>div{flex:1;border-top:2px solid var(--dsw-alias-border-l3,#ddd);padding-top:12px}.pc_dot_steps strong,.pc_dot_steps small{display:block;font-size:12px}.pc_dot_steps small{margin-top:6px}.pc_dot_welcome .pc_dot_primary{padding:12px 24px;font-size:14px}.pc_dot_modal{width:min(620px,100%);max-height:92vh;overflow:auto;padding:24px}.pc_dot_drawer{line-height:1.8;color:var(--dsw-alias-label-primary,#222a34)}.pc_dot_drawer button{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:8px;background:transparent;color:inherit;padding:8px 13px}.pc_dot_drawer button.pc_dot_primary{background:var(--dsw-alias-state-business-primary,#3869e8);border-color:transparent;color:#fff}.pc_dot_drawer button:disabled{opacity:.5;cursor:default}.pc_dot_drawer textarea{width:100%;min-height:110px;font:inherit;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:9px;padding:12px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit}.pc_dot_drawer select,.pc_dot_drawer input{font:inherit;max-width:100%;padding:8px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:7px}.pc_dot_drawer pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px}.pc_dot_drawer_tabs{display:flex;gap:22px;border-bottom:1px solid var(--dsw-alias-border-l3,#ddd);margin-bottom:22px}.pc_dot_drawer label{display:flex;flex-direction:column;gap:8px;margin:14px 0}.pc_dot pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px}.pc_dot_error{color:var(--dsw-alias-state-error-primary,#b91c1c)}.pc_dot .pc_dot_muted{font-size:12px;line-height:1.7}.pc_dot button:focus-visible,.pc_dot textarea:focus-visible,.pc_dot select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3869e8);outline-offset:3px}@media(max-width:760px){.pc_dot_home_grid{grid-template-columns:1fr;gap:12px}.pc_dot_hero h1{font-size:26px}.pc_dot_tabs{gap:18px}.pc_dot_steps{gap:9px}.pc_dot_compose_bottom select{max-width:60%}.pc_dot_modal{padding:18px}}';
      function DotIcon({size=20}={}){
        return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none','aria-hidden':true},h('circle',{cx:12,cy:12,r:7.25,stroke:'currentColor',strokeWidth:1.5}),h('circle',{cx:12,cy:12,r:2.75,fill:'currentColor'}),h('path',{d:'M18 6l2-2',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round'}));
      }
      function Workbench(props={}){
        const sessions=typeof props.useSessions==='function'?props.useSessions(s=>s.byId):null;
        const appearanceState=useAppearance();
        const [snapshot,setSnapshot]=React.useState(null),[selected,setSelected]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
        const [page,setPage]=React.useState('home'),[drawer,setDrawer]=React.useState(null),[tab,setTab]=React.useState('summary'),[setup,setSetup]=React.useState(false),[trial,setTrial]=React.useState(false),[draft,setDraft]=React.useState('');
        const [followView,setFollowView]=React.useState(null),[followMode,setFollowMode]=React.useState('once'),[followTime,setFollowTime]=React.useState(''),[cadence,setCadence]=React.useState(60),[reviewFollow,setReviewFollow]=React.useState(false);
        const [taskView,setTaskView]=React.useState(null),[editing,setEditing]=React.useState(null),[memoryText,setMemoryText]=React.useState(''),[forgetReview,setForgetReview]=React.useState(false);
        const active=React.useRef(false),flight=React.useRef(false),controllers=React.useRef(new Set()),viewEpoch=React.useRef(0);
        const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
        const date=value=>{try{if(!value||!Number.isFinite(Date.parse(value)))return'时间未知';return new Intl.DateTimeFormat('zh-CN',{timeZone:snapshot?.hostTimeZone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));}catch{return'时间未知';}};
        const request=async(url,body)=>{const controller=new AbortController();controllers.current.add(controller);try{const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw new Error(value?.error||'操作未完成，请刷新核对；没有自动重试。');return value;}finally{controllers.current.delete(controller);}};
        const refresh=async()=>{if(!active.current||flight.current)return;flight.current=true;setBusy(true);setError('');try{const value=await request(workbenchEndpoint);if(!value||value.version!==1||!value.availability||!['projects','plans','jobs'].every(k=>typeof value.availability[k]==='boolean')||!value.connection||!Array.isArray(value.projects)||value.projects.length>5||!Array.isArray(value.jobs)||value.jobs.length>10||!Array.isArray(value.reminders)||value.reminders.length>100||!value.projects.every(p=>validId(p?.id)&&typeof p.label==='string'&&Array.isArray(p.sessionIds)&&p.sessionIds.length<=30&&p.sessionIds.every(validId)&&Array.isArray(p.sources)&&p.sources.length<=3&&Array.isArray(p.events)&&p.events.length<=30)||value.connection.state==='bound'&&!validId(value.connection.sessionId))throw new Error('工作台数据暂不可用。');if(active.current){setSnapshot(value);setSelected(current=>current===''||value.projects.some(p=>p.id===current)?current:value.projects[0]?.id??null);}}catch{if(active.current){setSnapshot(null);setSelected(null);setError('项目总览暂不可用。请确认 Harness 连接后，点击刷新重试。');}}finally{flight.current=false;if(active.current)setBusy(false);}};
        React.useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;for(const c of controllers.current)c.abort();controllers.current.clear();};},[]);
        const action=async body=>{if(!active.current||flight.current)return null;flight.current=true;setBusy(true);setError('');try{const result=await request('/api/project_companion/workbench/actions',body);return active.current?result:null;}catch(failure){if(active.current)setError(`${failure.message||'操作结果待核对。'} 未自动重试；可先查询当前状态。`);return null;}finally{flight.current=false;if(active.current)setBusy(false);}};
        const navigate=async id=>{if(!active.current||!validId(id))return;setError('');try{await ctx.uiWorkspace.openSession(id);if(active.current)ctx.layout.selectPanel(null);}catch{if(active.current)setError('会话未能打开，请在原项目列表中核对。没有重新提交任务。');}};
        const projects=snapshot?.projects??[],project=projects.find(p=>p.id===selected),jobs=snapshot?.jobs??[],reminders=snapshot?.reminders??[],bound=snapshot?.connection.state==='bound';
        const availability=snapshot?.availability??{projects:false,plans:false,jobs:false};
        const states={prepared:'等待提交',admitted:'等待处理',running:'正在处理',completed:'已有回复，待验收',blocked:'需要你核对',unknown:'执行状态未知',mixed:'输入变化，需核对',not_admitted:'未提交',discarded:'已取消',error:'执行出错',aborted:'已中止',interrupted:'被中断',expired:'跟踪已结束',no_text:'没有文本回复','max-tokens':'达到输出上限',forked:'分支结束，需核对'};
        const deliveries={pending:'等待回传',dispatching:'正在回传，结果未确认',queued:'交给通道时已排队，后续送达待核对',reported_sent:'通道报告已发出，手机送达未知',blocked:'回传通道受阻',uncertain:'回传结果不确定',failed:'回传失败',expired:'回传窗口已结束',cancelled:'回传已取消'};
        const kinds={goal:'目标',decision:'决定',blocker:'阻塞',next_step:'下一步',context:'背景'};
        const button=(label,onClick,options={})=>h('button',{type:'button',onClick,disabled:busy,...options},label);
        const section=(title,...children)=>h('section',{className:'pc_dot_section'},h('h3',null,title),...children);
        const latest=p=>[...p.sources.map(s=>s.updatedAt??s.modifiedAt),...p.events.map(e=>e.at)].filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).sort().at(-1);
        const closeDrawer=()=>{viewEpoch.current++;setDrawer(null);};
        const openProject=id=>{viewEpoch.current++;setSelected(id);setTab('summary');setDrawer('project');setError('');};
        const promptFor=(value,p=project)=>p?`关于项目「${p.label}」：\n${value}`:value;
        const chat=async value=>{if(flight.current)return;const prompt=value??draft;if(!prompt.trim()){setNotice('先写一句你希望 Dot 帮忙的事。');return;}const id=bound?snapshot.connection.sessionId:project?.sessionIds.length===1?project.sessionIds[0]:null;if(!id){setNotice('先连接微信，或在项目详情中明确选择一个本地会话。');return;}setError('');setNotice('');setBusy(true);flight.current=true;const controller=new AbortController();controllers.current.add(controller);try{const result=await prepareDotDraft(ctx,id,promptFor(prompt),controller.signal);if(active.current){if(result.status==='preserved')setNotice('Dot 会话里已有草稿，已为你保留。请先打开会话处理；这里的新问题也保留着。');else if(value===undefined)setDraft('');}}catch(failure){if(active.current)setError(failure.message||'原生草稿未能准备，请打开 Dot 会话核对。');}finally{flight.current=false;controllers.current.delete(controller);if(active.current)setBusy(false);}};
        const stageDraft=(prompt,scope=selected)=>{if(flight.current)return;if(draft.trim()&&draft!==prompt){setNotice('已保留你尚未发送的草稿。请先处理当前内容。');return;}setDraft(prompt);setSelected(scope);setPage('home');setNotice('已准备好草稿，补充细节后再发送。');};
        const shortcuts=[['看看项目进展','请只读看看这个项目的最新进展、阻塞和下一步。'],['交代一件事','请帮我处理这个项目的一件事：'],['安排一个提醒','请提醒我：']];
        const openFollow=async()=>{if(!project)return;const epoch=++viewEpoch.current;setFollowView(null);setReviewFollow(false);setDrawer('follow');const value=await action({action:'followup_status',projectId:project.id});if(value&&viewEpoch.current===epoch)setFollowView(value);};
        const confirmFollow=async()=>{if(!project)return;let body;if(followMode==='repeat')body={action:'followup_configure',projectId:project.id,everyMinutes:Number(cadence),userRequested:true};else{const time=new Date(followTime);if(!followTime||!Number.isFinite(time.getTime())){setError('请选择下一次检查的时间。');return;}body={action:'check_once',projectId:project.id,dueAt:time.toISOString(),userRequested:true};}const value=await action(body);if(value){setFollowView(previous=>({...previous,...value}));setReviewFollow(false);setNotice(`已为「${project.label}」保存跟进安排。没有实质变化时保持安静；电脑与 Harness 需在线。`);}};
        const cancelFollow=async which=>{const value=await action({action:which==='once'?'cancel_once':'followup_cancel',projectId:project.id,userRequested:true});if(value){setFollowView(previous=>({...previous,...value}));setNotice(`已关闭「${project.label}」的这项跟进。`);}};
        const openTask=async job=>{const epoch=++viewEpoch.current;setTaskView(null);setDrawer('task');const value=await action({action:'task_detail',id:job.id});if(value&&viewEpoch.current===epoch)setTaskView(value);};
        const memorySource=row=>{if(row.source.kind==='file')return row.source.reference;const id=row.source.reference.startsWith('session:')?row.source.reference.slice(8).split('#')[0]:null;const title=id&&sessions?.[id]?.displayTitle;return typeof title==='string'&&title.trim()?`来源会话：${title.slice(0,120)}`:'来源：项目会话记录';};
        const overview=project?.overview,memoryAvailable=overview?.available===true&&['goals','blockers','nextSteps','recent'].every(k=>Array.isArray(overview[k])&&overview[k].length<=4&&overview[k].every(r=>r&&typeof r.text==='string'&&r.source&&['user','assistant','file'].includes(r.source.kind)&&typeof r.source.reference==='string'&&r.verified===false));
        const memoryRows=memoryAvailable?[...new Map([...overview.goals,...overview.blockers,...overview.nextSteps,...overview.recent].map(r=>[r.id,r])).values()]:[];
        const openMemory=async row=>{const epoch=++viewEpoch.current;setEditing(null);setMemoryText('');setForgetReview(false);setDrawer('memory');const result=await action({action:'memory_detail',projectId:project.id,id:row.id});if(!result||viewEpoch.current!==epoch)return;if(result.editable===false||result.redacted===true){setError('这条记忆含有隐藏内容，请在 Dot 会话中按原始内容纠正或忘记；未将隐藏后的副本作为编辑原文。');return;}const full=result.record;if(result.projectId!==project.id||!full||full.id!==row.id||typeof full.text!=='string'||!full.text.trim()||Array.from(full.text).length>2000){setError('完整记忆暂不可用，未加载预览片段作为编辑内容。');return;}setEditing(full);setMemoryText(full.text);};
        const memoryCard=row=>h('div',{className:'pc_dot_source',key:row.id},h('p',{className:'pc_dot_excerpt'},row.text),h('p',{className:'pc_dot_muted'},`${row.source.kind==='user'?'用户记录':row.source.kind==='assistant'?'助手记录':'文件记录'} · ${date(row.at)} · 未独立核验`),h('small',{className:'pc_dot_muted'},memorySource(row)),h('div',{className:'pc_dot_actions'},button('纠正或忘记',()=>openMemory(row),{disabled:busy||!bound})));
        const memorySection=(title,rows,empty)=>section(title,rows?.length?rows.map(memoryCard):h('p',{className:'pc_dot_muted'},empty));
        const saveMemory=async forget=>{if(!project||!editing)return;const epoch=viewEpoch.current;const value=await action({action:forget?'memory_forget':'memory_update',projectId:project.id,id:editing.id,...(!forget?{text:memoryText.trim()}:{}),userRequested:true});if(value){if(viewEpoch.current===epoch){setDrawer('project');setTab('memory');}setNotice(forget?`已忘记「${project.label}」的这条项目记忆。`:`已记住你对「${project.label}」的纠正。`);await refresh();}};
        const sessionButtons=p=>p.sessionIds.map((id,index)=>{const row=sessions?.[id],title=typeof row?.displayTitle==='string'&&row.displayTitle.trim()?row.displayTitle.slice(0,120):`会话 ${index+1}`;return button(h('span',null,title,h('small',{style:{display:'block'},className:'pc_dot_muted'},!row?.displayTitle?'标题尚未加载 · 状态待确认':row.running===true?'正在运行':row.running===false?'当前无运行任务':'运行状态待确认')),()=>navigate(id),{key:id});});
        const projectDetails=()=>project?h('article',{'data-dot-project':project.id},h('div',{className:'pc_dot_drawer_tabs'},...[['summary','概况'],['memory','记住的事'],['sources','来源与记录']].map(([key,label])=>button(label,()=>setTab(key),{role:'tab','aria-selected':tab===key,className:tab===key?'active':''}))),
          tab==='summary'?h('div',null,memoryAvailable?h('div',{'data-dot-overview':true},memorySection('项目目标',overview.goals,'尚未记录项目目标。可以在 Dot 会话里告诉我你想达成什么。'),memorySection('已记录的阻塞',overview.blockers,'尚未记录阻塞；这不代表当前没有阻塞。'),memorySection('已记录的下一步',overview.nextSteps,'尚未记录下一步。')):section('项目记忆',h('p',{className:'pc_dot_muted'},'项目记忆暂不可用。可在来源中核对原始资料。')),
            section('接下来可以做什么',h('div',{className:'pc_dot_actions'},button('和 Dot 聊这个项目',()=>chat('请结合这个项目的最新资料，告诉我下一步先做什么。'),{className:'pc_dot_primary'}),button('查看或安排跟进',openFollow))),section('项目会话',project.sessionIds.length===1?button('打开项目会话',()=>navigate(project.sessionIds[0])):project.sessionIds.length?h('div',null,h('p',null,'选择会话'),h('div',{className:'pc_dot_actions'},sessionButtons(project))):h('p',{className:'pc_dot_muted'},'暂无可打开的项目会话。'))):
          tab==='memory'?h('div',null,section('你告诉 Dot 的事',memoryAvailable?memoryRows.length?memoryRows.map(memoryCard):h('p',{className:'pc_dot_muted'},'尚未记录项目记忆。'):h('p',{className:'pc_dot_muted'},'项目记忆暂不可用。')),button('告诉 Dot 要记住什么',()=>chat('请记住这个项目的一点背景：'))):
          h('details',{className:'pc_dot_section',open:true},h('summary',null,'原始资料与对话'),section('项目资料',project.sources.length?project.sources.map(source=>h('div',{className:'pc_dot_source',key:source.name},h('strong',null,source.name),h('p',{className:'pc_dot_muted'},source.status==='ok'?date(source.updatedAt??source.modifiedAt):source.status==='missing'?'尚未提供':'暂不可读取'),source.status==='ok'?h('pre',null,source.text):null,source.truncated?h('p',{className:'pc_dot_muted'},'来源内容较长，已截取；此处未展示完整文件。'):null)):h('p',null,'暂无项目资料。')),section('最近对话',project.events.length?project.events.slice(-4).reverse().map((event,index)=>h('div',{className:'pc_dot_source',key:index},h('p',{className:'pc_dot_muted'},`${project.label} · ${event.kind==='user'?'用户交代':event.kind==='assistant'?'助手回复':'运行记录'} · ${date(event.at)}`),h('p',{className:'pc_dot_excerpt'},event.text))):h('p',null,'启用后尚未观察到新对话。')))):null;
        const followDetails=()=>h('div',null,h('p',{className:'pc_dot_muted'},`只读检查「${project?.label??'所选项目'}」，有实质变化才通过原微信会话告诉你。电脑与 Harness 需在线。`),!followView?h('p',{role:'status'},error?'当前安排尚未确认；请重新查询。':'正在查询当前安排…'):h('div',null,
          ...[['followup','持续跟进'],['once','单次检查']].map(([key,label])=>{const plan=followView[key];return h('div',{className:'pc_dot_source',key},h('strong',null,label),h('p',null,plan?.enabled?`${key==='followup'?`每 ${plan.everyMinutes} 分钟`:'只检查一次'} · ${plan.nextDueAt?`下次 ${date(plan.nextDueAt)}`:'下次时间待核对'}`:'当前未开启'),plan?.blocked?h('p',{className:'pc_dot_muted'},'当前未运行，请核对原微信连接。'):null,plan?.enabled?button('关闭这项跟进',()=>cancelFollow(key)):null);}),
          h('div',{className:'pc_dot_source'},h('h3',null,reviewFollow?'核对这次安排':'安排下一次'),reviewFollow?h('div',null,h('p',null,`项目：${project?.label}`),h('p',null,followMode==='repeat'?`频率：每 ${cadence} 分钟，只读检查`:`时间：${followTime.replace('T',' ')}（本机浏览器时区）`),h('p',null,'通知：原微信会话；没有实质变化时保持安静。'),h('div',{className:'pc_dot_actions'},button('确认跟进',confirmFollow,{className:'pc_dot_primary',disabled:busy||!bound}),button('返回修改',()=>setReviewFollow(false)))):
          h('div',null,h('label',null,'方式',h('select',{value:followMode,onChange:e=>setFollowMode(e.target.value)},h('option',{value:'once'},'在指定时间看一次'),h('option',{value:'repeat'},'按间隔持续跟进'))),followMode==='once'?h('label',null,'检查时间',h('input',{type:'datetime-local',value:followTime,onChange:e=>setFollowTime(e.target.value)})):h('label',null,'每隔',h('select',{value:cadence,onChange:e=>setCadence(Number(e.target.value))},...[30,60,180,360,1440].map(n=>h('option',{value:n,key:n},n===1440?'一天':`${n} 分钟`)))),h('p',{className:'pc_dot_muted'},'单次可安排未来七天内的检查。周期跟进遵守免打扰时段和消息预算。'),button('核对安排',()=>{if(followMode==='once'&&!followTime){setError('请选择检查时间。');return;}setError('');setReviewFollow(true);},{className:'pc_dot_primary',disabled:busy||!bound})))),button('刷新安排',openFollow));
        const taskDetails=()=>{const rows=Array.isArray(taskView?.jobs)?taskView.jobs:taskView?.job?[taskView.job]:[];return h('div',null,!taskView?h('p',{role:'status'},error?'执行回复暂不可用。':'正在读取本次回复…'):rows.length?rows.map(job=>h('article',{key:job.id},h('h3',null,job.projectLabel),h('p',null,job.task),h('p',{className:'pc_dot_muted'},`执行：${states[job.status]??'状态待确认'}`),h('p',{className:'pc_dot_muted'},`回传：${deliveries[job.delivery?.status]??'尚无发送回执'}`),h('pre',null,job.reply??job.text??'本轮没有可展示的文本回复。'),job.replyTruncated?h('p',{className:'pc_dot_muted'},'本次回复已截取，请打开会话看完整内容。'):null,button('打开 Dot 会话',()=>navigate(snapshot.connection.sessionId)))):h('p',null,'没有这次交办的可用详情。'));};
        const memoryDetails=()=>!editing?h('p',{role:'status'},error?'完整记忆尚未读取，未开放编辑。':'正在读取完整记忆…'):h('div',null,h('p',{className:'pc_dot_muted'},`只修改「${project?.label}」的这条项目记忆。纠正会记录为你的本次说明，并保留原来源身份。`),forgetReview?h('div',null,h('p',null,'确认让 Dot 忘记这条记忆？原始项目文件不会被修改。'),h('div',{className:'pc_dot_actions'},button('确认忘记',()=>saveMemory(true),{className:'pc_dot_primary'}),button('返回',()=>setForgetReview(false)))):h('div',null,h('label',null,'记忆内容',h('textarea',{'aria-label':'纠正项目记忆',maxLength:4000,value:memoryText,disabled:busy,onChange:e=>{if(!flight.current)setMemoryText(e.target.value);}})),h('div',{className:'pc_dot_actions'},button('保存纠正',()=>saveMemory(false),{className:'pc_dot_primary',disabled:busy||!memoryText.trim()||Array.from(memoryText.trim()).length>2000}),button('忘记这条',()=>setForgetReview(true)))));
        const ranked=[...jobs].sort((a,b)=>{const rank=s=>['blocked','unknown','mixed','error','aborted','interrupted'].includes(s)?0:['prepared','admitted','running'].includes(s)?1:2;return rank(a.status)-rank(b.status)||Date.parse(b.createdAt)-Date.parse(a.createdAt);}).slice(0,4);
        const home=h('div',null,h('section',{className:'pc_dot_hero'},h('h1',null,'今天想推进哪件事？'),h('p',{className:'pc_dot_muted'},'看项目进展、交代事情，或安排下一次跟进。'),h('div',{className:'pc_dot_composer'},h('textarea',{'aria-label':'交代给 Dot 的事情',placeholder:'比如：这个项目做到哪了，接下来先做什么？',maxLength:3500,value:draft,disabled:busy,onChange:e=>{if(!flight.current)setDraft(e.target.value);}}),h('div',{className:'pc_dot_compose_bottom'},h('select',{'aria-label':'这句话关联的项目',value:selected??'',onChange:e=>setSelected(e.target.value)},h('option',{value:''},'不关联项目'),...projects.map(p=>h('option',{value:p.id,key:p.id},p.label))),button('开始对话　→',()=>chat(),{className:'pc_dot_primary'}))),h('p',{className:'pc_dot_muted'},'带入同一个 Dot 会话，由你发送；已有草稿会保留。'),h('div',{className:'pc_dot_actions'},...shortcuts.map(([label,prompt])=>button(label,()=>stageDraft(prompt),{key:label})))),
          h('div',{className:'pc_dot_home_grid'},section('需要你关注',!availability.jobs?h('p',{className:'pc_dot_muted'},'当前 Dot 会话的交办状态尚未确认，请在连接恢复后刷新核对。'):ranked.length?ranked.map(job=>h('article',{className:'pc_dot_update',key:job.id},h('p',{className:'pc_dot_muted'},`${job.projectLabel} · ${states[job.status]??'状态待核对'}`),h('h3',null,job.task),job.delivery?h('p',{className:'pc_dot_muted'},deliveries[job.delivery.status]??'回传状态待核对'):null,h('div',{className:'pc_dot_actions'},button('看看这次结果',()=>openTask(job)),button('和 Dot 接着聊',()=>{const matches=projects.filter(p=>p.label===job.projectLabel);if(matches.length!==1){setNotice('这次交办的项目范围需要你核对，请先在关注的项目中选择对应项目。');setPage('projects');return;}stageDraft(`关于「${job.projectLabel}」刚才的交办：${job.task}\n请先解释本次结果和还需要我决定的事。`,matches[0].id);})))):h('p',{className:'pc_dot_muted'},'暂无当前 Dot 会话的交办记录。有事直接告诉我。')),
            section('正在关注',!availability.projects?h('p',null,'关注列表暂不可用，请刷新核对。'):projects.length?projects.map(p=>button(h('span',null,h('strong',null,p.label),h('small',{style:{display:'block'},className:'pc_dot_muted'},latest(p)?`资料更新 ${date(latest(p))}`:'尚无近期资料')),()=>openProject(p.id),{key:p.id,className:'pc_dot_project_mini'})):h('p',null,'还没有关注项目，请先选择。'),button('选择关注项目',()=>setSetup(true)))),
          section('提醒与日报',!availability.plans?h('p',{className:'pc_dot_muted'},'提醒与日报状态尚未确认，请刷新核对。'):h('div',null,...reminders.map(r=>h('div',{className:'pc_dot_row',key:r.id},h('span',null,r.title),h('span',{className:'pc_dot_muted'},date(r.dueAt)))),!reminders.length?h('p',{className:'pc_dot_muted'},'暂无待触发的明确提醒。'):null,snapshot?.counts?.activeReminders>reminders.length?h('p',null,`仅显示 ${reminders.length} 条活动提醒，其余请在 Dot 会话中查询。`):null,h('p',{className:'pc_dot_muted'},snapshot?.daily?.enabled?`项目资料日报：每天 ${snapshot.daily.time}（${snapshot.daily.timeZone}）`:'项目资料日报未开启。设置时间后，定时汇总项目来源摘录。'),h('div',{className:'pc_dot_actions'},button('安排提醒',()=>stageDraft('请提醒我：','')),button('设置日报',()=>stageDraft('请帮我设置项目资料日报。先和我确认每天的发送时间、时区和关注项目，再开启。',''))))));
        const first=h('section',{className:'pc_dot_hero pc_dot_welcome'},h('p',{className:'pc_dot_eyebrow'},'你好，我是 Dot。'),h('h1',null,'把 Dot 接到微信里。'),h('p',null,'在微信里交代事情，回来收项目结果和提醒。先连接，再选一个项目试试。'),h('div',{className:'pc_dot_actions'},button('连接微信　→',()=>setSetup(true),{className:'pc_dot_primary'}),button('先在电脑试用',()=>setTrial(true))),h('p',{className:'pc_dot_muted'},'电脑和 Harness 在线时，Dot 才能处理本地工作。'),h('div',{className:'pc_dot_steps'},h('div',null,h('strong',null,'01　连接微信'),h('small',null,'扫码后发一句话')),h('div',null,h('strong',null,'02　选一个项目'),h('small',null,'决定关注范围')),h('div',null,h('strong',null,'03　拿到首份简报'),h('small',null,'在手机确认收到'))));
        return h('div',{className:'pc_dot','data-dot-workbench':true},h('div',{className:'pc_dot_inner'},h('header',{className:'pc_dot_header'},h('div',null,h('div',{className:'pc_dot_eyebrow'},'DSH DOT'),h('h2',null,'你的项目助理')),h('div',{className:'pc_dot_actions'},h('span',{className:'pc_dot_muted'},bound?'微信已连接':'微信尚未确认连接'),button(busy?'正在刷新…':'刷新',refresh),bound?button('打开 Dot 会话',()=>navigate(snapshot.connection.sessionId)):null)),
          h('nav',{className:'pc_dot_tabs','aria-label':'Dot 页面'},...([['home','动态'],['projects','关注的项目'],['settings','连接与设置']].map(([key,label])=>button(label,()=>setPage(key),{'aria-current':page===key?'page':undefined,className:page===key?'active':''})))),
          error?h('p',{className:'pc_dot_error',role:'alert'},error):null,notice?h('p',{className:'pc_dot_notice',role:'status'},notice):null,snapshot?.paused?h('p',{className:'pc_dot_notice'},'Dot 当前已暂停主动任务。这里仍可查看已有记录。'):null,
          snapshot?(page==='settings'?h('div',null,h('h1',null,'连接与设置'),h('p',{className:'pc_dot_muted'},'需要哪类资料，再连接哪一类。'),button('管理微信与关注项目',()=>setSetup(true)),h(ContextPanel),section('界面外观',button(appearanceState.mode==='dot'?'恢复原生外观':'启用 Dot 外观',()=>appearance.setAppearance(appearanceState.mode==='dot'?'native':'dot'),{disabled:!appearanceState.writable||appearanceState.busy}),appearanceState.error?h('p',{role:'status'},appearanceState.error):null)):
            page==='projects'?h('div',null,h('div',{className:'pc_dot_header'},h('h1',null,'关注的项目'),button('选择关注项目',()=>setSetup(true))),!availability.projects?h('p',null,'关注列表暂不可用。'):projects.length?projects.map(p=>h('article',{className:'pc_dot_project_card',key:p.id},h('h2',null,p.label),h('p',{className:'pc_dot_muted'},latest(p)?`上次资料更新 ${date(latest(p))}`:'尚无近期资料'),h('div',{className:'pc_dot_actions'},button('查看项目',()=>openProject(p.id)),button('继续聊',()=>stageDraft(`请看看「${p.label}」的最新进展。`,p.id))))):h('p',null,'还没有关注项目。')):!bound&&!trial?first:home):!error?h('p',{role:'status'},'正在读取项目总览…'):null,
          h('footer',{className:'pc_dot_footer'},snapshot?`更新于 ${date(snapshot.generatedAt)} · ${snapshot.hostTimeZone??'电脑时区'}。打开页面不会启动任务或推送。`:'',snapshot?.limitations?.length?h('details',null,h('summary',null,'资料范围与状态说明'),h('ul',null,...snapshot.limitations.slice(0,12).map((t,i)=>h('li',{key:i},t)))):null)),
          drawer?h(Modal,{open:true,closeLabel:'关闭',title:drawer==='project'?project?.label??'项目详情':drawer==='follow'?'后续怎么跟进':drawer==='memory'?'纠正项目记忆':'本次执行回复',className:'pc_dot_modal',onClose:closeDrawer},h('div',{className:'pc_dot_drawer'},error?h('p',{className:'pc_dot_error',role:'alert'},error):null,drawer==='project'?projectDetails():drawer==='follow'?followDetails():drawer==='memory'?memoryDetails():taskDetails())):null,
          setup?h(Modal,{open:true,closeLabel:'关闭',title:'连接微信与选择项目',className:'pc_setup_modal',onClose:()=>{setSetup(false);void refresh();}},h(Section,{close:()=>{setSetup(false);void refresh();}})):null);
      }
      if(typeof ctx.layout?.selectPanel==='function'){
        ctx.effect(()=>{if(typeof document==='undefined')return;const tag=document.createElement('style');tag.dataset.pluginCss='dsh-project-companion/workbench';tag.textContent=dotCss+personalCss;document.head.appendChild(tag);return()=>tag.remove();});
        ctx.effect(()=>ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:dotPanel},Workbench)));
        ctx.effect(()=>ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:dotPanel,order:5,label:'DSH Dot'},DotIcon)));
      }
      const Section=props=>h('div',null,Surface(props,false),h(AppearancePanel),h(ContextPanel));
      const Onboarding=props=>Surface(props,true);
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'project-companion',order:39,label:'DSH Dot'},Section)));
      ctx.effect(()=>ctx.slots.inject('settings.onboarding',()=>ctx.slots.register({name:'settings.onboarding',id:'project-companion-dot',order:50},Onboarding)));
      const forms=typeof ctx.get==='function'?ctx.get('configForms',false):ctx.configForms;
      if(forms)ctx.effect(()=>ctx.slots.inject('plugins.row.config',()=>ctx.slots.register({name:'plugins.row.config',key:'dsh-project-companion#project-companion'},props=>props.view==='summary'?'DeepSeek Dot 的个人资料来源与原生凭据配置':h('div',{className:'pc_setup'},h('h3',null,'连接凭据'),h(CredentialForm)))));
    }
    return{inject,apply,createDotAppearance,prepareDotDraft};
  },
});
