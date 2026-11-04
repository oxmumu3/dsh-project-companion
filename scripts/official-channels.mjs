const registry='https://registry.npmjs.org/@deepseek-ai%2fdsh';
const desktopFeed='https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml';
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function version(value){
 if(typeof value!=='string'||!semver.test(value)||value.split('+',1)[0].split('-').slice(1).join('-').split('.').some(x=>/^0\d+$/.test(x)))throw Error('Invalid exact official version');
 return value;
}
export function parseDesktopVersion(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>256*1024)throw Error('Official desktop feed unavailable or oversized');
 const values=[];
 for(const line of text.replace(/^\ufeff/,'').split(/\r?\n/)){
  if(!line.trim()||/^[ \t#]/.test(line))continue;
  const field=/^(?:([A-Za-z_][A-Za-z0-9_-]*)|("version"|'version'))[ \t]*:[ \t]*(.*)$/.exec(line);
  if(!field)throw Error('Unsupported official desktop feed syntax');
  if((field[1]??field[2].slice(1,-1))==='version')values.push(field[3]);
 }
 if(values.length!==1)throw Error('Official desktop feed requires one unambiguous version');
 const scalar=/^(?:"([^"]+)"|'([^']+)'|([^\s#]+))(?:[ \t]+#[^\r\n]*)?[ \t]*$/.exec(values[0]);
 if(!scalar)throw Error('Invalid official desktop version scalar');
 return version(scalar.slice(1).find(x=>x!==undefined));
}
async function boundedText(response,limit){
 if(!response?.ok)throw Error('Official source lookup failed: '+response?.status);
 if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>limit)throw Error('Official source response oversized');return text;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Official source response oversized');chunks.push(value);}}finally{await reader.cancel();}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
export async function readOfficialChannels({fetcher=fetch}={}){
 const options={signal:AbortSignal.timeout(15000)};
 const [sdkText,feed]=await Promise.all([fetcher(registry,options).then(r=>boundedText(r,16*1024*1024)),fetcher(desktopFeed,options).then(r=>boundedText(r,256*1024))]);
 const sdk=JSON.parse(sdkText),sdkLatest=version(sdk?.['dist-tags']?.latest),desktop=parseDesktopVersion(feed);
 if(!sdk?.versions||!Object.hasOwn(sdk.versions,sdkLatest)||!Object.hasOwn(sdk.versions,desktop))throw Error('Official desktop or latest SDK is not published in the exact registry metadata');
 return{sdkLatest,desktop,tags:sdk['dist-tags']};
}
