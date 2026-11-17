// CI-only local TLS proxy for SigV4. No real Railway request is sent.
// /etc/hosts on the ephemeral runner maps the public staging host to loopback.
import {createServer} from 'node:https';
import {request} from 'node:http';
import {readFileSync} from 'node:fs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true')
  throw Error('CI-only TLS server required');
createServer({
  cert:readFileSync('/tmp/rc82-local.cert'),
  key:readFileSync('/tmp/rc82-local.key'),
},(incoming,outgoing)=>{
  if(incoming.headers.host!=='nextcrm-minio-staging.up.railway.app'){
    outgoing.writeHead(421);outgoing.end();return;
  }
  const upstream=request({
    hostname:'127.0.0.1',port:19000,
    method:incoming.method,path:incoming.url,
    headers:{...incoming.headers,host:incoming.headers.host},
  },response=>{
    outgoing.writeHead(response.statusCode??502,response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error',()=>{
    if(!outgoing.headersSent)outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
}).listen(443,'127.0.0.1',()=>{
  console.log('RC82_EPHEMERAL_TLS_PROXY_READY');
});
