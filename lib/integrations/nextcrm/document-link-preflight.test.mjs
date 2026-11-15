import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeOrderDocumentLink,
  OrderDocumentLinkDenied,
} from './document-link-preflight.ts';

const request = {
  serviceOrderId: 'a2345678-b123-4a56-8123-123456789abc',
  nextcrmDocumentId: 'doc0123456',
  documentKind: 'service_report',
  version: 2,
  sha256: 'a'.repeat(64),
};
const actor = 'erp-user-1';
function makeDeps(overrides = {}) {
  return {
    resolveMappedIdentity: async () => ({erpActorId: actor, nextcrmSubjectId:'ncrm-user-1', tenantKey:'tenant-1'}),
    findOwnedOrder: async () => ({id:request.serviceOrderId,ownerId:actor,clientId:'client-1'}),
    findAccountMapping: async () => ({accountId:'account-1',tenantKey:'tenant-1'}),
    verifyDocumentForLink: async () => ({id:request.nextcrmDocumentId,tenantKey:'tenant-1',accountId:'account-1',version:2,sha256:'a'.repeat(64),canLink:true}),
    ...overrides,
  };
}
async function denies(deps, data=request, actorId=actor) {
  await assert.rejects(() => authorizeOrderDocumentLink(data,actorId,deps), e => e instanceof OrderDocumentLinkDenied);
}

test('accepts only a fully mapped, owned and explicitly authorized document', async () => {
  const result = await authorizeOrderDocumentLink(request,actor,makeDeps());
  assert.equal(result.ownerId,actor);
  assert.equal(result.tenantKey,'tenant-1');
  assert.equal(result.erpClientId,'client-1');
  assert.equal(result.nextcrmAccountId,'account-1');
  assert.equal(result.sha256,'a'.repeat(64));
});

test('requires a trusted ERP principal and a matching identity mapping', async () => {
  await denies(makeDeps(),request,'');
  await denies(makeDeps({resolveMappedIdentity:async()=>null}));
  await denies(makeDeps({resolveMappedIdentity:async()=>({erpActorId:'attacker',nextcrmSubjectId:'ncrm-user-1',tenantKey:'tenant-1'})}));
  await denies(makeDeps({resolveMappedIdentity:async()=>({erpActorId:actor,nextcrmSubjectId:'',tenantKey:'tenant-1'})}));
});

test('rejects foreign, missing and legacy ownerless service orders', async () => {
  await denies(makeDeps({findOwnedOrder:async()=>null}));
  await denies(makeDeps({findOwnedOrder:async()=>({id:request.serviceOrderId,ownerId:'other',clientId:'client-1'})}));
  await denies(makeDeps({findOwnedOrder:async()=>({id:request.serviceOrderId,ownerId:null,clientId:'client-1'})}));
  await denies(makeDeps({findOwnedOrder:async()=>({id:request.serviceOrderId,ownerId:actor,clientId:null})}));
  await denies(makeDeps({findOwnedOrder:async()=>({id:'other',ownerId:actor,clientId:'client-1'})}));
});

test('requires a tenant-consistent account mapping to the ERP client', async () => {
  await denies(makeDeps({findAccountMapping:async()=>null}));
  await denies(makeDeps({findAccountMapping:async()=>({accountId:'account-1',tenantKey:'tenant-2'})}));
});

test('denies a missing, foreign, mismatched or non-linkable NextCRM document', async () => {
  const variants=[
    null,
    {id:request.nextcrmDocumentId,tenantKey:'tenant-2',accountId:'account-1',version:2,sha256:'a'.repeat(64),canLink:true},
    {id:request.nextcrmDocumentId,tenantKey:'tenant-1',accountId:'other-account',version:2,sha256:'a'.repeat(64),canLink:true},
    {id:'wrong-doc',tenantKey:'tenant-1',accountId:'account-1',version:2,sha256:'a'.repeat(64),canLink:true},
    {id:request.nextcrmDocumentId,tenantKey:'tenant-1',accountId:'account-1',version:2,sha256:'a'.repeat(64),canLink:false},
    {id:request.nextcrmDocumentId,tenantKey:'tenant-1',accountId:'account-1',version:1,sha256:'a'.repeat(64),canLink:true},
  ];
  for (const item of variants) await denies(makeDeps({verifyDocumentForLink:async()=>item}));
});

test('does not trust a caller-provided digest that differs from the upstream document', async () => {
  await denies(makeDeps(),{...request,sha256:'b'.repeat(64)});
  await denies(makeDeps({verifyDocumentForLink:async()=>({id:request.nextcrmDocumentId,tenantKey:'tenant-1',accountId:'account-1',version:2,sha256:null,canLink:true})}));
});

test('never queries external documents after denied order ownership', async () => {
  let called=false;
  const deps=makeDeps({
    findOwnedOrder:async()=>null,
    verifyDocumentForLink:async()=>{called=true;throw new Error('should not be called');},
  });
  await denies(deps);
  assert.equal(called,false);
});

test('rejects tenant and owner spoofing in payload before calling connectors', async () => {
  let called=false;
  const deps=makeDeps({resolveMappedIdentity:async()=>{called=true;return null;}});
  await assert.rejects(()=>authorizeOrderDocumentLink({...request,tenantKey:'tenant-1'},actor,deps));
  await assert.rejects(()=>authorizeOrderDocumentLink({...request,ownerId:actor},actor,deps));
  assert.equal(called,false);
});
