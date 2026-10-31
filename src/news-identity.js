import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Exact public-article identity only, not speculative semantic similarity.
// Keep meaningful query parameters (version, language, page, etc.).
export function publicNewsIdentity(article){
 const url=new URL(article.url);url.hash='';
 for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
 url.search=url.searchParams.toString();
 const title=article.title.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
 return{urlKey:hash(url.href),...(title.length>=24?{eventKey:hash(`${new Date(article.publishedAt).toISOString().slice(0,10)}:${title}:${(article.excerpt??'').normalize('NFKC').replace(/\s+/gu,' ').trim()}`)}:{})};
}
