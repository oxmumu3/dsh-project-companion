/* Client half: reuse the official settings shell and the upstream QR viewer. */
window.__ModuleLoader__.load({
  id:'dsh-project-companion',
  factory:require=>{
    const React=require('react');
    const {Modal,SettingsForm,SettingsSecretField,SettingsValueField}=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement;
    const endpoint='/api/project_companion/onboarding';
    const inject=['slots','uiWorkspace','configForms'];
    const css=`.pc_setup{display:flex;flex-direction:column;gap:18px;padding:0 24px 24px;line-height:1.6}.pc_setup h2,.pc_setup h3,.pc_setup p{margin:0}.pc_setup h2{font-size:21px;font-weight:600}.pc_setup h3{font-size:15px;font-weight:600}.pc_setup .pc_card{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.25));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}.pc_setup .pc_muted{font-size:12px;color:var(--dsw-alias-label-secondary,#888)}.pc_setup .pc_actions{display:flex;gap:10px;flex-wrap:wrap}.pc_setup button{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.4));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:8px 14px;cursor:pointer}.pc_setup button:disabled{opacity:.5;cursor:default}.pc_setup button.pc_primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:white}.pc_setup button:focus-visible,.pc_setup input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:3px}.pc_setup label{display:flex;gap:10px;align-items:flex-start;font-size:14px}.pc_setup input{margin-top:5px}.pc_setup .pc_brief{white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere}.pc_setup .pc_error{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:13px}.pc_setup img{width:200px;height:200px;max-width:100%;align-self:center}.pc_setup_modal{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px 0 0}.pc_setup_modal .pc_setup{padding-top:0}@media(max-width:560px){.pc_setup{padding:0 16px 20px}.pc_setup .pc_actions button{flex:1}}`;

    function apply(ctx){
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
          if(onboarding&&snapshot?.completed&&!finished.current){finished.current=true;props.complete?.();}
        },[onboarding,snapshot?.completed]);
        React.useEffect(()=>{
          if(!onboarding||!snapshot||snapshot.completed||typeof document==='undefined')return;
          const root=document.getElementById('root');if(!root)return;
          const previous=root.inert;root.inert=true;return()=>{root.inert=previous;};
        },[onboarding,Boolean(snapshot),snapshot?.completed]);

        const mutate=async body=>{
          const current=latest.current;
          if(inFlight.current||!active.current||current?.connection.state!=='bound')return;
          if(body.action==='complete'&&current.welcome?.status==='accepted'){
            ctx.uiWorkspace.openSession(current.connection.sessionId);
            props.close?.();if(!finished.current){finished.current=true;props.complete?.();}return;
          }
          if(mutationUncertain.current.selection||(body.action==='complete'&&mutationUncertain.current.welcome))return;
          inFlight.current=true;setBusy(true);setError('');
          try{
            const value=await request(body);if(!active.current)return;update(value);
            if(body.action==='complete'){
              if(value.connection.state==='bound'&&typeof value.connection.sessionId==='string'&&value.welcome?.status==='accepted'){
                ctx.uiWorkspace.openSession(value.connection.sessionId);
                props.close?.();if(!finished.current){finished.current=true;props.complete?.();}
              }else if(value.welcome?.status!=='accepted')setError(value.welcome?.status==='unknown'?'首份简报的接收状态还不确定，未重复提交。请打开 Dot 会话查看。':'当前会话正在处理任务或连接已变化，尚未提交首份简报；等它空闲后再试。');
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
        if(onboarding&&snapshot?.completed)return null;
        const bound=state==='bound'&&typeof snapshot?.connection.sessionId==='string';
        const projects=snapshot?.projects??[];
        const saved=projects.filter(project=>project.watched).length;
        const selectedCount=new Set([...selected,...projects.filter(project=>project.watched).map(project=>project.id)]).size;
        const welcomeAccepted=bound&&snapshot?.welcome?.status==='accepted';
        const connectionText={missing:'请先安装并启用微信桥接，然后刷新此页。',unknown:'连接状态暂不可用，请刷新后重试。','waiting-qr':'用微信扫描下方二维码，并在手机上确认登录。',scanned:'手机已扫码，请在微信确认登录。','awaiting-message':'扫码已完成。请在微信给小助手发送首条消息“你好”，它会建立你的 Dot 会话。',bound:'已连接微信，沿用当前会话。',failed:'微信连接暂时失败。请到微信设置页查看状态，此页不会重置已有连接。'}[state]??'正在读取连接状态…';
        const body=h('div',{className:'pc_setup'},
          h('h2',null,'DeepSeek Dot'),
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
          snapshot?.firstBrief?h('section',{className:'pc_card'},h('h3',null,'项目资料预览'),h('div',{className:'pc_brief'},snapshot.firstBrief),h('p',{className:'pc_muted'},'这是有来源的资料预览。开始使用后，由 Dot 在当前微信会话整理第一份只读简报。')):null,
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          h('p',{className:'pc_muted'},'电脑和 Harness 需保持在线。提醒、日报和周期跟进都由你另行指定时间，安装不会自动开启推送计划。'),
          h('div',{className:'pc_actions'},h('button',{type:'button',className:'pc_primary',disabled:busy||!bound||(!welcomeAccepted&&(!saved||mutationUncertain.current.selection||mutationUncertain.current.welcome)),onClick:()=>mutate({action:'complete'})},busy?'正在处理…':welcomeAccepted?'打开 Dot 会话（首份简报已提交）':'开始使用并生成首份简报'),onboarding?h('button',{type:'button',disabled:busy,onClick:()=>props.complete?.()},'稍后设置'):null));
        return onboarding&&snapshot?h(Modal,{open:true,title:'DeepSeek Dot',headless:true,className:'pc_setup_modal',onClose:()=>props.complete?.()},body):body;
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
          }));
      }
      function ContextPanel(){
        const contextEndpoint='/api/project_companion/context';
        const sourceNames={gmail:'Gmail',calendar:'Google 日历',drive:'Google Drive',docs:'Google Docs',sheets:'Google Sheets',slides:'Google Slides',dida:'滴答清单',flomo:'flomo'};
        const sourceIds=Object.keys(sourceNames);
        const [snapshot,setSnapshot]=React.useState(null);
        const [busy,setBusy]=React.useState(false);
        const [error,setError]=React.useState('');
        const [authorization,setAuthorization]=React.useState(null);
        const active=React.useRef(false);
        const inFlight=React.useRef(false);
        const latest=React.useRef(null);
        const controllers=React.useRef(new Set());
        const invalidate=()=>{
          latest.current=null;
          if(active.current){setSnapshot(null);setAuthorization(null);}
        };
        const accept=value=>{
          if(!value||!Array.isArray(value.sources)||value.sources.length!==sourceIds.length||!value.googleAuth||typeof value.googleAuth!=='object'||Array.isArray(value.googleAuth)||!['clientConfigured','refreshConfigured','authInProgress'].every(key=>typeof value.googleAuth[key]==='boolean'))throw new Error('invalid context status');
          const rows=sourceIds.map(id=>{
            const matches=value.sources.filter(row=>row?.id===id);
            if(matches.length!==1)throw new Error('invalid context source');
            const row=matches[0];
            if(typeof row.configured!=='boolean'||typeof row.enabled!=='boolean')throw new Error('invalid context access');
            return{id,name:sourceNames[id],configured:row.configured,enabled:row.enabled,status:row.status??row.state,lastReadAt:typeof row.lastReadAt==='string'&&row.lastReadAt.length<=80&&Number.isFinite(Date.parse(row.lastReadAt))?row.lastReadAt:null};
          });
          const state={sources:rows,googleAuth:{clientConfigured:value.googleAuth.clientConfigured===true,refreshConfigured:value.googleAuth.refreshConfigured===true,authInProgress:value.googleAuth.authInProgress===true}};
          if(active.current){latest.current=state;setSnapshot(state);if(state.googleAuth.refreshConfigured||!state.googleAuth.clientConfigured||!state.googleAuth.authInProgress)setAuthorization(null);}
          return state;
        };
        const request=async body=>{
          const controller=new AbortController();controllers.current.add(controller);
          try{
            const response=await fetch(contextEndpoint,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
            if(!response.ok)throw new Error('context operation failed');
            return await response.json();
          }finally{controllers.current.delete(controller);}
        };
        const refresh=async()=>{
          if(!active.current||inFlight.current)return;
          inFlight.current=true;setBusy(true);setError('');
          try{const value=await request();if(active.current)accept(value);}
          catch{if(active.current){invalidate();setError('资料来源状态暂不可用，请刷新状态后重试。');}}
          finally{inFlight.current=false;if(active.current)setBusy(false);}
        };
        React.useEffect(()=>{
          active.current=true;void refresh();
          return()=>{active.current=false;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
        },[]);
        const mutate=async(action,source)=>{
          if(!active.current||inFlight.current||!latest.current)return;
          if(action==='google_authorize'){
            if(!latest.current.googleAuth.clientConfigured)return;
          }else{
            const row=latest.current.sources.find(item=>item.id===source);
            if(!row||(action==='connect'&&(!row.configured||row.enabled))||(action==='disconnect'&&!row.enabled))return;
          }
          inFlight.current=true;setBusy(true);setError('');
          if(action==='google_authorize')setAuthorization(null);
          try{
            const value=await request({action,...(source?{source}:{})});
            if(!active.current)return;
            if(action==='google_authorize'){
              const url=new URL(value?.url);
              if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.hash||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt)))throw new Error('invalid authorization link');
              setAuthorization({url:url.toString(),expiresAt:value.expiresAt});
            }else accept(value);
          }catch{if(active.current){invalidate();setError('操作结果暂不确定，请刷新状态核对；不会自动重试。');}}
          finally{inFlight.current=false;if(active.current)setBusy(false);}
        };
        const rows=snapshot?.sources??sourceIds.map(id=>({id,name:sourceNames[id],configured:false,enabled:false,lastReadAt:null}));
        const google=snapshot?.googleAuth;
        const statusText=row=>!snapshot?'状态未确认':!row.configured?'待账号授权':!row.enabled?'已配置，当前对话尚未启用':row.lastReadAt?'当前对话已启用':'当前对话已启用；本次启动暂无读取记录';
        return h('div',{className:'pc_setup','data-context-panel':true},
          h('h2',null,'个人资料来源'),
          h('p',null,'按需连接你自己的邮箱、日历、文档、任务和笔记。开启某个来源只验证读取接口；只有你明确查询时才读取资料，不会自动扫描、写入项目记忆或建立推送计划。'),
          h('section',{className:'pc_card'},h('h3',null,'在原生插件配置中填写凭据'),
            h('p',{className:'pc_muted'},'在下方原生配置表单填写并保存。也可打开插件页 → DeepSeek Dot → 配置。令牌只在原生密钥字段输入，请勿在聊天里发送。flomo 使用 MCP 访问令牌（不是写入笔记的 Webhook）；滴答清单使用账号 API 口令。'),
            h('p',{className:'pc_muted'},'Google 需要你自己的 Desktop OAuth Client ID 和 Client Secret。在插件配置填写后，点击下方按钮生成只读授权链接，再由你打开 Google 授权页。'),
            h(CredentialForm,{sources:snapshot?.sources,googleAuth:google,onSaved:refresh}),
            h('p',{role:'status'},!google?'Google 状态未确认':google.refreshConfigured?'Google 账号凭据已保存；各资料来源仍需分别启用。':google.authInProgress?'Google 授权正在等待确认，完成后请刷新状态。':google.clientConfigured?'Google Desktop 应用已配置，尚未完成账号授权。':'请先在插件配置填写 Google Desktop 应用信息。'),
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||!google?.clientConfigured,onClick:()=>mutate('google_authorize')},'连接 Google 账号'),h('button',{type:'button',disabled:busy,onClick:refresh},'刷新资料来源状态')),
            authorization?h('p',null,h('a',{href:authorization.url,target:'_blank',rel:'noopener noreferrer'},'打开 Google 只读授权页'),h('span',{className:'pc_muted'},` · 链接有效至 ${authorization.expiresAt}；不会自动打开。`)):null),
          rows.map(row=>h('section',{className:'pc_card',key:row.id,'data-context-source':row.id},h('h3',null,row.name),h('p',{role:'status'},statusText(row)),row.enabled&&row.lastReadAt?h('p',{className:'pc_muted'},`上次读取：${row.lastReadAt}。此时间不代表资料已全部读取或持续监控。`):null,
            h('div',{className:'pc_actions'},h('button',{type:'button',disabled:busy||!snapshot||(!row.enabled&&!row.configured),onClick:()=>mutate(row.enabled?'disconnect':'connect',row.id)},row.enabled?'停止此来源':'启用只读来源')))),
          error?h('p',{className:'pc_error',role:'alert'},error):null,
          h('p',{className:'pc_muted'},'停止某个来源后，Dot 不再通过当前对话读取它；服务商账号的授权可在其账号设置中另行撤销。资料来源的外部内容只作为资料，不作为新的操作指令。'));
      }
      const Section=props=>h('div',null,Surface(props,false),h(ContextPanel));
      const Onboarding=props=>Surface(props,true);
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'project-companion',order:39,label:'DeepSeek Dot'},Section)));
      ctx.effect(()=>ctx.slots.inject('settings.onboarding',()=>ctx.slots.register({name:'settings.onboarding',id:'project-companion-dot',order:50},Onboarding)));
      const forms=typeof ctx.get==='function'?ctx.get('configForms',false):ctx.configForms;
      if(forms)ctx.effect(()=>ctx.slots.inject('plugins.row.config',()=>ctx.slots.register({name:'plugins.row.config',key:'dsh-project-companion#project-companion'},props=>props.view==='summary'?'DeepSeek Dot 的个人资料来源与原生凭据配置':h('div',{className:'pc_setup'},h('h3',null,'连接凭据'),h(CredentialForm)))));
    }
    return{inject,apply};
  },
});
