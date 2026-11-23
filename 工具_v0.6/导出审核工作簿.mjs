import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileBlob,SpreadsheetFile} from './工作簿依赖.mjs';
import {records,key} from './处理逻辑.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i>=0?process.argv[i+1]:fallback;};
const root=arg('--root',process.cwd());
const config=JSON.parse(await fs.readFile(arg('--config',path.join(here,'规则配置_v0.6.json')),'utf8'));
const input=arg('--input',path.join(root,'测试.xlsx'));
const output=arg('--output',path.join(root,`${path.basename(input,'.xlsx')}_规则试填_${Date.now()}.xlsx`));
if(path.resolve(input)===path.resolve(output))throw new Error('输出不能覆盖输入文件');
const train=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root,'训练.xlsx')));
const trainVals=train.worksheets.getItemAt(0).getUsedRange().values;
const allTrain=records(trainVals),samples=allTrain.filter(r=>r.label!==null&&r.label!=='');
const feedbackSamples=(config.feedback??[]).map(f=>({...f,label:f.value,caseSource:`用户反馈案例!U${String(f.index).padStart(2,'0')}`}));
const suggestionSamples=[...samples,...feedbackSamples];
const sampleRef=s=>s.caseSource??`训练!K${s.row}`;
const normalize=(factor,value)=>factor==='核心业务依赖'&&value==='moderate'?'medium':value;
function grams(s){const t=String(s).toLowerCase().replace(/[\s\p{P}\p{S}\d]+/gu,'');const set=new Set();for(let i=0;i<t.length-1;i++)set.add(t.slice(i,i+2));return set;}
function sim(a,b){if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return 2*n/(a.size+b.size);}
const features=r=>({b:grams(r.business),h:grams(r.history)});
function nearest(r,pool){const f=features(r);return pool.filter(s=>s.factor===r.factor&&String(s.scenes??'').split('；').some(x=>r.scenes.includes(x))).map(s=>{const g=features(s);return {sample:s,score:0.55*sim(f.b,g.b)+0.45*sim(f.h,g.h)};}).sort((a,b)=>b.score-a.score).slice(0,3);}
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(input));const sh=wb.worksheets.getItemAt(0);const original=sh.getUsedRange().values;const targets=records(original);
// Remove the source workbook's external-reference validations before adding portable local validations.
sh.getRange(`K2:K${original.length}`).dataValidation=null;
const known=new Map(config.reviewedRecords.map(r=>[key(r),r]));
const results=targets.map(r=>{const nn=nearest(r,suggestionSamples),d=known.get(key(r));let res;
 if(d&&d.business===r.business&&d.history===r.history&&d.old===r.old)res={...d.decision};
 else res={value:'unknown',status:'待联网/人工复核',rule:'R02',evidence:'',reason:'新记录尚无经核查的联网证据；相似案例只作为建议，不自动确认。',followup:r.question,proposal:nn[0]?normalize(r.factor,nn[0].sample.label):null};
 if(r.label!==null&&r.label!=='')res={...res,value:r.label,status:'保留已有人工填写',reason:'不覆盖输入文件已有K列值。'};
 const allowed=config.fieldEnums[r.factor];if(r.type==='enum'&&allowed&&!allowed.includes(res.value))throw new Error(`非法枚举 ${r.row} ${res.value}`);
 if(r.type==='number'&&res.value!=='unknown'&&(typeof res.value!=='number'||res.value<0))throw new Error(`非法数值 ${r.row}`);
 return {...r,...res,similar:nn.map(x=>`${sampleRef(x.sample)}=${x.sample.label}（文本相似度${x.score.toFixed(3)}）`).join('\n'),analogy:nn[0]?normalize(r.factor,nn[0].sample.label):'无已标注样本'};
});
const evaluated=samples.map(s=>{const nn=nearest(s,samples.filter(x=>x.company!==s.company));const p=nn[0]?normalize(s.factor,nn[0].sample.label):null;return {s,p,score:nn[0]?.score??0,source:nn[0]?`训练!K${nn[0].sample.row}`:'',correct:p===normalize(s.factor,s.label)};});
const covered=evaluated.filter(x=>x.p!==null),correct=covered.filter(x=>x.correct).length;
const issues=[];
for(const s of samples){const list=config.fieldEnums[s.factor];if(list&&!list.includes(s.label))issues.push([`训练!K${s.row}`,s.company,s.factor,s.label,'枚举不合法',normalize(s.factor,s.label),'只规范化副本；保留原始填写值']);
 if(s.factor==='纯集团管理主体'&&s.label==='management_only_unconfirmed')issues.push([`训练!K${s.row}`,s.company,s.factor,s.label,'通用化需复核','不得默认该值','标注不能自动证明主体仅从事控股管理；当前材料多描述实际经营']);
 if(s.factor==='third_party_system_operations_hosting_exposure')issues.push([`训练!K${s.row}`,s.company,s.factor,s.label,'定义缺失','暂停自动确认','当前定义表未收录该因子']);
 if(s.factor==='司法辖区'&&s.label==='global')issues.push([`训练!K${s.row}`,s.company,s.factor,s.label,'编码与定义不同','需拆分适用地区','工作簿编码有global，定义表没有统一global档']);
 if(s.factor==='核心业务依赖'&&s.scenes.includes('软件勒索')&&['moderate','medium'].includes(s.label))issues.push([`训练!K${s.row}`,s.company,s.factor,s.label,'跨场景档位不同','分场景处理','软件勒索定义仅未确认/低/高；营业中断含中/极高']);
}
issues.push(['训练!K153:K160','百图生科（北京）智能技术有限公司','高敏感数据/对外服务/机构数','多个已填值','证据链需核实','保留标注，暂不推广','历史描述PII仅员工且无显著第三方责任；填写regulated_high、SaaS、yes、201_1000可能另有外部依据，当前文件未附。']);
issues.push(['测试!K2:K40','全部','原始下拉选项','外部引用','可移植性','结果内置编码表','原定义名称引用[1]枚举选项；已从OOXML外部链接缓存恢复有效选项。']);
const audits=[];for(const r of results){sh.getRange(`K${r.row}`).values=[[r.value]];sh.getRange(`L${r.row}`).values=[[r.status]];if(typeof r.value==='number')sh.getRange(`K${r.row}`).setNumberFormat(r.factor==='营业额'?'#,##0.00':'#,##0');audits.push([r.row,r.company,r.factor,r.scenes,r.old,r.value,r.status,r.rule,r.evidence,r.reason,r.followup,r.proposal??'',r.analogy,r.similar]);}
sh.getRange(`K1:K${original.length}`).format.columnWidth=31;sh.getRange(`L1:L${original.length}`).format.columnWidth=29;
sh.getRange(`K1:L${original.length}`).format.wrapText=true;
sh.getRange(`K2:K${original.length}`).conditionalFormats.add('cellIs',{operator:'equal',formula:'"unknown"',format:{fill:'#FFF1CF',font:{color:'#8A5700'}}});
function col(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
let tableIdx=0;
function sheet(name,headers,rows,widths){const s=wb.worksheets.add(name),data=[headers,...rows];s.getRange(`A1:${col(headers.length)}${data.length}`).values=data;s.showGridLines=false;s.getRange(`A1:${col(headers.length)}${data.length}`).format={font:{name:'Microsoft YaHei',size:10},wrapText:true,rowHeight:68};s.getRange(`A1:${col(headers.length)}1`).format={fill:'#136B75',font:{bold:true,color:'#FFFFFF'},rowHeight:32};for(let i=0;i<headers.length;i++)s.getRange(`${col(i+1)}1:${col(i+1)}${data.length}`).format.columnWidth=widths?.[i]??25;s.freezePanes.freezeRows(1);if(rows.length)s.tables.add(`A1:${col(headers.length)}${data.length}`,true,`Output${++tableIdx}`);return s;}
const summary=sheet('运行说明',['项目','结果/说明'],[
 ['版本',config.runInfo?.mode??'v0.6｜自动检测Node.js、遵守robots.txt、改进错误处理；业务逻辑与v0.5一致'],
 ['训练数据',`${new Set(allTrain.map(x=>x.company)).size}家企业，${allTrain.length}条因子，${samples.length}条人工标注；空白不是负例。`],
 ['测试范围',`${new Set(targets.map(x=>x.company)).size}家企业，${results.length}条；K列为试填候选，L列说明状态。`],
 ['具体候选数',results.filter(x=>x.value!=='unknown').length],
 ['unknown数',results.filter(x=>x.value==='unknown').length],
 ['年度与口径',(config.runInfo?.companies??[]).filter(c=>c.targetYear).map(c=>`${c.company}：${c.targetYear}年度；${c.financialScope==='parent'?'母公司单体（仅投保法人）':c.financialScope==='group'?'集团合并':'口径待核实'}`).join('；')||'未提供目标年度；公开年份保留在证据中，不能默认以最新替代历史。'],
 ['基线验证',`按企业留一验证：每次排除同一企业全部标注；覆盖${covered.length}/${samples.length}；一致${correct}/${covered.length}；仅衡量字符相似案例基线。`],
 ['反馈与评估','案例已参与规则修订，不作独立测试集；留一基线仅使用原训练。模型输出均为待核实候选。'],
 ['模型边界','自动类比是建议，不是事实；多场景标准冲突以unknown回写并在明细给出分场景候选。'],
 ['财务人数','示例公司收入改unknown；23为用户建议采用的参保人数，非核实员工总数。另一示例公司2项数值仍是原搜索摘要候选。'],
 ['重复运行','请使用v0.6入口；按缺失字段补查，最多三轮分析。搜索、文档及模型独立缓存；失败和空搜索结果不作成功缓存。具体用量见运行日志。'],
 ['你的审核','K列为候选，L列是来源状态；人工已填内容保留。模型不能替代最终核保确认。']
],[22,110]);
summary.getRange('B5').formulas=[[`=COUNTIF('Sheet1'!K2:K${original.length},"<>unknown")`]];
summary.getRange('B6').formulas=[[`=COUNTIF('Sheet1'!K2:K${original.length},"unknown")`]];
sheet('逐项依据',['测试行','企业','因子','适用场景','原入参','试填值','状态','规则','证据ID','判断理由','需补充/核实','分场景或未采纳建议','相似案例建议','相似训练记录'],audits,[10,30,27,28,23,30,28,10,18,65,55,36,29,60]);
const textLines=(value,width)=>String(value??'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/width)),0);
for(let i=0;i<audits.length;i++){
 const height=Math.min(300,Math.max(68,18*Math.max(textLines(audits[i][9],39),textLines(audits[i][10],33))+12));
 wb.worksheets.getItem('逐项依据').getRange(`A${i+2}:N${i+2}`).format.rowHeight=height;
}
sheet('规则初稿',['规则ID','因子','规则内容','训练来源','适用限制','规则类型'],config.rules.map(r=>[r.id,r.factor,r.condition,r.examples,r.guard,r.type]),[12,30,72,36,80,22]);
sheet('训练标注',['原始单元格','企业','因子','场景','原入参','你的原始填写','规范化候选','主营业务','历史核保分析'],samples.map(s=>[`训练!K${s.row}`,s.company,s.factor,s.scenes,s.old,s.label,normalize(s.factor,s.label),s.business,s.history]),[18,32,28,33,24,29,29,90,120]);
sheet('训练疑点',['位置','企业','因子','原填写/情况','问题类别','建议处理','原因'],issues,[25,32,35,30,25,35,90]);
sheet('联网证据',['证据ID','企业','字段','来源类型','来源URL','数据年度/时间','证据摘录','核验程度','使用限制','检索日期'],config.evidence.map(e=>[e.id,e.company,e.field,e.source,e.url,e.period,e.quote,e.quality,e.note,e.accessed]),[12,30,25,27,80,38,90,32,95,16]);
for(let i=0;i<config.evidence.length;i++)wb.worksheets.getItem('联网证据').getRange(`A${i+2}:J${i+2}`).format.rowHeight=Math.min(360,Math.max(68,18*textLines(config.evidence[i].quote,53)+12));
sheet('留一企业验证',['标注位置','企业','因子','人工原值','规范化人工值','基线预测','一致性','相似度非置信度','参考案例'],evaluated.map(e=>[`训练!K${e.s.row}`,e.s.company,e.s.factor,e.s.label,normalize(e.s.factor,e.s.label),e.p??'无其他企业样本',e.p===null?'未覆盖':e.correct?'一致':'不一致',e.score,e.source]),[18,30,27,28,28,30,16,20,22]);
const opts=[];const optRanges={};for(const [factor,values] of Object.entries(config.fieldEnums)){const start=opts.length+2;for(const v of values)opts.push([factor,v]);optRanges[factor]=`'本地枚举'!$B$${start}:$B$${opts.length+1}`;}
sheet('本地枚举',['因子','允许编码'],opts,[48,54]);
for(const [factor,name] of Object.entries(config.namedEnums)){try{wb.names.getItem(name).delete();}catch(e){if(!String(e.message).includes('not found'))throw e;}wb.names.add(name,optRanges[factor]);}
for(const r of results){if(optRanges[r.factor])sh.getRange(`K${r.row}`).dataValidation={rule:{type:'list',formula1:config.namedEnums[r.factor]??optRanges[r.factor]}};}
const questions=results.filter(r=>r.value==='unknown'||!r.status.includes('直接证据')).map(r=>[r.company,r.row,r.factor,r.value,r.status,r.followup]);
sheet('待核实清单',['企业','测试行','因子','当前试填','状态','核实问题'],questions,[32,10,32,30,30,90]);
const queries=[];for(const company of new Set(targets.map(r=>r.company)))for(const group of ['官网 主营业务 国民经济行业','营业收入 员工人数 年报','服务器 终端 数据中心 数量'])queries.push([company,group,'https://www.so.com/s?q='+encodeURIComponent(company+' '+group),'供人工补查；程序的实际检索结果、读取状态和来源另见联网证据、联网与调用状态。']);
sheet('后续检索入口',['企业','查询主题','检索URL','说明'],queries,[32,38,95,85]);

if(config.feedback){
 const fr=sheet('用户反馈与规则边界',['原表行','因子','用户原始建议','规范编码','上版值','来源（用户提供）','采纳理由','证据边界','适用范围'],config.feedback.map(f=>[f.row,f.factor,f.raw,f.value,f.previousValue,f.source,f.reason,f.limit,f.generalization]),[10,31,34,36,30,55,75,95,38]);
 fr.getRange(`A2:I${config.feedback.length+1}`).format.rowHeight=110;
 sheet('学习增量',['规则','学习内容','本案来源','推广条件'],config.feedbackRules,[13,43,48,92]);
}

if(config.runInfo){
 sheet('联网与调用状态',['企业','检索状态','结果条数','模型状态','输入tokens','输出tokens','说明'],config.runInfo.companies.map(c=>[c.company,c.searchStatus,c.sourceCount,c.modelStatus,c.inputTokens??0,c.outputTokens??0,c.note??'']),[32,32,12,30,15,15,100]);
 sheet('自动调查与预算',['企业','目标年度','财务口径','Search请求','Fetch请求','公开备用搜索','读取尝试','成功读取','搜索缓存','文档缓存','分析轮数'],config.runInfo.companies.map(company=>[company.company,company.targetYear??'',company.financialScope??'',company.counts?.searchRequests??0,company.counts?.fetchRequests??0,company.counts?.publicSearchRequests??0,company.counts?.readAttempts??0,company.counts?.readSuccess??0,company.counts?.searchCacheHits??0,company.counts?.documentCacheHits??0,company.rounds?.length??0]),[32,14,18,15,15,16,14,14,14,14,14]);
}
const previewDir=arg('--preview',path.join(here,'预览'));await fs.mkdir(previewDir,{recursive:true});
const ranges={'Sheet1':'K1:L5','运行说明':'A1:B6','逐项依据':'A1:G5','规则初稿':'A1:C5','训练标注':'A1:G5','训练疑点':'A1:E5','联网证据':'A1:D5','留一企业验证':'A1:G5','本地枚举':'A1:B7','待核实清单':'A1:E5','后续检索入口':'A1:B5'};
if(config.feedback){ranges['用户反馈与规则边界']='A1:D6';ranges['学习增量']='A1:D6';}
if(config.runInfo)ranges['联网与调用状态']='A1:G5';
for(const [name,range] of Object.entries(ranges)){if(process.argv.includes('--no-preview'))continue;const blob=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(path.join(previewDir,`${name}.png`),new Uint8Array(await blob.arrayBuffer()));}
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{useRegex:true,maxResults:20},maxChars:2000});console.log('FORMULA_SCAN',errors.ndjson);
await fs.mkdir(path.dirname(output),{recursive:true});await (await SpreadsheetFile.exportXlsx(wb)).save(output);
const stats={output,feedbackLabels:config.feedback?.length??0,trainCompanies:new Set(allTrain.map(x=>x.company)).size,trainRows:allTrain.length,labels:samples.length,testRows:results.length,candidates:results.filter(x=>x.value!=='unknown').length,unknown:results.filter(x=>x.value==='unknown').length,looCovered:covered.length,looCorrect:correct,looTotal:samples.length,issues:issues.length};
await fs.writeFile(path.join(path.dirname(output),'运行统计_v0.6.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats,null,2));
