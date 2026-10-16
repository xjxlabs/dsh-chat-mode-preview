/** Prepare and run only this checkout's isolated Experimental Preview profile. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,realpathSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const home=join(root,'.preview','home'),runner=join(root,'.preview','runner');
const profile=join(home,'profiles','preview'),plugin=join(root,'plugin');
const action=process.argv[2]??'start',flags=process.argv.slice(3);
if(!['setup','start'].includes(action)||flags.some(f=>f!=='--no-open'))throw new Error('Usage: node scripts/preview.mjs setup|start [--no-open]');

function setup(){
 mkdirSync(join(profile,'node_modules'),{recursive:true});mkdirSync(runner,{recursive:true});
 const manifest={name:'dsh-chat-preview-profile',private:true,type:'module',packageManager:'pnpm@11.7.0',dependencies:{'dsh-plugin-no-workspace':'link:../../../../plugin'},dsh:{profile:{patchReload:'startup',bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-plugin-no-workspace']}}};
 const path=join(profile,'package.json');
 if(existsSync(path)){const current=JSON.parse(readFileSync(path,'utf8'));if(JSON.stringify(current)!==JSON.stringify(manifest))throw new Error('Existing preview profile differs; preserve it and use a fresh checkout.');}
 else writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
 for(const file of ['cordis.yml','cordis.patch.yml'])if(!existsSync(join(profile,file)))writeFileSync(join(profile,file),'[]\n');
 const link=join(profile,'node_modules','dsh-plugin-no-workspace');
 if(existsSync(link)){if(realpathSync(link)!==realpathSync(plugin))throw new Error('Preview plugin link points elsewhere; refusing to replace it.');}
 else symlinkSync(plugin,link,process.platform==='win32'?'junction':'dir');
 // The plugin is resolved from its own source directory, outside profile fallback lookup.
 // Bind its optional runtime peer to the paired Harness, never to an unrelated npm release.
 const peer=join(plugin,'node_modules','@deepseek-ai','dsh-tool-web');
 const peerSource=join(root,'harness','packages','web','tool-web');
 mkdirSync(dirname(peer),{recursive:true});
 if(existsSync(peer)){if(realpathSync(peer)!==realpathSync(peerSource))throw new Error('Plugin web peer is not the bundled Harness; use a clean npm ci then setup.');}
 else symlinkSync(peerSource,peer,process.platform==='win32'?'junction':'dir');
}

setup();
if(action==='setup')console.log('Preview profile ready under .preview/home. No personal configuration was read.');
else{
 const cli=join(root,'harness','apps','cli','lib','bin.js');
 if(!existsSync(cli)||!existsSync(join(root,'harness','apps','web','dist','index.html')))throw new Error('Build artifacts missing. Follow the build steps in README.md first.');
 if(!process.env.DEEPSEEK_API_KEY?.trim())throw new Error('Set DEEPSEEK_API_KEY in this terminal. This launcher does not read personal credential files.');
 const port=Number(process.env.DSH_PREVIEW_PORT??56841);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('DSH_PREVIEW_PORT must be an integer between 1024 and 65535.');
 const env={...process.env,DSH_HOME:home,DSH_AGENTS_HOME:join(home,'instructions'),DSH_TELEMETRY_DISABLED:'1'};
 for(const key of Object.keys(env))if(key.startsWith('DSH_SNAPSHOT'))delete env[key];
 const child=spawn(process.execPath,[cli,'--profile','preview','--host','127.0.0.1','--port',String(port),...flags],{cwd:runner,env,stdio:'inherit',windowsHide:true});
 child.on('error',e=>{console.error(e.message);process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);});
 child.on('exit',(code)=>{process.exitCode=code??1;});
}
