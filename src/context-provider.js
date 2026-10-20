/** Explicit provider routing. Calendar's ordinary connection uses REST only;
 * advanced Google MCP credentials are never a fallback for Calendar failure.
 */
export function createContextProvider({calendar,mcp}={}){
 if(typeof calendar?.catalog!=='function'||typeof calendar?.call!=='function'||typeof mcp?.catalog!=='function'||typeof mcp?.call!=='function')throw new Error('Context 读取接口未就绪。');
 return{
  catalog:(source,settings)=>(source==='calendar'?calendar:mcp).catalog(source,settings),
  call:(source,name,args,settings)=>(source==='calendar'?calendar:mcp).call(source,name,args,settings),
  async close(){await Promise.allSettled([calendar.close?.(),mcp.close?.()]);},
 };
}
