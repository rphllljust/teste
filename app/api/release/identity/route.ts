import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Read-only, nonsecret staging SHA attestation. Never a proxy for business acceptance.
export async function GET() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging')
    return NextResponse.json({error:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
  const sha=process.env.RAILWAY_GIT_COMMIT_SHA;
  return NextResponse.json({environment:'staging',sha:typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)?sha:null},
    {headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
}
