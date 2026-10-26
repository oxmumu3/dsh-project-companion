import {createHash} from 'node:crypto';

// A UI concurrency precondition, not a credential. Domain separation prevents
// exposing the bridge's binding key or using this value as a bridge identity.
export function bindingRevision(value){
  if(value?.state!=='bound'||typeof value.sessionId!=='string'||!value.sessionId||value.sessionId.length>200||!(/^[a-f0-9]{64}$/u.test(value.bindingKey??'')))return null;
  return createHash('sha256').update(JSON.stringify(['dsh-dot-workbench-scope-v1',value.sessionId,value.bindingKey])).digest('hex');
}

export function matchesBindingRevision(input,current){
  if(!Object.hasOwn(input,'expectedBindingRevision'))return true; // Older clients.
  return typeof input.expectedBindingRevision==='string'&&/^[a-f0-9]{64}$/u.test(input.expectedBindingRevision)&&input.expectedBindingRevision===bindingRevision(current);
}
