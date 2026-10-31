import {AsyncLocalStorage} from 'node:async_hooks';

/**
 * A Family call can borrow an existing Dot lease only inside a verified,
 * request-scoped capability. It never rewrites or enables that lease.
 */
export function createFamilyContextAdapter({delegation,context}={}){
  if(!delegation||!context)throw Error('FAMILY_CONTEXT_CONFIGURATION');
  const local=new AsyncLocalStorage();
  function checkedScope(){const scope=local.getStore();if(scope&&!delegation.current(scope))throw Error('FAMILY_CONTEXT_REVOKED');return scope;}
  function mapped(owner){
    const scope=checkedScope();
    if(!scope)return owner;
    if(owner?.sessionId!==scope.familySessionId)throw Error('FAMILY_CONTEXT_FOREIGN_SESSION');
    return{...owner,sessionId:scope.originSessionId};
  }
  return{
    async run(scope,fn){
      if(!delegation.current(scope)||!await delegation.recheck(scope))throw Error('FAMILY_CONTEXT_REVOKED');
      return local.run(scope,async()=>{
        const value=await fn();
        if(!delegation.current(scope)||!await delegation.recheck(scope))throw Error('FAMILY_CONTEXT_REVOKED');
        return value;
      });
    },
    async bindingOverride(sessionId){
      const scope=checkedScope();if(!scope)return null;
      if(sessionId!==scope.originSessionId)throw Error('FAMILY_CONTEXT_FOREIGN_SESSION');
      if(!await delegation.recheck(scope))throw Error('FAMILY_CONTEXT_REVOKED');
      return{kind:'bound',bindingKey:scope.originBindingKey};
    },
    act(owner,args){
      const scope=checkedScope();
      if(scope&&!['connections','query','brief'].includes(args?.action))throw Error('FAMILY_CONTEXT_MUTATION_NOT_ALLOWED');
      return context.act(mapped(owner),args);
    },
    authorization(owner,sources){return context.authorization(mapped(owner),sources);},
    assertAuthorization(owner,sources,grant){return context.assertAuthorization(mapped(owner),sources,grant);},
    snapshot(owner){return context.snapshot(mapped(owner));},
    activeScope(){return checkedScope();},
  };
}
