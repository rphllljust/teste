// HTTPS reverse proxy for the disposable Chromium CI runtime only.
// This does not emulate or alter login, OTP or session validation.
import {createServer} from 'node:https';
import {request as proxy} from 'node:http';
import {readFileSync} from 'node:fs';
const u=new URL(process.env.DATABASE_URL??'about:blank');
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
  !['127.0.0.1','localhost'].includes(u.hostname)||
  u.pathname!=='/cisne_ci'||u.port!=='5432')
  throw new Error('FIELD_BROWSER_NO_GO: only disposable loopback GitHub CI allowed');
const key=readFileSync('/tmp/field-browser.key');
const cert=readFileSync('/tmp/field-browser.crt');
createServer({key,cert},(req,res)=>{
  const upstream=proxy({
    hostname:'127.0.0.1',port:8787,method:req.method,path:req.url,
    headers:{...req.headers,host:'127.0.0.1:8787','x-forwarded-proto':'https'},
  },r=>{
    res.writeHead(r.statusCode??502,r.headers);
    r.pipe(res);
  });
  upstream.on('error',()=>{
    if(!res.headersSent)res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}).listen(9443,'127.0.0.1',()=>{
  console.log('FIELD_BROWSER_LOOPBACK_HTTPS_READY port=9443');
});
