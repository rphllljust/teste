import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertRailwayStaging} from './railway-preflight.mjs';

// Staging-only Node runtime. Never launch this migration preview in production.
// Full business availability additionally requires independently verified
// authentication and PostgreSQL repositories; legacy D1 APIs fail closed here.
assertRailwayStaging(process.env);

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('RAILWAY_PORT_INVALID: expected a valid PORT');
}
const cli = fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url));
const child = spawn(
  process.execPath,
  [cli, 'start', '--port', String(port)],
  {stdio:'inherit',env:{...process.env, HOST:'0.0.0.0'}},
);
for (const signal of ['SIGTERM','SIGINT']) {
  process.on(signal, () => {if (!child.killed) child.kill(signal);});
}
child.on('error', error => {console.error('RAILWAY_NODE_START_FAILED', error.message);process.exitCode=1;});
child.on('exit', (code, signal) => {process.exitCode=code ?? (signal ? 1 : 0);});
