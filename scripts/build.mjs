/** Build the paired source trees, including source archives without Git metadata. */
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let revision;
try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
catch{revision='1abfb100c6211006ef7238c338dba7db47304ef9';console.log('No committed Git HEAD: build metadata uses the documented Harness integration base (source archive mode).');}
const env={...process.env,DSH_CLIENT_COMMIT_HASH:revision};
for(const [folder,command,args] of [['harness','pnpm',['run','build']],['plugin','npm',['run','build']]]){
 const result=spawnSync(command,args,{cwd:join(root,folder),env,stdio:'inherit',shell:process.platform==='win32',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
