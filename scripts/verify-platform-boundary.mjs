import {readFile} from 'node:fs/promises';

const files=['package.json','.github/workflows/build-and-deploy.yml'];
for(const file of files){const source=await readFile(file,'utf8');if(/vercel/i.test(source))throw new Error(`Vercel reference is not allowed in ${file}`);}
const workflow=await readFile('.github/workflows/build-and-deploy.yml','utf8');
if(!workflow.includes('Railway project genuine-renewal')||!workflow.includes('environment staging'))throw new Error('Railway staging boundary is missing');
console.log('Platform boundary: PASS (Railway staging only; no Vercel)');
