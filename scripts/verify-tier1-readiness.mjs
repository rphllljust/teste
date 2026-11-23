import {access,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
const required=['app/module-registry.ts','app/EnterpriseWorkspaceBar.tsx','app/enterprise-floorplans.css','app/finance-floorplans.css','app/operations-floorplans.css','drizzle-pg/0016_integration_outbox.sql','test/frontend-wave.contract.test.mjs','lib/infrastructure/outbox-worker.ts'];
const checks=[];
for(const file of required){try{await access(file,constants.F_OK);checks.push({file,ok:true})}catch{checks.push({file,ok:false})}}
const pkg=JSON.parse(await readFile('package.json','utf8'));const workflow=await readFile('.github/workflows/quality.yml','utf8');
checks.push({file:'package.json:test',ok:typeof pkg.scripts?.test==='string'&&pkg.scripts.test.includes('test:frontend-contract')&&pkg.scripts.test.includes('test:outbox')});
checks.push({file:'quality.yml:gates',ok:workflow.includes('pnpm test:frontend-contract')&&workflow.includes('pnpm test:outbox')&&workflow.includes('pnpm build')});
const failed=checks.filter(check=>!check.ok);for(const check of checks)console.log(`${check.ok?'PASS':'FAIL'} ${check.file}`);if(failed.length){process.exitCode=1;throw new Error(`${failed.length} readiness checks failed`) }console.log('Tier-1 staging readiness: PASS');
