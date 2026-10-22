import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('../src/context-provider.js').catch(()=>null);
test('Calendar exclusively uses REST and never falls back to legacy Google MCP',async()=>{assert.equal(typeof mod?.createContextProvider,'function');const seen=[];const calendar={catalog:async()=>{seen.push('calendar catalog');return{provenance:'bundled-contract',tools:[]};},call:async()=>{seen.push('calendar call');throw Error('synthetic failure');},close:async()=>seen.push('calendar close')};const mcp={catalog:async s=>{seen.push(s+' mcp');return{tools:[]};},call:async()=>{throw Error('must not fall back');},close:async()=>seen.push('mcp close')};const p=mod.createContextProvider({calendar,mcp});assert.equal((await p.catalog('calendar',{})).provenance,'bundled-contract');await assert.rejects(p.call('calendar','list_events',{},{}));await p.catalog('docs',{});assert.deepEqual(seen,['calendar catalog','calendar call','docs mcp']);await p.close();assert.deepEqual(seen.slice(-2),['calendar close','mcp close']);});

test('ordinary suite provider is selected explicitly and never falls back after a failed REST read',async()=>{const calls=[];const calendar={catalog:async()=>{},call:async()=>{},close(){}};const suite={catalog:async s=>{calls.push(s+' rest');return{};},call:async()=>{calls.push('rest call');throw Error('failed REST');},close(){calls.push('suite close');}};const mcp={catalog:async s=>{calls.push(s+' mcp');return{};},call:async()=>{calls.push('wrong fallback');},close(){}};const p=mod.createContextProvider({calendar,suite,mcp,useSuite:source=>source==='gmail'});await p.catalog('gmail',{});await assert.rejects(p.call('gmail','get_message',{},{}));await p.catalog('flomo',{});assert.deepEqual(calls,['gmail rest','rest call','flomo mcp']);await p.close();assert.ok(calls.includes('suite close'));});

test('Dida OAuth selects REST explicitly, keeps legacy MCP and never falls back after REST failure',async()=>{
 const calls=[];let oauth=true;const calendar={catalog:async()=>{},call:async()=>{}};
 const dida={catalog:async()=>{calls.push('dida REST catalog');return{provenance:'bundled-contract',tools:[]};},call:async()=>{calls.push('dida REST call');throw Error('REST rejected');},close(){calls.push('dida close');}};
 const mcp={catalog:async source=>{calls.push(source+' MCP');return{tools:[]};},call:async()=>{calls.push('unexpected fallback');}};
 const p=mod.createContextProvider({calendar,dida,mcp,useDidaRest:()=>oauth});await p.catalog('dida',{});await assert.rejects(p.call('dida','list_projects',{},{}));assert.deepEqual(calls,['dida REST catalog','dida REST call']);
 oauth=false;await p.catalog('dida',{});await p.catalog('flomo',{});assert.deepEqual(calls.slice(-2),['dida MCP','flomo MCP']);await p.close();assert.equal(calls.at(-1),'dida close');
});

test('explicit Dida REST selection cannot fall through to MCP when the adapter is absent',async()=>{
 let calls=0;const calendar={catalog:async()=>{},call:async()=>{}},mcp={catalog:async()=>{calls++;},call:async()=>{calls++;}};
 const p=mod.createContextProvider({calendar,mcp,useDidaRest:()=>true});assert.throws(()=>p.catalog('dida',{}),/滴答/);assert.equal(calls,0);await p.close();
});
