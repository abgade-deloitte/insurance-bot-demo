import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {configuration} from '../server/config.mjs';
const app=createApp(configuration({}));await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
try{
 const url=`http://127.0.0.1:${app.address().port}/tests/multi-agent-orchestration.html?run=${Date.now()}`;
 const result=await new Promise((resolve,reject)=>{const proc=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-cache','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+fileURLToPath(new URL('./artifacts/multi-agent-profile/',import.meta.url)),'--virtual-time-budget=125000','--window-size=1400,1000','--dump-dom',url],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';proc.stdout.on('data',data=>output+=data);proc.stderr.on('data',data=>errors+=data);proc.on('error',reject);proc.on('close',()=>resolve({output,errors}));});
 const status=result.output.match(/<p id="status">([^<]*)<\/p>/)?.[1]||'Did not finish',checks=[...result.output.matchAll(/<li class="(?:pass|fail)">([^<]*)<\/li>/g)].map(match=>match[1]),report=[status,...checks].join('\n');console.log(report);await writeFile(new URL('./artifacts/multi-agent-report.txt',import.meta.url),report);await writeFile(new URL('./artifacts/multi-agent-errors.log',import.meta.url),result.errors);await writeFile(new URL('./artifacts/multi-agent-dom.html',import.meta.url),result.output);if(!result.output.includes('data-result="passed"'))process.exitCode=1;
}finally{await new Promise(resolve=>app.close(resolve));}
