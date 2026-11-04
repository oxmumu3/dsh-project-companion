/** One internal call through the Host's selected executor; ambiguous outcomes are never retried. */
export async function executeHostTool(tools,input){
 if(typeof tools?.execute!=='function')throw Error('Host tool executor unavailable');
 input.signal?.throwIfAborted();
 if(typeof tools.selectExecutor!=='function')return tools.execute(input);
 const settled=await tools.execute({calls:[{id:input.callId,name:input.name,arguments:JSON.stringify(input.arguments)}],...(input.agent===undefined?{}:{agent:input.agent}),signal:input.signal});
 const rows=settled?.results;
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.callId!==input.callId||typeof rows[0]?.result!=='object'||rows[0].result===null)throw Error('Host tool settlement is missing or ambiguous');
 return rows[0].result;
}
