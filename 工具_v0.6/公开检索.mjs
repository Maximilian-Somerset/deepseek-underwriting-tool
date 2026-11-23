import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {publicURL,htmlText} from './联网接口.mjs';
import {digest} from './处理逻辑.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
// Python路径自动检测
const python = (() => {
  const paths = [
    process.env.PYTHON_PATH,
    process.env.USERPROFILE + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
    'C:/Program Files/Python312/python.exe',
    'C:/Program Files/Python311/python.exe',
    'python'
  ].filter(Boolean);
  // 返回第一个可用路径（实际使用时需验证）
  return paths[0] || 'python';
})();
export const CRAWLER_VERSION='research-0.6.0';
export const coreName=company=>company.replace(/^(北京|上海|天津|重庆|深圳|广州|杭州|南京|苏州|武汉|成都|西安|珠海|浙江|江苏|广东|山东|福建|安徽|四川|河南|河北|湖北|湖南|江西|山西|陕西)(市|省)?/,'').replace(/(?:科技|机电|电子|新能源|信息技术|网络技术|生物科技|控股|集团)*?(?:股份有限公司|有限责任公司|有限公司)$/,'');
export const relevant=(company,text)=>text.includes(company)||(coreName(company).length>=4&&text.replace(/\s/g,'').includes(coreName(company)));
export function decodeHTML(bytes,contentType=''){
 const prefix=Buffer.from(bytes).subarray(0,3000).toString('ascii');
 let charset=(contentType+' '+prefix).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
 if(/gb2312|gbk|gb18030/i.test(charset))charset='gb18030';
 try{return new TextDecoder(charset).decode(bytes);}catch{return new TextDecoder('utf-8').decode(bytes);}
}
export async function download(url,maxBytes=40000000){
 let current=url;
 for(let i=0;i<4;i++){
  await publicURL(current);
  const r=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'UnderwritingResearch/0.5'}});
  if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error('重定向无地址');current=new URL(loc,current).href;continue;}
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  let size=0;const chunks=[];
  for await(const c of r.body){size+=c.length;if(size>maxBytes)throw new Error('公开文件超过读取大小上限');chunks.push(c);}
  return {bytes:Buffer.concat(chunks),type:r.headers.get('content-type')??'',url:current};
 }
 throw new Error('重定向过多');
}
export function parseSo(html,company){
 if(/请输入验证码|安全验证|访问验证|SourceVerifyCode/.test(htmlText(html).slice(0,1500)))throw new Error('搜索引擎要求验证码，已停止该来源');
 const heads=[...html.matchAll(/<h3\b[^>]*class=["'][^"']*res-title[^"']*["'][^>]*>[\s\S]*?<\/h3>/gi)];
 if(!heads.length&&!/没有找到|未找到相关|抱歉/.test(htmlText(html)))throw new Error('搜索页未解析出结果，可能为页面结构变化或限流');
 return heads.map((m,i)=>{
  const title=htmlText(m[0]);const url=htmlText(m[0].match(/data-mdurl=["']([^"']+)["']/)?.[1]??m[0].match(/href=["']([^"']+)["']/)?.[1]??'');
  let block=html.slice(m.index,heads[i+1]?.index??m.index+6000);
  block=block.split(/其他人还搜了|相关搜索|猜你关注|热搜榜/)[0];
  return {title,url,text:htmlText(block).slice(0,1500),kind:'search',sourceName:'360公开搜索抓取',status:'搜索摘要，正文未核实',period:htmlText(block).match(/20\d{2}年\d{1,2}月\d{1,2}日/)?.[0]??'未明确'};
 }).filter(s=>/^https?:\/\//.test(s.url)&&relevant(company,s.title+' '+s.text.slice(0,400)));
}
export const FIELD_PATTERNS={
 '营业额':/营业收入|营业总收入|营业额|收入合计|利润表|主要财务指标|主要财务数据|财务概况/,
 '员工人数':/员工|职工|雇员|从业人员|参保人数|社会保险|社保人数/,
 '业务':/主营业务|经营范围|公司简介|公司概况|业务模式|行业分类/,
 '系统':/服务器|终端|数据中心|保理云|系统|平台|SLA|服务承诺|网络安全/,
 '地域':/司法辖区|全球布局|境外|海外|注册地址|子公司/
};
export function selectPDFPages(pages,factors=[]){
 const compact=pages.map(text=>text.replace(/\s/g,''));
 if(pages.reduce((total,text)=>total+text.length,0)<=30000)return pages.map((text,index)=>({page:index+1,text}));
 const priority=[...factors.filter(factor=>FIELD_PATTERNS[factor]).map(factor=>FIELD_PATTERNS[factor]),...Object.values(FIELD_PATTERNS)];
 const selected=new Set();
 for(const pattern of priority){
  const matches=compact.map((text,index)=>({index,score:(text.match(new RegExp(pattern.source,'g'))??[]).length})).filter(item=>item.score).sort((left,right)=>right.score-left.score);
  for(const {index} of matches.slice(0,2))selected.add(index);
 }
 const anchors=[...selected];
 for(const index of anchors)for(const neighbor of [index-1,index+1])if(neighbor>=0&&neighbor<pages.length)selected.add(neighbor);
 selected.add(0);
 let size=0;const output=[];
 for(const index of selected){const text=pages[index];if(size+text.length>30000)continue;output.push({page:index+1,text});size+=text.length;}
 return output.sort((left,right)=>left.page-right.page);
}
export function discoverLinks(content,baseURL){
 const links=[];
 const add=(raw,title='')=>{try{const url=new URL(htmlText(raw).replace(/\\\//g,'/'),baseURL);if(!/^https?:$/.test(url.protocol))return;
  const attachment=/\.pdf(?:$|[?#])|download|adjunct|附件|全文|下载|审计报告|年度报告/i.test(url.href+' '+title);
  if(attachment||url.origin===new URL(baseURL).origin&&/公司简介|公司概况|关于我们/.test(title))links.push({url:url.href,title:title||'报告附件',attachment});
 }catch{}};
 for(const match of content.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(match[1],htmlText(match[2]));
 for(const match of content.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g))add(match[2],match[1]);
 for(const match of content.replace(/\\\//g,'/').matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi))add(match[0]);
 const eastmoney=baseURL.match(/data\.eastmoney\.com\/notices\/detail\/[^/]+\/(AN\d+)\.html/i);
 if(eastmoney)add(`https://pdf.dfcfw.com/pdf/H2_${eastmoney[1]}_1.pdf`,'东方财富公告PDF附件（待实际读取验证）');
 return [...new Map(links.map(link=>[link.url,link])).values()].sort((left,right)=>Number(right.attachment)-Number(left.attachment)).slice(0,12);
}
export async function readDocument(url,folder,opts={}){
 const data=await download(url,opts.maxDocumentBytes??40000000);const hash=digest(url).slice(0,16);await fs.mkdir(folder,{recursive:true});
 if(data.bytes.subarray(0,5).toString()==='%PDF-'){
  const pdfPath=path.join(folder,hash+'.pdf');await fs.writeFile(pdfPath,data.bytes);
  const run=spawnSync(python,[path.join(here,'提取公开PDF.py')],{input:data.bytes,encoding:'utf8',maxBuffer:16000000,timeout:75000,windowsHide:true});
  if(run.status!==0)throw new Error('PDF文字提取失败或超时，原件已保存');
  const extracted=JSON.parse(run.stdout);await fs.writeFile(path.join(folder,hash+'-全文.json'),JSON.stringify(extracted));
  if(extracted.pages.join('').replace(/\s/g,'').length<100)throw new Error('PDF无可提取文字，可能是扫描件，需要OCR或企业补充');
  const selected=selectPDFPages(extracted.pages,opts.factors??[]);
  const text=selected.map(p=>`【PDF第${p.page}页】\n${p.text}`).join('\n');
  return {url:data.url,title:'公开PDF报告',text,kind:'web',sourceName:'公开披露PDF原文',status:'PDF原文已读取；已保留页码',period:'见报告年度',snapshot:pdfPath,selectedPages:selected.map(p=>p.page)};
 }
 if(!/text\/html|text\/plain|application\/xhtml/i.test(data.type))throw new Error('不是可提取的HTML/PDF文档');
 const html=decodeHTML(data.bytes,data.type),text=htmlText(html);
 if(text.length<100||/百度安全验证|请输入验证码|访问验证|SourceVerifyCode|verify you are human|just a moment/i.test(text.slice(0,1500)))throw new Error('网页要求验证或没有可用正文');
 const filename=path.join(folder,hash+'.html');await fs.writeFile(filename,html);
 return {url:data.url,title:htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??data.url),text:text.slice(0,200000),kind:'web',sourceName:'公开网页正文',status:'正文已读取；内容仍需核实',period:'正文所载年度',snapshot:filename,links:discoverLinks(html,data.url)};
}
export async function annualAnnouncements(company,year,folder){
 const url='https://www.cninfo.com.cn/new/hisAnnouncement/query';
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':'https://www.cninfo.com.cn/'},body:new URLSearchParams({pageNum:'1',pageSize:'30',tabName:'fulltext',searchkey:company,seDate:`${year+1}-01-01~${year+1}-12-31`,category:'category_ndbg_szsh',isHLtitle:'false'}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error(`巨潮公开公告HTTP ${r.status}`);
 const data=await r.json();
 if(!Array.isArray(data.announcements)&&data.announcements!==null)throw new Error('巨潮公告响应结构变化');
 await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'巨潮公告查询.json'),JSON.stringify({query:{company,year},data},null,2));
 return (data.announcements??[]).filter(a=>a.announcementTitle?.replace(/\s/g,'').includes(company)&&new RegExp(`${year}年?年度报告`).test(a.announcementTitle)&&!/摘要|英文|取消/.test(a.announcementTitle)&&/^finalpage\//.test(a.adjunctUrl)).slice(0,1).map(a=>({title:a.announcementTitle,url:new URL(a.adjunctUrl,'https://static.cninfo.com.cn/').href,period:String(year),kind:'web',sourceName:'巨潮正式年报'}));
}
export function extractSocialSecurity(text){
 const idx=text.indexOf('社保信息');
 if(idx<0)return null;
 const seg=text.slice(idx,idx+1200);
 const pension=seg.match(/城镇职工基本养老保险\s*(\d+)\s*人/)?.[1];
 const medical=seg.match(/职工基本医疗保险\s*(\d+)\s*人/)?.[1];
 const unemployment=seg.match(/失业保险\s*(\d+)\s*人/)?.[1];
 const injury=seg.match(/工伤保险\s*(\d+)\s*人/)?.[1];
 const maternity=seg.match(/生育保险\s*(\d+)\s*人/)?.[1];
 if(!pension)return null;
 return {pension:Number(pension),medical:medical?Number(medical):null,unemployment:unemployment?Number(unemployment):null,injury:injury?Number(injury):null,maternity:maternity?Number(maternity):null};
}
export async function crawlEnterprisePlatforms(company,folder){
 const sources=[],errors=[],attempts=[];
 const platforms=[
  {name:'天眼查',site:'tianyancha.com',urlPattern:/m\.tianyancha\.com\/(?:nianbao|company)\/\d+/},
  {name:'企查查',site:'qcc.com',urlPattern:/m\.qcc\.com\/firm\/[a-f0-9]+\.html/},
  {name:'风鸟',site:'riskbird.com',urlPattern:/riskbird\.com\/ent\//},
 ];
 for(const p of platforms){
  const query=`${company} site:${p.site}`;
  const searchUrl='https://www.so.com/s?q='+encodeURIComponent(query);
  try{
   const data=await download(searchUrl,3000000),html=decodeHTML(data.bytes,data.type);
   const results=parseSo(html,company).filter(s=>p.urlPattern.test(s.url));
   attempts.push({provider:p.name+'定向检索',query,url:searchUrl,status:'成功',count:results.length});
   for(const r of results.slice(0,2)){
    try{
     const doc=await readDocument(r.url,folder);
     const ss=extractSocialSecurity(doc.text);
     if(ss){
      sources.push({...doc,sourceName:p.name+'企业查询（社保信息）',status:'已读取企业查询平台社保信息',socialSecurity:ss,platform:p.name});
     }else{
      sources.push({...doc,sourceName:p.name+'企业查询',status:'已读取企业查询平台页面，未提取到社保信息',platform:p.name});
     }
    }catch(e){errors.push(`${p.name}页面读取：${e.message}`);}
   }
  }catch(e){attempts.push({provider:p.name+'定向检索',query,url:searchUrl,status:'失败',error:e.message});errors.push(`${p.name}检索：${e.message}`);}
 }
 return {sources,errors,attempts};
}
export async function crawlCompany(company,year,factors,folder){
 const sources=[],errors=[],attempts=[];let searchResults=0,readCount=0;
 const useYear=Number(year)||new Date().getFullYear()-1;
 try{
  const annual=await annualAnnouncements(company,useYear,folder);attempts.push({provider:'巨潮公开公告',status:'成功',count:annual.length,year:useYear});
  for(const result of annual){try{const doc=await readDocument(result.url,folder);if(!doc.text.replace(/\s/g,'').includes(company))throw new Error('PDF主体无法核对');sources.push({...doc,...result});readCount++;}catch(e){errors.push('年报读取：'+e.message);}}
 }catch(e){attempts.push({provider:'巨潮公开公告',status:'失败',error:e.message});errors.push('巨潮查询：'+e.message);}
 const queries=[`${company} 官网 公司简介 全球布局`];
 if(!sources.length)queries.push(`${company} ${useYear} 年报 营业收入 员工人数`);
 if(factors.some(f=>/服务器|终端数量|数据中心/.test(f)))queries.push(`${company} 服务器 终端 数据中心 数量`);
 for(const [i,query] of queries.entries()){
  const url='https://www.so.com/s?q='+encodeURIComponent(query);
  try{
   const data=await download(url,3000000),html=decodeHTML(data.bytes,data.type);
   await fs.writeFile(path.join(folder,`360搜索-${i+1}.html`),html);
   const results=parseSo(html,company).slice(0,5);searchResults+=results.length;sources.push(...results);
   attempts.push({provider:'360公开搜索',query,url,status:'成功',count:results.length});
  }catch(e){attempts.push({provider:'360公开搜索',query,url,status:'失败',error:e.message});errors.push(e.message);}
 }
 try{
  const ep=await crawlEnterprisePlatforms(company,folder);
  attempts.push(...ep.attempts);errors.push(...ep.errors);
  for(const s of ep.sources){sources.push(s);readCount++;}
 }catch(e){errors.push('企业查询平台定向抓取：'+e.message);}
 const candidates=[...new Map(sources.filter(s=>s.kind==='search').map(s=>[s.url,s])).values()].sort((a,b)=>Number(/新浪|证券|快报|工资|待遇/.test(a.title))-Number(/新浪|证券|快报|工资|待遇/.test(b.title))).slice(0,4);
 const visited=new Set(sources.filter(s=>s.kind==='web').map(s=>s.url));
 for(const s of candidates){
  if(visited.has(s.url))continue;visited.add(s.url);
  try{
   const doc=await readDocument(s.url,folder);
   if(!relevant(company,doc.text))throw new Error('读取的网页主体未匹配');
   sources.push(doc);readCount++;
   // Follow a small number of same-site company-profile links, never arbitrary instructions.
   const links=[...new Set(doc.links??[])].filter(u=>new URL(u).origin===new URL(doc.url).origin&&!visited.has(u)).slice(0,1);
   for(const u of links){visited.add(u);try{const child=await readDocument(u,folder);if(relevant(company,child.text)){sources.push(child);readCount++;}}catch(e){errors.push('公司详情：'+e.message);}}
  }catch(e){errors.push(`${s.url}：${e.message}`);}
 }
 const successful=attempts.filter(a=>a.status==='成功').length;
 return {sources,errors,readCount,searchResults,attempts,searchStatus:successful?(sources.length?'已执行公开爬虫—取得来源':'已执行公开爬虫—未找到匹配来源'):'公开爬虫检索失败',crawlerVersion:CRAWLER_VERSION};
}
