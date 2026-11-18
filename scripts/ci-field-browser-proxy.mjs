// HTTPS reverse proxy for the disposable Chromium CI runtime only.
// This does not emulate or alter login, OTP or session validation.
import {createServer} from 'node:https';
import {request as proxy,createServer as createHttpServer} from 'node:http';
import {connect as connectTcp} from 'node:net';
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

// CONNECT tunnel retains the real canonical HTTPS hostname, browser cookie
// scope and Origin; it never resolves or connects to public Railway hosts.
const domain='cisne-web-staging-staging.up.railway.app:443';
const tunnel=createHttpServer((_req,res)=>{res.writeHead(403);res.end();});
tunnel.on('connect',(req,downstream,head)=>{
  if(req.url?.toLowerCase()!==domain){
    downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;
  }
  const upstream=connectTcp(9443,'127.0.0.1');
  upstream.once('connect',()=>{
    downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if(head.length)upstream.write(head);
    downstream.pipe(upstream);upstream.pipe(downstream);
  });
  upstream.on('error',()=>downstream.destroy());
  downstream.on('error',()=>upstream.destroy());
  upstream.on('close',()=>downstream.destroy());
  downstream.on('close',()=>upstream.destroy());
});
tunnel.listen(8888,'127.0.0.1',()=>console.log('FIELD_BROWSER_CANONICAL_TUNNEL_READY'));

