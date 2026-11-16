// Loopback-only HTTPS transport for __Host- Secure cookies in disposable CI.
import {createServer} from 'node:https';
import {request as proxyRequest} from 'node:http';
import {readFileSync} from 'node:fs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||
   Object.keys(process.env).some(key=>key.startsWith('RAILWAY_')))
  throw Error('NO-GO: local TLS bridge cannot run outside disposable CI');
const cert=readFileSync('/tmp/rc80-local.cert');
const key=readFileSync('/tmp/rc80-local.key');
createServer({cert,key},(req,res)=>{
  const upstream=proxyRequest({
    hostname:'127.0.0.1',port:8787,
    method:req.method,path:req.url,
    headers:{...req.headers,host:'127.0.0.1:8787','x-forwarded-proto':'https'},
  },response=>{
    res.writeHead(response.statusCode??502,response.headers);
    response.pipe(res);
  });
  upstream.on('error',()=>{
    if(!res.headersSent)res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}).listen(9443,'127.0.0.1',()=>{
  console.log('RC80 local HTTPS bridge available only at 127.0.0.1:9443');
});
