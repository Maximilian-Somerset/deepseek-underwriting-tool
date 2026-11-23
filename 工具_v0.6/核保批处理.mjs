import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {FileBlob,SpreadsheetFile} from './工作簿依赖.mjs';
import {records,key,sameRecord,filled,selectExamples,digest} from './处理逻辑.mjs';
import {CompanyResearch,VERSION,validateSettings,writeJSON} from './自动调查.mjs';
import {investigateCompany} from './公司处理.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const has=name=>process.argv.includes(name);
const arg=(name,fallback)=>{const index=process.argv.indexOf(name);if(index<0)return fallback;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw new Error(`${name}缺少参数`);return process.argv[index+1];};
const json=async filename=>JSON.parse((await fs.readFile(filename,'utf8')).replace(/^\uFEFF/,''));
async function main(){
 const root=path.resolve(arg('--root',path.join(here,'..')));
 const input=path.resolve(arg('--input',path.join(root,'测试.xlsx')));
 const settings=await json(path.join(here,'联网设置.json'));validateSettings(settings);
 const config=await json(path.join(here,'规则配置_v0.6.json'));
 const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(input));
 const values=workbook.worksheets.getItemAt(0).getUsedRange().values;
 if(!String(values[0]?.[10]).includes('核保确认值'))throw new Error('输入模板K列标题应为核保确认值');
 const targets=records(values),known=new Map(config.reviewedRecords.map(row=>[key(row),row]));
 const groups=new Map();for(const row of targets){if(!groups.has(row.company))groups.set(row.company,[]);groups.get(row.company).push(row);}
 const pending=row=>!filled(row)&&(has('--refresh-known')||settings.forceRefreshKnown||!sameRecord(known.get(key(row)),row));
 const chosen=arg('--company',null);if(chosen&&!groups.has(chosen))throw new Error('输入表未找到指定公司');
 if(has('--check')){
  console.log(JSON.stringify({version:VERSION,input,companies:[...groups].map(([company,rows])=>({company,rows:rows.length,pending:rows.filter(pending).length})),model:settings.model,thinkingEnabled:settings.thinkingEnabled!==false,deepseekKeyConfigured:!!process.env.DEEPSEEK_API_KEY,provider:'DeepSeek官方Search/Fetch＋本地公开文档读取',budgets:{search:settings.maxSearchRequests,reads:settings.maxReadAttempts,fetch:settings.maxFetchRequests,supplements:settings.maxSupplementRounds,companies:settings.maxCompaniesPerRun},targetYear:settings.targetYear??new Date().getFullYear()-1,mode:'只检查，不调用接口，不写文件'},null,2));return;
 }
 if(!process.env.DEEPSEEK_API_KEY)throw new Error('未配置DeepSeek密钥，请运行配置接口_v0.6.cmd；也可只读使用v0.5或v0.4已有加密密钥');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const stateDir=path.resolve(arg('--state-dir',here));
 const runDir=path.join(stateDir,'运行记录',stamp),cacheDir=path.join(stateDir,'缓存');
 const output=path.resolve(arg('--output',path.join(root,`${path.basename(input,'.xlsx')}_规则试填_v0.6_${stamp}.xlsx`)));
 if(input.toLowerCase()===output.toLowerCase())throw new Error('输出不能覆盖输入文件');
 if(!has('--sources-only'))try{await fs.access(output);throw new Error('输出文件已经存在，请指定新的文件名');}catch(error){if(error.code!=='ENOENT')throw error;}
 const manual=await json(path.join(here,'补充来源.json'));
 const trainingWorkbook=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root,'训练.xlsx')));
 const training=records(trainingWorkbook.worksheets.getItemAt(0).getUsedRange().values);
 const definitionsWorkbook=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root,'附加调整因子定义.xlsx')));
 const definitionRows=[];
 for(const sheet of definitionsWorkbook.worksheets.items){let context='';for(const row of sheet.getUsedRange().values){if(row[0])context=String(row[0]);definitionRows.push({sheet:sheet.name,context,text:row.filter(cell=>cell!==null&&cell!=='').join(' | ')});}}
 const runtime=structuredClone(config);runtime.reviewedRecords=[];runtime.evidence=[];
 const report={mode:`v${VERSION}｜按字段自动调查、缺项补查、深度思考；输出均为候选`,input,started:new Date().toISOString(),companies:[],apiCalls:0,searchRequests:0,fetchRequests:0,publicSearchRequests:0,failed:false};
 await fs.mkdir(runDir,{recursive:true});
 const assign=decisions=>{for(const decision of decisions){const index=runtime.reviewedRecords.findIndex(row=>row.row===decision.row);runtime.reviewedRecords[index]=decision;}};
 let processed=0,stopAPI=false;
 for(const [company,rows] of groups){
  const selected=rows.filter(pending);
  const options={...settings,...settings.companyOptions?.[company]};
  options.targetYear=options.targetYear??new Date().getFullYear()-1;options.financialScope??='unspecified';
  const info={company,targetYear:options.targetYear,financialScope:options.financialScope,searchStatus:'未检索',modelStatus:'未调用',sourceCount:0,inputTokens:0,outputTokens:0,note:''};report.companies.push(info);
  for(const row of rows){const prior=known.get(key(row));runtime.reviewedRecords.push({...row,decision:filled(row)?{value:row.label,status:'保留已有人工填写',reason:'保留输入K列',followup:'',evidence:''}:!pending(row)?prior.decision:{value:'unknown',status:'未处理',reason:'等待调查',followup:row.question,evidence:''}});}
  if(!selected.length){info.modelStatus='无需新处理';continue;}
  if(chosen&&chosen!==company){info.modelStatus='未处理—公司筛选';continue;}
  if(stopAPI||processed>=settings.maxCompaniesPerRun){info.modelStatus=stopAPI?'未处理—账户或模型限流后停止':'未处理—达到公司数上限';continue;}
  processed++;console.log(`[${processed}/${groups.size}] ${company}：${selected.length}项，目标年度${options.targetYear}`);
  const companyHash=digest(company).slice(0,16),folder=path.join(runDir,companyHash);
  const research=new CompanyResearch({company,rows:selected,settings:options,manual:manual[company]??{},folder,cacheDir,refresh:has('--refresh')});
  let state;
  try{
   if(has('--sources-only')){await research.collect();info.modelStatus='仅搜集资料';}
   else{
    const aliases={'第三方系统访问权限':'是否可访问第三方系统'};
    const definitions=definitionRows.filter(definition=>selected.some(row=>(definition.context+' '+definition.text).includes(aliases[row.factor]??row.factor))).map(definition=>`${definition.sheet}｜${definition.context}｜${definition.text}`).join('\n').slice(0,24000);
    state=await investigateCompany({research,rows:selected,settings:options,config,definitions,examples:selectExamples(selected,training,config.feedback),onProgress:message=>console.log('  '+message)});
    info.modelStatus=state.apiCalls?'已完成—新调用':'已完成—复用缓存';
   }
  }catch(error){
   state=research.analysis;report.failed=true;info.modelStatus='调查或模型失败—保留已完成项';info.note=error.message;
   if(/HTTP (401|402|429)/.test(error.message)||error.service==='DeepSeek'&&/HTTP 403/.test(error.message))stopAPI=true;
   const completed=new Set((state?.decisions??[]).map(row=>row.row));
   assign(selected.filter(row=>!completed.has(row.row)).map(row=>({...row,decision:{value:'unknown',status:'接口或调查失败—待重试',reason:error.message,followup:'检查运行记录后重试，不代表企业没有该信息',evidence:''}})));
   console.error('  '+error.message);
  }finally{
   const snapshot=research.snapshot();
   info.searchStatus=research.sources.length?(research.errors.length?'取得来源—部分读取失败':'已取得来源'):research.errors.length?'检索或读取失败':'搜索预算内未找到来源';
   info.sourceCount=research.sources.length;info.counts={...research.counts};info.rounds=state?.rounds??[];
   if(state){
    report.apiCalls+=state.apiCalls;info.inputTokens=state.inputTokens;info.outputTokens=state.outputTokens;
    const sources=new Map(state.sources.map(source=>[source.id,source]));
    const decisions=structuredClone(state.decisions);
    for(const row of decisions){
     const decision=row.decision;
     const quotes=(decision.citations??[]).map(citation=>{const text=sources.get(citation.id)?.text??'';const parts=text.split(/【PDF第(\d+)页】/);let page='';for(let index=1;index<parts.length;index+=2)if(parts[index+1].replace(/\s/g,'').includes(citation.quote.replace(/\s/g,'')))page=`（PDF第${parts[index]}页）`;return `${companyHash}-${citation.id}${page}「${citation.quote}」`;});
     decision.reason+='\n引用：'+quotes.join('\n');decision.evidence=(decision.citations??[]).map(citation=>companyHash+'-'+citation.id).join('；');
     if(decision.value==='unknown')decision.followup+=`；${snapshot.stopped}；搜索${research.searchCount()}次，读取尝试${research.counts.readAttempts}次；${research.errors.length?'部分来源读取失败，见调查记录':'仍需符合年度及口径的证据'}`;
    }
    assign(decisions);
    for(const source of state.sources)runtime.evidence.push({id:companyHash+'-'+source.id,company,field:'本公司因子',source:source.sourceName??source.title,url:source.url,period:source.period??'未明确',quote:[...new Set(decisions.flatMap(row=>row.decision.citations??[]).filter(citation=>citation.id===source.id).map(citation=>citation.quote))].join('；').slice(0,2000)||source.text.slice(0,300),quality:source.status,note:'完整原文和每轮提交材料见本次运行记录',accessed:new Date().toISOString()});
    await writeJSON(path.join(folder,'最终判断.json'),{company,...state,decisions});
   }
   report.searchRequests+=research.counts.searchRequests;report.fetchRequests+=research.counts.fetchRequests;report.publicSearchRequests+=research.counts.publicSearchRequests;
   info.note=[info.note,`搜索${research.counts.searchRequests}次，Fetch ${research.counts.fetchRequests}次，公开备用搜索${research.counts.publicSearchRequests}次，读取${research.counts.readSuccess}/${research.counts.readAttempts}份，搜索/文档缓存${research.counts.searchCacheHits}/${research.counts.documentCacheHits}次`,state?.status,snapshot.stopped,research.errors.slice(-3).join('；')].filter(Boolean).join('；');
   await writeJSON(path.join(folder,'调查记录.json'),snapshot);
   await writeJSON(path.join(runDir,'运行报告.json'),report);
  }
  console.log(`  已保存：${state?.decisions.filter(row=>row.decision.value!=='unknown').length??0}/${selected.length}项候选`);
 }
 report.finished=new Date().toISOString();runtime.runInfo=report;
 await writeJSON(path.join(runDir,'运行报告.json'),report);
 if(has('--sources-only')){console.log('资料已保存：'+runDir);return;}
 const runConfig=path.join(runDir,'运行配置.json');await writeJSON(runConfig,runtime);
 const args=[path.join(here,'导出审核工作簿.mjs'),'--root',root,'--input',input,'--config',runConfig,'--output',output,'--preview',path.join(runDir,'预览')];
 if(has('--no-preview'))args.push('--no-preview');
 const exported=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env,windowsHide:true});
 if(exported.status!==0)throw new Error('Excel导出失败；调查记录与模型结果已保存，可利用缓存重试');
 console.log(`结果：${output}\n报告：${path.join(runDir,'运行报告.json')}\n模型请求${report.apiCalls}次，Search ${report.searchRequests}次，Fetch ${report.fetchRequests}次。`);
 if(report.failed)process.exitCode=2;
}
main().catch(error=>{console.error('处理未完成：'+error.message);process.exitCode=1;});
