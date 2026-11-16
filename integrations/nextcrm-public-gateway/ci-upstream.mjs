// Disposable test-only HTTP upstream for Railway edge-origin regression tests.
// This fixture is NOT copied into the production gateway container.
import { createServer } from 'node:http';
const publicOrigin = 'https://nextcrm-gateway-staging.up.railway.app';
createServer((request, response) => {
  const route = new URL(request.url ?? '/', 'http://fixture.local').pathname;
  if (route === '/__origin_probe') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      host: request.headers.host,
      forwardedHost: request.headers['x-forwarded-host'],
      forwardedProto: request.headers['x-forwarded-proto'],
      forwardedPort: request.headers['x-forwarded-port'],
    }));
  } else if (route === '/__bad_redirect') {
    response.writeHead(307, { Location: publicOrigin + ':3000/en/sign-in?from=test' });
    response.end();
  } else if (route === '/__bad_http_redirect') {
    response.writeHead(307, { Location: 'http://nextcrm-gateway-staging.up.railway.app/en/sign-in' });
    response.end();
  } else if (route === '/__oauth_redirect') {
    response.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic' });
    response.end();
  } else if (route.startsWith('/api/internal')) {
    response.statusCode = 200;
    response.end('PRIVATE_PATH_WAS_LEAKED');
  } else {
    response.statusCode = 200;
    response.end('NEXTCRM_PUBLIC_OK');
  }
}).listen(3000, '0.0.0.0');
