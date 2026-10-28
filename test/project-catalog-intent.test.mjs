import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../src/project-catalog-intent.js').catch(()=>({}));
test('Family catalog list reconstructs only whole authenticated metadata requests',()=>{
 assert.equal(typeof m.parseFamilyCatalogList,'function');
 assert.deepEqual(m.parseFamilyCatalogList({action:'list'},'请列出我的 Harness 项目。'),{query:'',offset:0,limit:20});
 assert.deepEqual(m.parseFamilyCatalogList({action:'list',query:'DeepSeek'},'搜索我的 DeepSeek Harness 项目「DeepSeek」'),{query:'DeepSeek',offset:0,limit:20});
 assert.deepEqual(m.parseFamilyCatalogList({action:'list',offset:20,limit:20,catalogRevision:'a'.repeat(64)},'列出我的Harness项目第2页，每页20个'),{query:'',offset:20,limit:20,expectedRevision:'a'.repeat(64)});
});
test('Family catalog ignores neither extra qualifiers nor model-invented scope',()=>{
 assert.equal(typeof m.parseFamilyCatalogList,'function');
 for(const text of ['列出我的Harness项目，只看未完成','列出我的Harness项目并读取所有README','列出我的Harness项目。再关注全部','不要列出我的Harness项目','能不能列出我的Harness项目？','搜索我的Harness项目DeepSeek','继续刚才的项目目录','列出我的Harness项目第2页，每页51个'])assert.equal(m.parseFamilyCatalogList({action:'list'},text),null,text);
 for(const args of [{action:'list',query:'private'},{action:'list',offset:20},{action:'list',limit:50},{action:'list',project:'/private'},{action:'watch'},{action:'list',catalogRevision:'raw-token'}])assert.equal(m.parseFamilyCatalogList(args,'列出我的Harness项目'),null,JSON.stringify(args));
});
