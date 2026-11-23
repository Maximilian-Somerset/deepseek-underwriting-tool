import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

async function loadWorkbookTools(){
 const resolvers=[createRequire(import.meta.url),createRequire(path.resolve(path.dirname(process.execPath),'../node_modules/__resolver.cjs'))];
 for(const resolver of resolvers){let filename;try{filename=resolver.resolve('@oai/artifact-tool');}catch(error){if(error.code==='MODULE_NOT_FOUND')continue;throw error;}return import(pathToFileURL(filename).href);}
 throw new Error('缺少本机Excel处理依赖，请通过启动.ps1使用Codex自带Node运行环境');
}
export const {FileBlob,SpreadsheetFile}=await loadWorkbookTools();
