import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import IntegrationHub from '../../app/IntegrationHub';

test('RC99 integrated screen is part of Field app, accessible and explicit about unverified state',()=>{
  const html=renderToStaticMarkup(createElement(IntegrationHub,{
    onOpenOrder:()=>{},onOpenFinance:()=>{},onOpenCRM:()=>{},
  }));
  assert.match(html,/Central de integração CISNE e NextCRM/);
  assert.match(html,/Uma operação, módulos conectados/);
  assert.match(html,/Ordens de serviço/);
  assert.match(html,/Documentos e permissões/);
  assert.match(html,/Medições e recebíveis/);
  assert.match(html,/Verificando conexão/);
  assert.match(html,/não declara homologação concluída/);
  assert.doesNotMatch(html,/<iframe/i);
  assert.doesNotMatch(html,/\b(?:100|95)%\b/);
});

test('RC99 navigation is native to the same CISNE page and not a redirect or iframe',()=>{
  const page=readFileSync('app/page.tsx','utf8');
  assert.match(page,/\['Central de integração',Layers\]/);
  assert.match(page,/page==='Central de integração'\?<IntegrationHub/);
  assert.match(page,/onOpenOrder=\{id=>\{navigate\('Ordens de serviço'\)/);
  assert.match(page,/onOpenFinance=\{id=>navigate\('Financeiro',id\)\}/);
  assert.match(page,/onOpenCRM=\{\(\)=>navigate\('CRM e Vendas'\)\}/);
});

test('RC99 uses only same-origin authorized APIs, approved paging, and existing NextCRM document controller',()=>{
  const source=readFileSync('app/IntegrationHub.tsx','utf8');
  assert.match(source,/\/api\/orders\?page=1&pageSize=25&sort=createdAt.desc/);
  assert.match(source,/\/api\/healthz/);
  assert.match(source,/credentials:'same-origin'/);
  assert.match(source,/cache:'no-store'/);
  assert.match(source,/AbortController/);
  assert.match(source,/<OrderNextcrmDocuments key=\{selectedId\} orderId=\{selectedId\}\/>/);
  assert.match(source,/Acesso restrito/);
  assert.match(source,/status==='unavailable'/);
  assert.doesNotMatch(source,/<iframe/);
  assert.doesNotMatch(source,/nextcrm-gateway-staging|window\.open|document\.cookie/);
  assert.doesNotMatch(source,/POST|method:'POST'|PUT|DELETE/);
});

test('RC103: a 401/403 from a healthy web backend is an auth prompt, not a database outage',()=>{
  const source=readFileSync('app/IntegrationHub.tsx','utf8');
  assert.match(source,/listing\.status===401\|\|listing\.status===403/);
  assert.match(source,/setStatus\('restricted'\)/);
  assert.match(source,/status==='restricted'\?'Sessão necessária'/);
  assert.match(source,/status==='restricted'&&<div className="integration-message integration-restricted"/);
  assert.match(source,/O Field está operacional, mas a consulta exige uma sessão autorizada/);
  assert.match(source,/status==='unavailable'&&<div className="integration-message integration-error"/);
  assert.doesNotMatch(source,/status===403\s*\?\s*'Acesso negado/);
});
