import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {configuration} from '../server/config.mjs';
process.env.ART_LOGIN_USERNAME='existing';process.env.ART_LOGIN_PASSWORD='secure-password';
const app=createApp(configuration({}));await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
try{
 const url=`http://127.0.0.1:${app.address().port}/tests/registration-flow.html?run=${Date.now()}`;
 const result=await new Promise((resolve,reject)=>{const proc=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-cache','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+fileURLToPath(new URL('./artifacts/registration-profile-current/',import.meta.url)),'--virtual-time-budget=240000','--window-size=1200,900','--dump-dom',url],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';proc.stdout.on('data',data=>output+=data);proc.stderr.on('data',data=>errors+=data);proc.on('error',reject);proc.on('close',()=>resolve({output,errors}));});
 const status=result.output.match(/<p id="status">([^<]*)<\/p>/)?.[1]||'Did not finish';const checks=[...result.output.matchAll(/<li class="(?:pass|fail)">([^<]*)<\/li>/g)].map(match=>match[1]);const report=[status,...checks].join('\n');console.log(report);await writeFile(new URL('./artifacts/registration-current-report.txt',import.meta.url),report);await writeFile(new URL('./artifacts/registration-current-errors.log',import.meta.url),result.errors);await writeFile(new URL('./artifacts/registration-current-dom.html',import.meta.url),result.output);if(!result.output.includes('data-result="passed"'))process.exitCode=1;
}finally{await new Promise(resolve=>app.close(resolve));}
