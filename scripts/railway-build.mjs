import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const child = spawnSync(
  process.execPath,
  [cli, 'build', '--config', 'vite.railway.config.ts'],
  {
    stdio: 'inherit',
    env: {...process.env, CISNE_BUILD_TARGET: 'railway'},
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
