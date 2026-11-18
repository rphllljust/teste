import {createServer as httpsServer} from 'node:https';
import {request as proxy,createServer as httpServer} from 'node:http';
import {connect as tcp} from 'node:net';
import {readFileSync as read} from 'node:fs';
const db=new URL(process.env.DATABASE_URL??'about:blank');
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||db.hostname!=='127.0.0.1'||db.port!=='5432'||db.pathname!=='/cisne_ci')throw new Error('FIELD_BROWSER_NO_GO');
httpsServer({key:read('/tmp/field-browser.key'),cert:read('/tmp/field-browser.crt')},(req,res)=>{
  const upstream=proxy({hostname:'127.0.0.1',port:8787,method:req.method,path:req.url,headers:{...req.headers,host:'127.0.0.1:8787','x-forwarded-proto':'https'}},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
}).listen(9443,'127.0.0.1');
const tunnel=httpServer((_req,res)=>{res.writeHead(403);res.end();});
tunnel.on('connect',(req,downstream,head)=>{
  if(req.url?.toLowerCase()!=='cisne-web-staging-staging.up.railway.app:443'){downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  const upstream=tcp(9443,'127.0.0.1');upstream.once('connect',()=>{downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);downstream.pipe(upstream);upstream.pipe(downstream);});
  upstream.on('error',()=>downstream.destroy());downstream.on('error',()=>upstream.destroy());
}).listen(8888,'127.0.0.1');
