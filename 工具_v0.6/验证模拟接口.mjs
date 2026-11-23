import dns from 'node:dns/promises';
const makeText=company=>`离线模拟验证，非真实企业数据。${company} 2025年度营业收入${company==='验证乙科技有限公司'?200:100}元。2025年度员工人数${company==='验证乙科技有限公司'?47:23}人。仅测试程序读取、判断和Excel导出，不代表任何企业事实。`.repeat(3);
dns.lookup=async(host,options)=>options?.all?[{address:'93.184.216.34',family:4}]:{address:'93.184.216.34',family:4};
globalThis.fetch=async(url,options={})=>{
 const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 if(url==='https://api.deepseek.com/v1/tools/search'){const company=JSON.parse(options.body).query.split(' ')[0];return json({results:[{url:'https://example.com/offline-test-only/'+encodeURIComponent(company),title:company+' 离线模拟数据',content:makeText(company),date:'2026-10-27T00:00:00+00:00'}]});}
 if(url==='https://api.deepseek.com/v1/tools/fetch'){const company=decodeURIComponent(new URL(JSON.parse(options.body).url).pathname.split('/').at(-1));return json({title:company+' 离线模拟数据',content:makeText(company)});}
 if(url==='https://api.deepseek.com/chat/completions'){
  const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content);
  const decisions=payload.fields.map(field=>{
   if(!['营业额','员工人数'].includes(field.factor))return {row:field.row,factor:field.factor,value:'unknown',reason:'离线模拟验证，不对真实业务作结论',followup:'本文件仅用于程序验证'};
   const value=field.factor==='营业额'?(payload.company==='验证乙科技有限公司'?200:100):(payload.company==='验证乙科技有限公司'?47:23);
   const quote=field.factor==='营业额'?`2025年度营业收入${value}元`:`2025年度员工人数${value}人`;
   const document=payload.sources.find(source=>source.text.includes(quote));
   return {row:field.row,factor:field.factor,value,basis:'fact',reason:'离线模拟数据，仅测试流程，不代表企业真实情况',followup:'不可用于核保',period:'2025',citations:[{id:document.id,quote}],numericFact:{rawNumber:String(value),unit:field.factor==='营业额'?'元':'人',metric:field.factor,period:'2025',scope:'投保主体'}};
  });
  return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions})}}],usage:{prompt_tokens:100,completion_tokens:100}});
 }
 if(String(url).startsWith('https://example.com/')){const company=decodeURIComponent(new URL(url).pathname.split('/').at(-1));return new Response('<html><title>'+company+' 离线模拟</title><body>'+makeText(company)+'</body></html>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}});}
 throw new Error('离线验证禁止访问外网');
};
