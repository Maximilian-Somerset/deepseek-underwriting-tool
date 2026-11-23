import path from 'node:path';
import {deepseek} from './联网接口.mjs';
import {SYSTEM,digest,validateDecisions} from './处理逻辑.mjs';
import {VERSION,selectSources,readCache,writeCache,writeJSON} from './自动调查.mjs';

export async function investigateCompany({research,rows,settings,config,definitions,examples,model=deepseek,onProgress=()=>{}}){
 const state={decisions:[],rounds:[],apiCalls:0,inputTokens:0,outputTokens:0,modelCacheHits:0,sources:[],status:'未分析'};
 const decisions=new Map();const evidence=new Map();
 research.analysis=state;
 for(let round=0;round<=settings.maxSupplementRounds;round++){
  const pending=round===0?rows:rows.filter(row=>decisions.get(row.row)?.decision.value==='unknown');
  if(!pending.length)break;
  if(research.expired()){state.status='达到公司时间预算';break;}
  onProgress(round===0?'首轮按字段搜集资料':`第${round}轮补查：${[...new Set(pending.map(row=>row.factor))].join('、')}`);
  const added=await research.collect(pending,round);
  if(round>0&&!added){state.status='补查未取得新证据';break;}
  const sources=selectSources(rows,research.manual,research.sources,settings,pending.map(row=>row.factor));
  for(const source of sources){const previous=evidence.get(source.id);evidence.set(source.id,previous?{...source,text:previous.text===source.text?source.text:previous.text+'\n【另一轮提交的原文节选】\n'+source.text}:source);}
  const fields=pending.map(row=>({row:row.row,factor:row.factor,type:row.type,scenes:row.scenes,current:row.old,question:row.question,allowed:config.fieldEnums[row.factor]??null}));
  const relevantExamples=examples.filter(example=>pending.some(row=>row.factor===example.factor));
  const payload={company:research.company,targetYear:settings.targetYear,financialScope:settings.financialScope??'unspecified',fields,preferences:(config.feedbackRules??[]).map(([id,rule,from,condition])=>({id,rule,from,condition})),rules:config.rules.filter(rule=>pending.some(row=>rule.factor.includes(row.factor))).map(({id,condition,guard})=>({id,condition,guard})),definitions,examples:relevantExamples,sources,investigation:{round,queries:[...research.queries],readFailures:research.errors.slice(-10),remainingSearchBudget:settings.maxSearchRequests-research.searchCount()}};
  const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(payload)}];
  const filename=path.join(research.cacheDir,'模型',digest({messages,model:settings.model,maxTokens:settings.maxTokens,thinking:settings.thinkingEnabled,reasoningEffort:settings.reasoningEffort??'low',version:VERSION})+'.json');
  let result=await readCache(filename,settings.cacheDays*24,research.refresh);
  const cached=!!result;
  await writeJSON(path.join(research.folder,`第${round+1}轮提交材料.json`),payload);
  if(research.expired()){state.status='达到公司时间预算';break;}
  if(cached)state.modelCacheHits++;
  else{
   state.apiCalls++;
   try{result=await model({...settings,timeoutMs:Math.max(1000,Math.min(settings.timeoutMs,research.deadline-Date.now()))},process.env.DEEPSEEK_API_KEY,messages);}
   catch(error){state.inputTokens+=error.usage?.prompt_tokens??0;state.outputTokens+=error.usage?.completion_tokens??0;state.status='模型分析失败';throw error;}
   state.inputTokens+=result.usage.prompt_tokens??0;state.outputTokens+=result.usage.completion_tokens??0;
  }
  const checked=validateDecisions(result.data,pending,sources,config.fieldEnums,settings.targetYear,settings.financialScope==='unspecified'?null:settings.financialScope);
  if(!cached)await writeCache(filename,result);
  for(const decision of checked)decisions.set(decision.row,decision);
  state.decisions=rows.map(row=>decisions.get(row.row)).filter(Boolean);state.sources=[...evidence.values()];
  state.rounds.push({round,cached,newSources:added,pending:pending.map(row=>row.factor),resolved:checked.filter(row=>row.decision.value!=='unknown').map(row=>row.factor)});
  state.status='已完成';
  await writeJSON(path.join(research.folder,`第${round+1}轮判断结果.json`),{decisions:checked,usage:result.usage,cached});
  if(research.searchCount()>=settings.maxSearchRequests&&research.counts.readAttempts>=settings.maxReadAttempts)break;
 }
 for(const row of rows)if(!decisions.has(row.row))decisions.set(row.row,{...row,decision:{value:'unknown',status:'未完成调查—待重试',reason:state.status,followup:row.question,evidence:'',citations:[]}});
 state.decisions=rows.map(row=>decisions.get(row.row));
 return state;
}
