/** Explicit provider routing. Calendar's ordinary connection uses REST only;
 * advanced Google MCP credentials are never a fallback for Calendar failure.
 */
export function createContextProvider({calendar,suite,mcp,useSuite=()=>false}={}){
 if(typeof calendar?.catalog!=='function'||typeof calendar?.call!=='function'||typeof mcp?.catalog!=='function'||typeof mcp?.call!=='function')throw new Error('Context 读取接口未就绪。');
 if(suite&&(typeof suite.catalog!=='function'||typeof suite.call!=='function'))throw new Error('Google 读取接口未就绪。');
 const provider=source=>source==='calendar'?calendar:suite&&['gmail','drive','docs','sheets','slides'].includes(source)&&useSuite(source)?suite:mcp;
 return{
  catalog:(source,settings)=>provider(source).catalog(source,settings),
  call:(source,name,args,settings)=>provider(source).call(source,name,args,settings),
  async close(){await Promise.allSettled([calendar.close?.(),suite?.close?.(),mcp.close?.()]);},
 };
}
