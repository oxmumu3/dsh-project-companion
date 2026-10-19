/* Client half: reuse the official settings shell and the upstream QR viewer. */
window.__ModuleLoader__.load({
  id:'dsh-project-companion',
  factory:require=>{
    const React=require('react');
    const {Modal}=require('@deepseek-ai/dsh-client-ui-primitives');
    const h=React.createElement;
    const endpoint='/api/project_companion/onboarding';
    const inject=['slots','uiWorkspace'];
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
      const Section=props=>Surface(props,false);
      const Onboarding=props=>Surface(props,true);
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'project-companion',order:39,label:'DeepSeek Dot'},Section)));
      ctx.effect(()=>ctx.slots.inject('settings.onboarding',()=>ctx.slots.register({name:'settings.onboarding',id:'project-companion-dot',order:50},Onboarding)));
    }
    return{inject,apply};
  },
});
