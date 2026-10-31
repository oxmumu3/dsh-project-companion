// Whole authenticated Owner utterances only. Metadata selection does not
// authorize reading files, changing subscriptions, dispatching or scheduling.
export function parseFamilyCatalogList(args,userText){
  if(args?.action!=='list'||typeof userText!=='string'||userText.length>400||Object.keys(args).some(k=>!['action','query','offset','limit','catalogRevision','userRequested'].includes(k)))return null;
  const text=userText.normalize('NFKC').trim();
  const suffix='(?:\\s*第\\s*([1-9]\\d{0,4})\\s*页)?(?:[，,]\\s*每页\\s*([1-9]\\d?)\\s*个)?[。.]?$';
  const list=new RegExp('^(?:请|帮我)?\\s*列出\\s*(?:我的\\s*)?(?:全部|所有)?\\s*(?:DeepSeek\\s*)?Harness\\s*(?:的)?项目'+suffix,'i').exec(text);
  const search=new RegExp('^(?:请|帮我)?\\s*搜索\\s*(?:我的\\s*)?(?:DeepSeek\\s*)?Harness\\s*(?:的)?项目\\s*(?:「([^」\\r\\n]{1,80})」|“([^”\\r\\n]{1,80})”|"([^"\\r\\n]{1,80})")'+suffix,'i').exec(text);
  if(!list&&!search)return null;
  const query=search?(search[1]??search[2]??search[3]).trim():'',page=Number(list?.[1]??search?.[4]??1),limit=Number(list?.[2]??search?.[5]??20),offset=(page-1)*limit;
  if(search&&!query||limit>50||!Number.isSafeInteger(offset))return null;
  if(args.query!==undefined&&(typeof args.query!=='string'||args.query.normalize('NFKC').toLowerCase().trim()!==query.toLowerCase())||args.offset!==undefined&&args.offset!==offset||args.limit!==undefined&&args.limit!==limit)return null;
  if(args.catalogRevision!==undefined&&(typeof args.catalogRevision!=='string'||!/^[a-f0-9]{64}$/.test(args.catalogRevision))||offset>0&&args.catalogRevision===undefined)return null;
  return{query,offset,limit,...(args.catalogRevision?{expectedRevision:args.catalogRevision}:{})};
}
