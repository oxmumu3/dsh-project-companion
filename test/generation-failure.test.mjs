import test from 'node:test';
import assert from 'node:assert/strict';
import {generationFailure, renderGenerationResult} from '../src/generation-failure.js';

test('model generation failure is distinct from authorization and never claims no reads',()=>{
 const value=generationFailure('review',Object.assign(Error('private body'),{code:'MODEL_INVALID_OUTPUT',reviewDiagnostic:{stage:'model',code:'MODEL_INVALID_OUTPUT',evidenceCount:7,sourceCount:5,model:{textChars:15,reasoningChars:20,finish:'stop'}}}));
 assert.equal(value.status,'failed');assert.equal(value.diagnostic.code,'MODEL_INVALID_OUTPUT');
 assert.match(value.text,/整理/);assert.doesNotMatch(value.text,/Owner|授权不可|没有读取|未读取/);
 assert.doesNotMatch(JSON.stringify(value),/private body/);
 assert.equal(value.diagnostic.evidenceCount,7);
});
test('request supersession is not reported as a broken account',()=>{
 const value=generationFailure('review',Object.assign(Error('raw details'),{code:'FAMILY_PERSONAL_REQUEST_CHANGED'}));
 assert.equal(value.status,'blocked');assert.match(value.text,/请求|范围/);assert.doesNotMatch(value.text,/重新登录|重新扫码/);
});
test('news failures retain bounded stage and safe counts only',()=>{
 const value=generationFailure('news',Object.assign(Error('secret-token'),{code:'MODEL_TOKEN_LIMIT',newsDiagnostic:{stage:'selection',code:'MODEL_TOKEN_LIMIT',candidateCount:50,privateText:'secret-token',model:{textChars:0,reasoningChars:2000,outputTokens:1800,reasoningEffort:'max',finish:'max-tokens',raw:'secret-token'}}}));
 assert.equal(value.status,'failed');assert.match(value.text,/输出/);assert.equal(value.diagnostic.candidateCount,50);
 assert.doesNotMatch(JSON.stringify(value),/secret-token/);
 assert.equal(renderGenerationResult(value).length,2);
});
test('unknown errors and diagnostics never echo arbitrary strings',()=>{
 const value=generationFailure('review',Object.assign(Error('Bearer secret'),{code:'SECRET_VALUE',reviewDiagnostic:{stage:'private-email',code:'SECRET',evidenceCount:-2,sourceCount:'token'}}));
 assert.equal(value.diagnostic.code,'GENERATION_FAILED');assert.equal(value.diagnostic.stage,'unknown');
 assert.doesNotMatch(JSON.stringify(value),/Bearer|private-email|SECRET|token/);
 assert.equal(renderGenerationResult({text:'成功'}).length,1);
});
test('delivery and validation failures do not masquerade as source read failures',()=>{
 for(const [code,word] of [['REVIEW_DELIVERY_FAILED','发送'],['REVIEW_VALIDATION_FAILED','格式']]){
  const value=generationFailure('review',Object.assign(Error('private'),{code}));
  assert.match(value.text,new RegExp(word));assert.doesNotMatch(value.text,/资料读取未完成/);
 }
 const cancelled=generationFailure('review',Object.assign(Error('private'),{code:'REVIEW_CANCELLED'}));
 assert.match(cancelled.text,/停止/);assert.doesNotMatch(cancelled.text,/再发预览/);
 const timeout=generationFailure('review',Object.assign(Error('private'),{code:'REVIEW_TIMEOUT'}));
 assert.match(timeout.text,/限定时间/);assert.doesNotMatch(timeout.text,/取消|暂停|再发预览/);
});
test('news cancellation and pause stay blocked while its total timeout is a generation failure',()=>{
 for(const code of ['NEWS_CANCELLED','NEWS_PAUSED']){
  const value=generationFailure('news',Object.assign(Error('private'),{code}));
  assert.equal(value.status,'blocked');assert.match(value.text,/停止/);
 }
 const timeout=generationFailure('news',Object.assign(Error('private'),{code:'NEWS_TIMEOUT'}));
 assert.equal(timeout.status,'failed');assert.match(timeout.text,/限定时间/);
});
