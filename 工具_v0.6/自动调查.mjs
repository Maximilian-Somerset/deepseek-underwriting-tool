import fs from 'node:fs/promises';
import path from 'node:path';
import {searchWeb,fetchWeb} from './联网接口.mjs';
import {readDocument,download,decodeHTML,parseSo,relevant,discoverLinks,FIELD_PATTERNS,CRAWLER_VERSION} from './公开检索.mjs';
import {digest,localSources} from './处理逻辑.mjs';

export const VERSION='0.6.0';
export const normalizeURL=value=>{try{const url=new URL(value);if(!/^https?:$/.test(url.protocol)||url.username||url.password)return '';url.hash='';return url.href;}catch{return '';}};
export async function readCache(filename,hours,refresh=false){
 if(refresh)return null;
 try{const data=JSON.parse(await fs.readFile(filename,'utf8'));if(Date.now()-Date.parse(data.saved)<hours*3600000)return data.value;}catch{}
 return null;
}
export async function writeJSON(filename,value){await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,JSON.stringify(value,null,2));}
export const writeCache=(filename,value)=>writeJSON(filename,{saved:new Date().toISOString(),value});
export function validateSettings(settings){
 const limits={maxCompaniesPerRun:[1,1000],maxTokens:[1000,32000],maxSearchRequests:[1,30],initialSearchRequests:[1,20],maxReadAttempts:[0,50],maxFetchRequests:[0,30],maxSupplementRounds:[0,2],maxCompanySeconds:[30,3600],searchResultsPerQuery:[1,50],maxDocumentBytes:[1000000,100000000],sourceCharBudget:[20000,200000],cacheDays:[0,30],searchCacheHours:[0,168],timeoutMs:[10000,600000]};
 for(const [name,[minimum,maximum]] of Object.entries(limits))if(!Number.isInteger(settings[name])||settings[name]<minimum||settings[name]>maximum)throw new Error(`${name}必须是${minimum}至${maximum}之间的整数`);
 if(settings.initialSearchRequests>settings.maxSearchRequests)throw new Error('首轮搜索预算不能超过总搜索预算');
 if(settings.reasoningEffort&&!['low','high','max'].includes(settings.reasoningEffort))throw new Error('reasoningEffort仅支持low/high/max');
 const checkYear=value=>{if(value!==null&&value!==undefined&&(!Number.isInteger(value)||value<2000||value>new Date().getFullYear()))throw new Error('targetYear必须为2000至本年之间的整数或null');};
 checkYear(settings.targetYear);
 if(settings.financialScope&&!['parent','group','unspecified'].includes(settings.financialScope))throw new Error('financialScope仅支持parent/group/unspecified');
 for(const options of Object.values(settings.companyOptions??{}))validateSettings({...settings,...options,companyOptions:{}});
}
export function planQueries(company,year,rows,round=0){
 const factors=new Set(rows.map(row=>row.factor));const queries=[];
 if(factors.has('营业额'))queries.push(`${company} ${year} ${round===0?'年度报告 审计报告 营业收入':round===1?'年度审计报告 利润表 营业收入 全文 PDF':'跟踪评级报告 主要财务数据 营业总收入'}`);
 if(factors.has('员工人数'))queries.push(`${company} ${year} ${round===0?'员工人数 在职员工 职工人数':round===1?'员工数量 企业年报 参保人数 社保':'参保人数 员工人数 site:10jqka.com.cn OR site:tianyancha.com OR site:qcc.com'}`);
 if(round===0)queries.push(`${company} 官网 公司简介 主营业务 国民经济行业`);
 const numeric=rows.filter(row=>row.type==='number'&&!['营业额','员工人数'].includes(row.factor));
 if(numeric.length)queries.push(`${company} ${year} ${numeric.map(row=>row.factor).join(' ')} ${round?'采购 公告 项目 数量':'披露 数量'}`);
 if(rows.some(row=>/系统|SLA|服务|连接|第三方/.test(row.factor)))queries.push(`${company} ${round?'公开案例 服务协议 SLA 系统运营':'官网 系统 平台 对外服务 客户'}`);
 if(round>0&&rows.some(row=>/司法|辖区|集团/.test(row.factor)))queries.push(`${company} ${year} 子公司 境外业务 经营地域`);
 return [...new Set(queries)].map(query=>Array.from(query).slice(0,128).join(''));
}
export function rankCandidate(candidate,company,year,factors){
 const text=`${candidate.title??''} ${(candidate.text??'').slice(0,3000)}`;
 let score=(relevant(company,text)?12:0)+Number(candidate.score??0)+Math.max(0,Number(candidate.authority??0));
 if(text.includes(String(year)))score+=5;
 if((candidate.title??'').includes(String(year))&&/审计报告|年度报告/.test(candidate.title??''))score+=12;
 if(/(?:cninfo\.com\.cn|sse\.com\.cn|szse\.cn|gov\.cn|pdf\.dfcfw\.com)\//.test(candidate.url))score+=5;
 if(/\.pdf(?:$|\?)/i.test(candidate.url))score+=3;
 for(const factor of factors)if(FIELD_PATTERNS[factor]?.test(text))score+=5;
 if(/审计报告|年度报告|跟踪评级/.test(text))score+=3;
 if(candidate.attachment)score+=18;
 if(/工资|待遇|招聘/.test(candidate.title??''))score-=8;
 return score;
}
export function excerpt(text,factors,limit){
 if(text.length<=limit)return text;
 const ranges=[[0,Math.min(900,limit)]];let remaining=limit-ranges[0][1];
 const patterns=[...factors.map(factor=>FIELD_PATTERNS[factor]).filter(Boolean),FIELD_PATTERNS.业务,FIELD_PATTERNS.系统];
 for(const pattern of patterns){
  const matches=[...text.matchAll(new RegExp(pattern.source,'g'))];let added=0;
  for(const match of matches){
   const start=Math.max(0,match.index-650),end=Math.min(text.length,match.index+1500);
   if(ranges.some(([left,right])=>start<right&&end>left))continue;
   const length=Math.min(end-start,remaining);if(length<200)break;
   ranges.push([start,start+length]);remaining-=length;if(++added===3)break;
  }
 }
 return ranges.sort((left,right)=>left[0]-right[0]).map(([start,end])=>{
  const markerStart=text.lastIndexOf('【PDF第',start);const markerEnd=markerStart<0?-1:text.indexOf('】',markerStart);
  const marker=markerStart>=0&&markerEnd<start?text.slice(markerStart,markerEnd+1)+'\n':'';
  return marker+text.slice(start,end);
 }).join('\n【原文其他部分省略】\n').slice(0,limit);
}
export function selectSources(rows,manual,collected,settings,focusFactors=rows.map(row=>row.factor)){
 const factors=focusFactors;
 const local=[...localSources(rows),...(manual.texts??[]).map((source,index)=>({...source,id:`M${index+1}`,kind:'local',status:'用户提供摘录，未独立读取',url:source.url??''}))];
 const rank=source=>rankCandidate(source,rows[0].company,settings.targetYear,factors);
 const fieldScore=(source,factor)=>{
  const pattern=FIELD_PATTERNS[factor]??(/服务器|终端|数据中心/.test(factor)?new RegExp(factor.replace('数量','')):null);
  if(!pattern)return -1;
  const text=source.text??'';if(!pattern.test(text))return -1;
  let score=rank(source);
  const numeric=factor==='员工人数'?/(?:员工人数|员工数量|职工人数|在职员工|参保人数)[\s\S]{0,50}?\d{1,8}/:factor==='营业额'?/营业(?:总)?收入[\s\S]{0,80}?\d/:null;
  if(numeric?.test(text))score+=30;
  if(text.includes(String(settings.targetYear)))score+=8;
  if(source.snapshot)score+=4;
  return score;
 };
 const selected=[];const usedURLs=new Set();
 const add=source=>{if(!source)return;const url=normalizeURL(source.url)||source.id;if(usedURLs.has(url))return;usedURLs.add(url);selected.push(source);};
 const fieldLists=factors.filter(factor=>FIELD_PATTERNS[factor]||/服务器|终端|数据中心/.test(factor)).map(factor=>collected.filter(source=>fieldScore(source,factor)>=0).sort((left,right)=>fieldScore(right,factor)-fieldScore(left,factor)));
 for(let slot=0;slot<2;slot++)for(const list of fieldLists){const candidate=list.find(source=>!usedURLs.has(normalizeURL(source.url)||source.id));add(candidate);}
 for(const source of [...collected].sort((left,right)=>rank(right)-rank(left)))add(source);
 const ranked=selected.slice(0,12);
 const localBudget=Math.min(24000,Math.floor(settings.sourceCharBudget*0.3));
 const sources=[];let localSize=0,webSize=0;
 for(const source of local){const limit=Math.min(8000,localBudget-localSize);if(limit<200)break;const text=excerpt(String(source.text??''),factors,Math.max(100,limit-100));if(text){sources.push({...source,text});localSize+=text.length;}}
 const webBudget=settings.sourceCharBudget-localSize;
 const fairLimit=Math.max(1500,Math.floor(webBudget/Math.max(1,ranked.length)));
 for(const source of ranked){const limit=Math.min(source.selectedPages?30000:12000,fairLimit,webBudget-webSize);if(limit<200)break;
  const text=excerpt(String(source.text??''),factors,Math.max(100,limit-100));if(text){sources.push({...source,text});webSize+=text.length;}
 }
 return sources;
}
const fatalAccount=error=>/HTTP (401|402)/.test(error.message);
export class CompanyResearch{
 constructor({company,rows,settings,manual={},folder,cacheDir,refresh=false,dependencies={}}){
  Object.assign(this,{company,rows,settings,manual,folder,cacheDir,refresh});
  this.dependencies={search:searchWeb,fetch:fetchWeb,read:readDocument,publicSearch:async query=>{const data=await download('https://www.so.com/s?q='+encodeURIComponent(query),3000000);return parseSo(decodeHTML(data.bytes,data.type),company);},...dependencies};
  this.sources=[];this.candidates=new Map();this.seenSources=new Set();this.visited=new Set();this.queries=new Set();this.events=[];this.errors=[];
  this.counts={searchRequests:0,fetchRequests:0,publicSearchRequests:0,readAttempts:0,readSuccess:0,searchCacheHits:0,documentCacheHits:0};
  this.deadline=Date.now()+settings.maxCompanySeconds*1000;this.networkStopped=false;this.searchStopped=false;this.fetchStopped=false;
  for(const url of manual.urls??[])this.addCandidate({url,title:company+' 用户指定来源',score:20});
 }
 expired(){return Date.now()>=this.deadline;}
 searchCount(){return this.counts.searchRequests+this.counts.publicSearchRequests;}
 addCandidate(candidate){const url=normalizeURL(candidate.url);if(!url)return;const previous=this.candidates.get(url);this.candidates.set(url,{...previous,...candidate,url});}
 addSource(source){
  if(!source.text||!relevant(this.company,(source.title??'')+' '+source.text))return false;
  const normalized={...source,url:normalizeURL(source.url)};
  const key=digest({url:normalized.url,kind:normalized.kind,text:normalized.text});if(this.seenSources.has(key))return false;
  this.seenSources.add(key);this.sources.push({...normalized,id:`W${this.sources.length+1}`});
  for(const link of [...(source.links??[]).map(link=>typeof link==='string'?{url:link}:link),...discoverLinks(source.text,source.url)])this.addCandidate(link);
  return true;
 }
 async search(query){
  if(this.queries.has(query)||this.expired()||this.networkStopped||this.searchStopped||this.searchCount()>=this.settings.maxSearchRequests)return;
  this.queries.add(query);
  const filename=path.join(this.cacheDir,'搜索',digest({query,count:this.settings.searchResultsPerQuery,version:VERSION})+'.json');
  let results=await readCache(filename,this.settings.searchCacheHours,this.refresh);
  const cached=!!results;
  if(cached)this.counts.searchCacheHits++;
  else{
   try{
    this.counts.searchRequests++;
    results=await this.dependencies.search(query,process.env.DEEPSEEK_API_KEY,{count:this.settings.searchResultsPerQuery,timeoutMs:Math.min(45000,Math.max(1000,this.deadline-Date.now()))});
   }catch(error){
    this.errors.push(error.message);this.events.push({stage:'搜索',query,status:'失败',error:error.message});
    if(fatalAccount(error)){this.networkStopped=true;throw error;}
    if(/HTTP (403|429)/.test(error.message)){this.searchStopped=true;return;}
    if(!this.settings.publicSearchFallback||this.expired()||this.searchCount()>=this.settings.maxSearchRequests)return;
    try{this.counts.publicSearchRequests++;results=await this.dependencies.publicSearch(query);}
    catch(fallbackError){this.errors.push(fallbackError.message);this.events.push({stage:'公开搜索备用',query,status:'失败',error:fallbackError.message});return;}
   }
   if(results.length)await writeCache(filename,results);
  }
  this.events.push({stage:'搜索',query,status:results.length?'取得结果':'无结果',count:results.length,cached});
  for(const result of results){
   if(!relevant(this.company,(result.title??'')+' '+(result.text??'')))continue;
   this.addSource(result);this.addCandidate(result);
  }
 }
 async readCandidates(limit){
  let attempts=0;
  while(!this.expired()&&!this.networkStopped&&attempts<limit&&this.counts.readAttempts<this.settings.maxReadAttempts){
   const candidate=[...this.candidates.values()].filter(item=>!this.visited.has(item.url)).sort((left,right)=>rankCandidate(right,this.company,this.settings.targetYear,this.rows.map(row=>row.factor))-rankCandidate(left,this.company,this.settings.targetYear,this.rows.map(row=>row.factor)))[0];
   if(!candidate)break;
   this.visited.add(candidate.url);attempts++;this.counts.readAttempts++;
   const filename=path.join(this.cacheDir,'网页',digest({url:candidate.url,factors:this.rows.map(row=>row.factor).sort(),version:CRAWLER_VERSION})+'.json');
   let document=await readCache(filename,this.settings.cacheDays*24,this.refresh);let cached=!!document;
   try{
    if(cached)this.counts.documentCacheHits++;
    else{
     try{document=await this.dependencies.read(candidate.url,this.folder,{maxDocumentBytes:this.settings.maxDocumentBytes,factors:this.rows.map(row=>row.factor)});if(!relevant(this.company,(document.title??'')+' '+document.text))throw new Error('本地页面主体未匹配，尝试服务端抓取');}
     catch(error){
      this.events.push({stage:'本地读取',url:candidate.url,status:'失败',error:error.message});
      if(this.expired()||this.fetchStopped||this.counts.fetchRequests>=this.settings.maxFetchRequests)throw error;
      this.counts.fetchRequests++;
      try{document=await this.dependencies.fetch(candidate.url,process.env.DEEPSEEK_API_KEY,{timeoutMs:Math.min(45000,Math.max(1000,this.deadline-Date.now()))});}
      catch(fetchError){if(fatalAccount(fetchError)){this.networkStopped=true;throw fetchError;}if(/HTTP 429/.test(fetchError.message))this.fetchStopped=true;throw new Error(`${error.message}；${fetchError.message}`);}
     }
     if(!relevant(this.company,(document.title??'')+' '+document.text))throw new Error('读取内容主体未匹配，未用于判断');
     await writeCache(filename,document);
    }
    this.addSource(document);this.counts.readSuccess++;
    this.events.push({stage:'读取',url:candidate.url,status:'取得正文',cached,pages:document.selectedPages});
   }catch(error){this.errors.push(`${candidate.url}：${error.message}`);this.events.push({stage:'读取',url:candidate.url,status:'失败',error:error.message});if(this.networkStopped)throw error;}
  }
 }
 async collect(rows=this.rows,round=0){
  const before=this.sources.length;const queryLimit=round===0?this.settings.initialSearchRequests:this.settings.maxSearchRequests;
  const queries=planQueries(this.company,this.settings.targetYear,rows,round);
  const planned=round===0?queries:queries.slice(0,Math.max(1,this.settings.maxSearchRequests-this.searchCount()));
  for(const query of planned){if(this.searchCount()>=queryLimit)break;await this.search(query);}
  const reserve=round===0&&this.settings.maxSupplementRounds>0?Math.min(3,Math.floor(this.settings.maxReadAttempts/3)):0;
  await this.readCandidates(Math.max(0,this.settings.maxReadAttempts-this.counts.readAttempts-reserve));
  return this.sources.length-before;
 }
 snapshot(){return {company:this.company,targetYear:this.settings.targetYear,counts:this.counts,events:this.events,errors:this.errors,sources:this.sources,remainingCandidates:[...this.candidates.keys()].filter(url=>!this.visited.has(url)),stopped:this.expired()?'达到公司时间预算':this.networkStopped?'账户错误停止':this.searchStopped?'搜索权限或限流':this.searchCount()>=this.settings.maxSearchRequests?'达到搜索预算':'调查完成'};}
}
