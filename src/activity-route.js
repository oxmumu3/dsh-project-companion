/** Read-only activity projection. It owns no store and never executes a task. */
export function registerActivityRoute(ctx,{snapshot,isClosed=()=>false}={}){
  const connection=ctx.get('connection');
  if(typeof connection?.fetch?.register!=='function')return null;
  let closed=false;
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const unregister=connection.fetch.register({path:'/api/project_companion/activity',methods:['GET'],requestBody:'buffered',async fetch(request){
    if(closed||isClosed())return json({error:'会话账本已关闭。'},503);
    if(request.method!=='GET')return json({error:'仅支持只读 GET。'},405);
    try{
      if(new URL(request.url).search||request.body!=null)return json({error:'只读账本不接受参数或请求正文。'},400);
      const value=await snapshot();
      return closed?json({error:'会话账本已关闭。'},503):json(value);
    }catch{return json({error:'会话账本暂不可用，请稍后核对。'},503);}
  }});
  const stop=()=>{if(closed)return;closed=true;unregister?.();};
  if(typeof ctx.effect==='function')ctx.effect(()=>stop);
  return stop;
}
