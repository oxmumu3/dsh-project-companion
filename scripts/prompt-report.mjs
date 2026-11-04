#!/usr/bin/env node
/** Report the model-facing instruction surface: prompt size and action coverage.
 *  Run after changing guidance or tool descriptions: `npm run report:prompt`. */
import {readFile} from 'node:fs/promises';
import {registerGuidance} from '../src/guidance.js';

const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
const TOOLS=['project_companion','personal_review','ai_digest','personal_context'];

const slice=tool=>{
  const at=source.indexOf(`name:'${tool}',\n    description:'`);
  return source.slice(at,at+8000);
};
const actions=tool=>{
  const match=/action:\{type:'string',required:true,enum:\[([^\]]*)\]/.exec(slice(tool));
  return match[1].split(',').map(value=>value.trim().replace(/^'|'$/g,'')).filter(Boolean);
};
const description=tool=>{
  const match=new RegExp(`name:'${tool}',\\n    description:'((?:[^'\\\\]|\\\\.)*)'`).exec(source);
  return match[1];
};

let section;
registerGuidance({systemPrompt:{section:value=>{section=value;}},tools:{get:()=>({})}},{clock:()=>new Date(),hostTimeZone:()=>Intl.DateTimeFormat().resolvedOptions().timeZone});
const promptText=section.text({scope:{id:'synthetic-report'}});

let descriptionChars=0;
const rows=[];
for(const tool of TOOLS){
  const text=description(tool);
  descriptionChars+=text.length;
  const list=actions(tool);
  const routed=list.filter(action=>promptText.includes(action)).length;
  rows.push({tool,actions:list.length,routed,descriptionChars:text.length});
}

console.log('模型可见指令面报告');
console.log(`策略提示词  ${promptText.length} 字符`);
console.log(`工具描述    ${descriptionChars} 字符`);
console.log(`合计        ${promptText.length+descriptionChars} 字符`);
console.log('');
console.log('工具            动作数  提示词中可发现  描述字符');
for(const row of rows)console.log(`${row.tool.padEnd(16)}${String(row.actions).padStart(4)}  ${String(row.routed).padStart(12)}  ${String(row.descriptionChars).padStart(8)}`);
console.log('');
console.log('说明：提示词只负责路由与边界，参数语义在各工具 schema 内；动作覆盖不足时更新 src/guidance.js。');
