#!/usr/bin/env node
/** Report the model-facing routing surface and the phrasing corpus coverage.
 *  Run after changing the tool surface: `npm run report:routing`. */
import {readFile} from 'node:fs/promises';
import {registerGuidance} from '../src/guidance.js';
import {LOOK_VIEWS,MANAGE_OPS,normalizeSurfaceAction} from '../src/action-surface.js';
import {CORPUS} from '../test/routing-corpus.mjs';

const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
function surface(tool){
  const at=source.indexOf(`name:'${tool}',\n    description:'`);
  const description=/description:'([^']*)'/.exec(source.slice(at,at+4000))[1];
  const list=/action:\{type:'string',required:true,enum:\[([^\]]*)\]/.exec(source.slice(at,at+8000))[1]
    .split(',').map(value=>value.trim().replace(/^'|'$/g,'')).filter(Boolean);
  return {description,list};
}
let section;
registerGuidance({systemPrompt:{section:value=>{section=value;}},tools:{get:()=>({})}},{clock:()=>new Date(),hostTimeZone:()=>Intl.DateTimeFormat().resolvedOptions().timeZone});
const promptText=section.text({scope:{id:'synthetic-report'}});
const project=surface('project_companion');
const composites=project.list.filter(name=>name==='look'||name==='manage');
const legacy=project.list.filter(name=>!composites.includes(name));

const routed=CORPUS.filter(([,entry,key])=>{
  const args=entry==='look'?{action:'look',view:key,project:'p'}:{action:'manage',op:key,project:'p'};
  try{return normalizeSurfaceAction(args).action!==entry;}catch{return false;}
});

console.log('模型可见路由面报告');
console.log(`工具动作数        ${project.list.length}（入口 ${composites.length} 个：${composites.join('、')}；兼容旧名 ${legacy.length} 个）`);
console.log(`look 视角          ${LOOK_VIEWS.length} 个：${LOOK_VIEWS.join('、')}`);
console.log(`manage 动作        ${MANAGE_OPS.length} 个：${MANAGE_OPS.join('、')}`);
console.log(`策略提示词         ${promptText.length} 字符`);
console.log(`工具描述           ${project.description.length} 字符`);
console.log(`评测语料           ${CORPUS.length} 句，可解析到入口 ${routed.length} 句`);
console.log('');
console.log('说明：入口数决定模型一次要在几个名字里选；兼容旧名不删是为了不破坏已安装。');
