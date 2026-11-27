import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as registerClient } from '../../app/api/clients/route';
import { POST as registerProposal } from '../../app/api/proposals/route';
import { POST as proposalAction } from '../../app/api/proposals/[id]/commands/route';
import { POST as registerContract } from '../../app/api/contracts/route';
import { POST as contractAction } from '../../app/api/contracts/[id]/commands/route';
import { POST as registerOrder } from '../../app/api/orders/route';
import { POST as orderAction } from '../../app/api/commands/route';
import { POST as registerExecution } from '../../app/api/orders/[id]/execution/route';
import { POST as registerMeasurement } from '../../app/api/orders/[id]/measurements/route';
import { POST as requestApproval } from '../../app/api/workflow/approvals/route';
import { POST as decideApproval } from '../../app/api/workflow/approvals/[id]/commands/route';
import { POST as registerAccount } from '../../app/api/accounting/accounts/route';
import { POST as configureRule } from '../../app/api/accounting/posting-rules/route';
import { POST as invoiceMeasurement } from '../../app/api/finance/billing/route';
import { POST as settleReceivable } from '../../app/api/finance/receivables/settlements/route';
import { POST as registerStatement } from '../../app/api/bank/statements/route';
import { POST as reconcileBank } from '../../app/api/bank/commands/route';
import { GET as bankDetails } from '../../app/api/bank/statements/[id]/route';
import { GET as ledger } from '../../app/api/accounting/ledger/route';
import { GET as closePreflight } from '../../app/api/finance/periods/preflight/route';
import { GET as listEnterpriseDossiers } from '../../app/api/enterprise/journeys/route';
import { GET as readEnterpriseDossier } from '../../app/api/enterprise/journeys/[id]/route';
import { GET as readOperationalCenter } from '../../app/api/enterprise/operations/route';
import { POST as closePeriod } from '../../app/api/finance/periods/close/route';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error('Fictitious end-to-end ERP test requires NODE_ENV=test and PostgreSQL.');
// A non-test Railway PostgreSQL is not safe for synthetic financial documents:
// enforce the exact throwaway databases provisioned by both GitHub CI workflows.
const parsedDatabase = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(parsedDatabase.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(parsedDatabase.pathname) ||
    !['cisne_test', 'cisne_ci'].includes(parsedDatabase.username))
  throw new Error('NO-GO: refuses all non-disposable, non-loopback PostgreSQL databases.');

const db = new Pool({ connectionString: databaseUrl, max: 3 });
after(async () => {
  // Accounting links are immutable by design: the isolated CI container is
  // discarded after the job, with all fictional facts and audit events.
  await closeDatabase();
  await db.end();
});

const owner = randomUUID();
const approver = randomUUID();
const outsider = randomUUID();
const clientId = randomUUID();
const proposalId = randomUUID();
const contractId = randomUUID();
const orderId = randomUUID();
const debitAccountId = randomUUID();
const revenueAccountId = randomUUID();
const bankAccountId = randomUUID();
const statementId = randomUUID();
const bankLineId = randomUUID();
const settlementKey = randomUUID();
const closeId = randomUUID();
const today = new Date().toISOString().slice(0, 10);
const firstDay = today.slice(0, 8) + '01';
const lastDay = new Date(Date.UTC(
  Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0,
)).toISOString().slice(0, 10);
const scaledAmount = 2_500_000; // R$ 250,0000 on CISNE's 1/10_000 unit.
const paths = (path: string) => ({ params: Promise.resolve({ id: path }) });
const req = (actor: string, path: string, payload?: unknown) =>
  setTestIdentity(new Request('http://localhost' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }), actor);
const record = async <T = Record<string, unknown>>(
  response: Response, step: string, expected: number,
): Promise<T> => {
  const result = await response.json() as T & { error?: string; code?: string };
  assert.equal(response.status, expected,
    step + ' HTTP ' + response.status + ' ' + JSON.stringify(result));
  console.log('ORDER_TO_CASH PASS: ' + step + ' HTTP ' + response.status);
  return result;
};

test('ERP order-to-cash: fictitious customer -> accepted proposal -> signed contract -> '
  + 'service execution -> approved measurement -> invoice -> AR -> receipt -> bank -> ledger -> close',
async () => {
  // 1. Fictional customer; no real tax ID, e-mail, customer, payment or bank.
  await record(await registerClient(req(owner, '/api/clients', {
    id: clientId, data: {
      legalName: 'Cliente FictÃ­cio de HomologaÃ§Ã£o CI',
      tradeName: 'SIMULACAO SEM VALOR COMERCIAL',
      document: null, email: null, phone: null,
    },
  })), '01 Cliente fictÃ­cio persistido', 201);

  // 2. Commercial quotation with full entity identity, version and prices.
  await record(await registerProposal(req(owner, '/api/proposals', {
    id: proposalId, clientId, clientVersion: 1,
    data: { title: 'Proposta fictÃ­cia de serviÃ§o CI',
      scope: 'Apenas prova transacional da cadeia ERP; nenhum serviÃ§o real',
      validUntil: '2099-12-31',
      lines: [{ description: 'ServiÃ§o fictÃ­cio', unit: 'un',
        quantity: '1', unitPrice: '250,00' }],
    },
  })), '02 Proposta comercial vinculada ao cliente', 201);
  await record(await proposalAction(req(owner, '/api/proposals/' + proposalId + '/commands',
    { key: randomUUID(), version: 1, command: 'issue' }), paths(proposalId)),
  '02a Proposta emitida', 200);
  await record(await proposalAction(req(owner, '/api/proposals/' + proposalId + '/commands',
    { key: randomUUID(), version: 2, command: 'accept',
      reference: 'ACEITE-FICTICIO-CI-SEM-ASSINATURA-REAL' }), paths(proposalId)),
  '02b Aceite declarativo fictÃ­cio', 200);

  // 3. Signed-evidence field is deliberately a labeled synthetic reference.
  await record(await registerContract(req(owner, '/api/contracts', {
    id: contractId, proposalId, proposalVersion: 3,
    purchaseOrderId: null, reference: 'CONTRATO-FICTICIO-CI',
    terms: { scope: 'ServiÃ§o fictÃ­cio de homologaÃ§Ã£o sem efeitos jurÃ­dicos',
      startsOn: '2026-01-01', endsOn: '2099-12-31' },
  })), '03 Contrato com origem na proposta aceita', 201);
  await record(await contractAction(req(owner, '/api/contracts/' + contractId + '/commands',
    { key: randomUUID(), version: 1, command: 'activate',
      signedReference: 'ASSINATURA-FICTICIA-CI-SEM-VALIDADE' }), paths(contractId)),
  '03a Contrato ativado com referÃªncia simulada', 200);

  // 4. Contract-bound service order, authentic status transitions.
  await record(await registerOrder(req(owner, '/api/orders', {
    id: orderId, title: 'OS FictÃ­cia - Auditoria Order to Cash',
    category: 'ServiÃ§os', description: 'ExecuÃ§Ã£o sintÃ©tica sem deslocamento',
    dueDate: null, clientId, clientVersion: 1,
    contractId, contractVersion: 2,
  })), '04 OS vinculada ao contrato e cliente', 201);
  await record(await orderAction(req(owner, '/api/commands', {
    id: orderId, version: 1, key: randomUUID(), command: 'authorize',
  })), '04a OS autorizada', 201);
  await record(await orderAction(req(owner, '/api/commands', {
    id: orderId, version: 2, key: randomUUID(), command: 'start',
  })), '04b OS iniciada', 201);

  // 5. Real Field Service endpoint creates a persisted execution fact.
  const execution = await record<{ resource: { id: string } }>(
    await registerExecution(req(owner, '/api/orders/' + orderId + '/execution', {
      command: 'report', key: randomUUID(), version: 3,
      resourceKind: 'labor', description: 'Apontamento fictÃ­cio da equipe CI',
      quantituç®-¢G§²ÚîÆ­yÖÆR‡&W†÷væW"À¢rö’öf–ææ6R÷&V6V—f&ÆW2÷6WGFÆVÖVçG2rÂ°¢&V6V—f&ÆT–C¢&–ÆÆ–ærç&W6÷W&6Rç&V6V—f&ÆT–BÂÖ÷VçC¢7G&–ær‡66ÆVDÖ÷VçB’À¢VffV7F—fTFFS¢FöF’Â&VfW&Væ6S¢u$T4T$”ÔTåDòÔd”5D”4”òÔ4’rÀ¢6öÖÖæD¶W“¢6WGFÆVÖVçD¶W’À¢Ò’’Âs‚L:×GVÆò&V6V&–FòR6ÆFò¦W&FòrÂ#“°¢76W'BæWVÂ‡&V6V—Bç&W6÷W&6Ræ&Ææ6RÂsr“°¢76W'BæWVÂ‡&V6V—Bç&W6÷W&6Ræ–BÂ6WGFÆVÖVçD¶W’“°¢76W'BæWVÂ‡&V6V—Bç&W6÷W&6Ræ66÷VçF–ærç7FGW2ÂvWFõ÷÷7FVBr“°¢76W'Bæö²‡&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B“°¢6öç7B&WÆ•&V6V—BÒv—B&V6÷&CÇ²&W6÷W&6S¢²66÷VçF–æs¢²¦÷W&æÄ–C¢7G&–ærÒÒÓâ€¢v—B6WGFÆU&V6V—f&ÆR‡&W†÷væW"Ârö’öf–ææ6R÷&V6V—f&ÆW2÷6WGFÆVÖVçG2rÂ°¢&V6V—f&ÆT–C¢&–ÆÆ–ærç&W6÷W&6Rç&V6V—f&ÆT–BÂÖ÷VçC¢7G&–ær‡66ÆVDÖ÷VçB’À¢VffV7F—fTFFS¢FöF’Â&VfW&Væ6S¢u$T4T$”ÔTåDòÔd”5D”4”òÔ4’rÀ¢6öÖÖæD¶W“¢6WGFÆVÖVçD¶W’À¢Ò’’Âs†&—†–FV×÷FVçFR6VÒFœ:&–òGWÆ–6FòrÂ#À¢“°¢76W'BæWVÂ‡&WÆ•&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–BÂ&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B“° ¢òò’âÖçVÆÇ’–×÷'FVB¦f'&–6FVB¢&æ²7FFVÖVçBÂæ÷B&æ¶–ær6öææV7F÷"à¢v—B&V6÷&B†v—B&Vv—7FW%7FFVÖVçB‡&W†÷væW"Ârö’ö&æ²÷7FFVÖVçG2rÂ°¢–C¢7FFVÖVçD–BÂ66÷VçE&VfW&Væ6S¢t$ä4òÔd”5D”4”òÕ4TÒÔ4ôåDÕ$TÂrÀ¢6÷W&6U&VfW&Væ6S¢tU…E$DòÔd”5D”4”òÔ4’rÂW&–öE7F'C¢f—'7DF’À¢W&–öDVæC¢Æ7DF’Â÷Væ–æt&Ææ6S¢srÂ6Æ÷6–æt&Ææ6S¢s#SÃrÀ¢Æ–æW3¢·°¢–C¢&æ´Æ–æT–BÂW‡FW&æÄ¶W“¢tÔõd”ÔTåDòÔ4’Õ4TÒÕE$å4dU$Tä4”rÀ¢&öö¶VDFFS¢FöF’ÂÖ÷VçC¢s#SÃrÀ¢FW67&—F–öã¢t7,:–F—Fò&æ<:&–òf–7L:Ö6–ò&6öæ6–Æ–:|:6ò4’rÀ¢ÕÒÀ¢Ò’’Âs’W‡G&Fò&æ<:&–ò6–×VÆFò–×÷'FFòrÂ#“°¢v—B&V6÷&B†v—B&V6öæ6–ÆT&æ²‡&W†÷væW"Ârö’ö&æ²ö6öÖÖæG2rÂ°¢¶W“¢&æFöÕUT”B‚’Â7FFVÖVçD–BÂÆ–æT–C¢&æ´Æ–æT–BÀ¢6öÖÖæC¢vÖF6‚rÂfW'6–öã¢ÂF&vWEG—S¢w&V6V—BrÀ¢F&vWD–C¢6WGFÆVÖVçD¶W’À¢Ò’’Âs&V6V&–ÖVçFò76ö6–Fò:Æ–æ†&æ<:&–rÂ#“°¢6öç7B&æ²Òv—B&V6÷&CÇ²7VÖÖ'“¢°¢F÷FÃ¢çVÖ&W#²ÖF6†VC¢çVÖ&W#²VæÖF6†VC¢çVÖ&W#°¢×Óâ†v—B&æ´FWF–Ç2‡&W†÷væW"À¢rö’ö&æ²÷7FFVÖVçG2òr²7FFVÖVçD–B²s÷7FFSÖÖF6†VBr’ÂF‡2‡7FFVÖVçD–B’’À¢s6öæ6–Æ–:|:6ò&æ<:&–6öç7VÇFFrÂ#“°¢76W'BæFVWWVÂ†&æ²ç7VÖÖ'’Â²F÷FÃ¢ÂÖF6†VC¢ÂVæÖF6†VC¢Ò“°¢76W'BæWVÂ‚†v—B&æ´FWF–Ç2‡&W†÷WG6–FW"À¢rö’ö&æ²÷7FFVÖVçG2òr²7FFVÖVçD–B’ÂF‡2‡7FFVÖVçD–B’’’ç7FGW2ÂCB“° ¢òòâ&÷F‚6÷W&6R¦÷W&æÇ2×W7BV"–âF†R&VÂ÷væW"×66÷VBÆVFvW'2à¢6öç7B76WDÆVFvW"Òv—B&V6÷&CÇ²—FV×3¢'&“Ç²¦÷W&æÄ–C¢7G&–ærÓã°¢F÷FÇ3¢²FV&—E66ÆVC¢7G&–æs²7&VF—E66ÆVC¢7G&–ærÒÓâ€¢v—BÆVFvW"‡&W†÷væW"Ârö’ö66÷VçF–æröÆVFvW#ö66÷VçD–CÒr²FV&—D66÷VçD–B’’À¢s&¬:6ò6öçL:&–ÂFRF—fò&V6V&W"rÂ#À¢“°¢6öç7B&WfVçVTÆVFvW"Òv—B&V6÷&CÇ²—FV×3¢'&“Ç²¦÷W&æÄ–C¢7G&–ærÓã°¢F÷FÇ3¢²FV&—E66ÆVC¢7G&–æs²7&VF—E66ÆVC¢7G&–ærÒÓâ€¢v—BÆVFvW"‡&W†÷væW"Ârö’ö66÷VçF–æröÆVFvW#ö66÷VçD–CÒr²&WfVçVT66÷VçD–B’’À¢s&¬:6ò6öçL:&–ÂFR&V6V—FrÂ#À¢“°¢76W'Bæö²†76WDÆVFvW"æ—FV×2ç6öÖR†—FVÒÓâ—FVÒæ¦÷W&æÄ–BÓÓÒ&–ÆÆ–ærç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B’“°¢76W'Bæö²†76WDÆVFvW"æ—FV×2ç6öÖR†—FVÒÓâ—FVÒæ¦÷W&æÄ–BÓÓÒ&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B’“°¢76W'BæWVÂ†76WDÆVFvW"çF÷FÇ2æFV&—E66ÆVBÂ7G&–ær‡66ÆVDÖ÷VçB’“°¢76W'BæWVÂ†76WDÆVFvW"çF÷FÇ2æ7&VF—E66ÆVBÂ7G&–ær‡66ÆVDÖ÷VçB’“°¢76W'BæWVÂ‡&WfVçVTÆVFvW"çF÷FÇ2æ7&VF—E66ÆVBÂ7G&–ær‡66ÆVDÖ÷VçB’“°¢6öç7B&æ´ÆVFvW"Òv—B&V6÷&CÇ²—FV×3¢'&“Ç²¦÷W&æÄ–C¢7G&–ærÓã°¢F÷FÇ3¢²FV&—E66ÆVC¢7G&–æs²7&VF—E66ÆVC¢7G&–ærÒÓâ€¢v—BÆVFvW"‡&W†÷væW"Ârö’ö66÷VçF–æröÆVFvW#ö66÷VçD–CÒr²&æ´66÷VçD–B’’À¢s"&¬:6ò&æ<:&–òFV&—FFòVÆ&—†f–7L:Ö6–rÂ#À¢“°¢76W'Bæö²†&æ´ÆVFvW"æ—FV×2ç6öÖR†—FVÒÓâ—FVÒæ¦÷W&æÄ–BÓÓÒ&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B’“°¢76W'BæWVÂ†&æ´ÆVFvW"çF÷FÇ2æFV&—E66ÆVBÂ7G&–ær‡66ÆVDÖ÷VçB’“°¢76W'BæWVÂ†&æ´ÆVFvW"çF÷FÇ2æ7&VF—E66ÆVBÂsr“°¢6öç7BW†—7F–æt¦÷W&æÇ2Òv—BF"çVW'’€¢u4TÄT5B4õTåB‚¢“£¦–çB26÷VçBe$ôÒ¦÷W&æÅöVçG&–W2t„U$R7F÷%ö–CÒCrÂ¶÷væW%Ò“°¢76W'BæWVÂ†W†—7F–æt¦÷W&æÇ2ç&÷w5³Òæ6÷VçBÂ"À¢tfGW&ÖVçFòR&—†vW&ÒFœ:&–÷2F—7F–çF÷2Â6VÒGWÆ–6:|:6òæò&WÆ’r“° ¢òò"âfW&–g’&÷F‚¦÷W&æÇ2æB66‚&V6öæ6–Æ–F–öâ&Vf÷&RW&–öB6Æ÷6Rà¢6öç7B&Wf–WuF‚Òrö’öf–ææ6R÷W&–öG2÷&VfÆ–v‡C÷W&–öE7F'CÒp¢²f—'7DF’²rgW&–öDVæCÒr²Æ7DF“°¢6öç7B&Wf–WrÒv—B&V6÷&CÇ²6ä6Æ÷6S¢&ööÆVã²&Æö6¶–æt–çfö–6W3¢çVÖ&W#°¢–çfÆ–D66„Æ–æ·3¢çVÖ&W#²Vç÷7FVD66„WfVçG3¢çVÖ&W#°¢F–W#&VF–æW73¢²&VG“¢&ööÆVã²7FGW3¢w&VG’rÂv&Æö6¶VBs°¢&Æö6¶W'3¢'&“Ç²6öFS¢7G&–æs²6÷VçC¢çVÖ&W"ÓâÒÓâ€¢v—B6Æ÷6U&VfÆ–v‡B‡&W†÷væW"Â&Wf–WuF‚’’À¢s",:’ÖfV6†ÖVçFò6öÒ&V6öæ†V6–ÖVçFò6öçL:&–ÂfW&–f–6FòrÂ#À¢“°¢76W'BæWVÂ‡&Wf–Wræ6ä6Æ÷6RÂG'VR“°¢76W'BæWVÂ‡&Wf–Wræ&Æö6¶–æt–çfö–6W2Â“°¢76W'BæWVÂ‡&Wf–Wræ–çfÆ–D66„Æ–æ·2Â“°¢76W'BæWVÂ‡&Wf–WrçVç÷7FVD66„WfVçG2Â“°¢76W'BæFVWWVÂ‡&Wf–WrçF–W#&VF–æW72Â²&VG“¢G'VRÂ7FGW3¢w&VG’rÂ&Æö6¶W'3¢µÒÒ“°¢v—B&V6÷&B†v—B6Æ÷6UW&–öB‡&W†÷væW"Ârö’öf–ææ6R÷W&–öG2ö6Æ÷6RrÂ°¢–C¢6Æ÷6T–BÂW&–öE7F'C¢f—'7DF’ÂW&–öDVæC¢Æ7DF’À¢&VfW&Væ6S¢tdT4„ÔTåDòÕDU5DRÔd”5D”4”òÔ4’rÀ¢Ò’’Âs&W,:ÖöFòf–ææ6V—&òfV6†FòrÂ#“° ¢òòF—&V7B&VÆF–öæÂWf–FVæ6S¢V6‚7FvR&VfW'2FòF†R6ÖRW'6—7FVB6†–âà¢6öç7B6†–âÒv—BF"çVW'’€¢u4TÄT5B2æ–B26Æ–VçEö–BÂæ–B2&÷÷6Åö–BÂ7Bæ–B26öçG&7Eö–BÂr°¢vòæ–B2÷&FW%ö–BÂW‚æ–B2W†V7WF–öåö–BÂÒæ–B2ÖV7W&VÖVçEö–BÂr°¢v’æ–B2–çfö–6Uö–BÂ"æ–B2&V6V—f&ÆUö–BÂ7Bæ–B26WGFÆVÖVçEö–BÂr°¢v"æ–B27FFVÖVçEö–BÂ¦Âæ–B2¦÷W&æÅö–BÂ6¢æ–B2&V6V—Eö¦÷W&æÅö–BÂf2æ–B26Æ÷6Uö–BÂr°¢v’æÖ÷VçB2Ö÷VçBÂ7BæÖ÷VçB2&V6V—fVEöÖ÷VçBÂÂæÖ÷VçB2Æ–æ¶VEöÖ÷VçBÂr°¢v¦ÂæVffV7F—fUöFFR2–çfö–6Uö¦÷W&æÅöFFRÂ6¢æVffV7F—fUöFFR2&V6V—Eö¦÷W&æÅöFFRÂr°¢w7BæVffV7F—fUöFFR2&V6V—EöFFRÂf2çW&–öE÷7F'BÂf2çW&–öEöVæBr°¢te$ôÒ6Æ–VçG22r°¢t¤ô”â&÷÷6Ç2ôâæ6Æ–VçEö–CÖ2æ–BäBæ÷væW%ö–CÖ2æ÷væW%ö–Br°¢t¤ô”â6öçG&7G27Bôâ7Bç&÷÷6Åö–C×æ–BäB7Bæ6Æ–VçEö–CÖ2æ–Br°¢t¤ô”â6W'f–6Uö÷&FW'2òôâòæ6öçG&7Eö–CÖ7Bæ–BäBòæ6Æ–VçEö–CÖ2æ–Br°¢t¤ô”âW†V7WF–öåöVçG&–W2W‚ôâW‚æ÷&FW%ö–CÖòæ–Br°¢t¤ô”âÖV7W&VÖVçG2ÒôâÒæW†V7WF–öåöVçG'•ö–CÖW‚æ–BäBÒæ÷&FW%ö–CÖòæ–Br°¢t¤ô”â–çfö–6W2’ôâ’æÖV7W&VÖVçEö–CÖÒæ–BäB’æ÷&FW%ö–CÖòæ–Br°¢t¤ô”â&V6V—f&ÆW2"ôâ"æ–çfö–6Uö–CÖ’æ–Br°¢$¤ô”â&V6V—f&ÆU÷6WGFÆVÖVçG27Bôâ7Bç&V6V—f&ÆUö–C×"æ–BäB7Bæ¶–æCÒw&V6V—Br"°¢$¤ô”â&æµ÷&V6öæ6–Æ–F–öåöWfVçG2'"ôâ'"ç&V6V—Eö–C×7Bæ–BäB'"æ¶–æCÒvÖF6‚r"°¢t¤ô”â&æµ÷7FFVÖVçEöÆ–æW2&Âôâ&Âæ–CÖ'"æÆ–æUö–Br°¢t¤ô”â&æµ÷7FFVÖVçG2"ôâ"æ–CÖ&Âç7FFVÖVçEö–BäB"æ7F÷%ö–CÖòæ÷væW%ö–Br°¢t¤ô”â66÷VçF–æuö–çfö–6UöÆ–æ·2ÂôâÂæ–çfö–6Uö–CÖ’æ–Br°¢t¤ô”â¦÷W&æÅöVçG&–W2¦Âôâ¦Âæ–CÖÂæ¦÷W&æÅö–BäB¦Âæ7F÷%ö–CÖòæ÷væW%ö–Br°¢$¤ô”â66÷VçF–æu÷6WGFÆVÖVçEöÆ–æ·26Âôâ6Âç6WGFÆVÖVçEö–C×7Bæ–BäB6Âæ7F÷%ö–CÖòæ÷væW%ö–BäB6Âæ¶–æCÒw&V6V—Br"°¢$¤ô”â¦÷W&æÅöVçG&–W26¢ôâ6¢æ–C×6Âæ¦÷W&æÅö–BäB6¢æ7F÷%ö–CÖòæ÷væW%ö–BäB6¢ç7FGW3Òw÷7FVBr"°¢$¤ô”âf–ææ6U÷W&–öEö6Æ÷6W2f2ôâf2æ7F÷%ö–CÖòæ÷væW%ö–BäBf2ç7FGW3Òv6Æ÷6VBr"°¢täB¦ÂæVffV7F—fUöFFR$UEtTTâf2çW&–öE÷7F'BäBf2çW&–öEöVæBr°¢ut„U$R2æ–CÒCäBòæ÷væW%ö–CÒC"rÂ¶6Æ–VçD–BÂ÷væW%ÒÀ¢“°¢76W'BæWVÂ†6†–âç&÷w2æÆVæwF‚ÂÂtVæB×FòÖVæBf÷&V–vâÖ¶W’ö÷&–v–â6†–â×W7B&RVæ—VRâr“°¢6öç7BÆ–æ¶VBÒ6†–âç&÷w5³Ó°¢76W'BæFVWWVÂ‡°¢6Æ–VçC¢Æ–æ¶VBæ6Æ–VçEö–BÂ&÷÷6Ã¢Æ–æ¶VBç&÷÷6Åö–BÀ¢6öçG&7C¢Æ–æ¶VBæ6öçG&7Eö–BÂ÷&FW#¢Æ–æ¶VBæ÷&FW%ö–BÀ¢W†V7WF–öã¢Æ–æ¶VBæW†V7WF–öåö–BÂÖV7W&VÖVçC¢Æ–æ¶VBæÖV7W&VÖVçEö–BÀ¢–çfö–6S¢Æ–æ¶VBæ–çfö–6Uö–BÂ&V6V—f&ÆS¢Æ–æ¶VBç&V6V—f&ÆUö–BÀ¢6WGFÆVÖVçC¢Æ–æ¶VBç6WGFÆVÖVçEö–BÂ&æ³¢Æ–æ¶VBç7FFVÖVçEö–BÀ¢¦÷W&æÃ¢Æ–æ¶VBæ¦÷W&æÅö–BÂ&V6V—D¦÷W&æÃ¢Æ–æ¶VBç&V6V—Eö¦÷W&æÅö–BÀ¢W&–öD6Æ÷6S¢Æ–æ¶VBæ6Æ÷6Uö–BÀ¢–çfö–6T¦÷W&æÄFFS¢7G&–ær†Æ–æ¶VBæ–çfö–6Uö¦÷W&æÅöFFR’ç6Æ–6RƒÂ’À¢&V6V—D¦÷W&æÄFFS¢7G&–ær†Æ–æ¶VBç&V6V—Eö¦÷W&æÅöFFR’ç6Æ–6RƒÂ’À¢&V6V—DFFS¢7G&–ær†Æ–æ¶VBç&V6V—EöFFR’ç6Æ–6RƒÂ’À¢W&–öE7F'C¢Æ–æ¶VBçW&–öE÷7F'BÀ¢W&–öDVæC¢Æ–æ¶VBçW&–öEöVæBÀ¢–çfö–6TÖ÷VçC¢çVÖ&W"†Æ–æ¶VBæÖ÷VçB’À¢6WGFÆVDÖ÷VçC¢çVÖ&W"†Æ–æ¶VBç&V6V—fVEöÖ÷VçB’À¢¦÷W&æÄÖ÷VçC¢çVÖ&W"†Æ–æ¶VBæÆ–æ¶VEöÖ÷VçB’À¢ÒÂ°¢6Æ–VçC¢6Æ–VçD–BÂ&÷÷6Ã¢&÷÷6Ä–BÂ6öçG&7C¢6öçG&7D–BÀ¢÷&FW#¢÷&FW$–BÂW†V7WF–öã¢W†V7WF–öâç&W6÷W&6Ræ–BÀ¢ÖV7W&VÖVçC¢ÖV7W&VÖVçBç&W6÷W&6Ræ–BÂ–çfö–6S¢&–ÆÆ–ærç&W6÷W&6Ræ–çfö–6T–BÀ¢&V6V—f&ÆS¢&–ÆÆ–ærç&W6÷W&6Rç&V6V—f&ÆT–BÂ6WGFÆVÖVçC¢6WGFÆVÖVçD¶W’À¢&æ³¢7FFVÖVçD–BÂ¦÷W&æÃ¢&–ÆÆ–ærç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–BÀ¢&V6V—D¦÷W&æÃ¢&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–BÀ¢W&–öD6Æ÷6S¢6Æ÷6T–BÀ¢–çfö–6T¦÷W&æÄFFS¢FöF’À¢&V6V—D¦÷W&æÄFFS¢FöF’À¢&V6V—DFFS¢FöF’À¢W&–öE7F'C¢f—'7DF’À¢W&–öDVæC¢Æ7DF’À¢–çfö–6TÖ÷VçC¢66ÆVDÖ÷VçBÂ6WGFÆVDÖ÷VçC¢66ÆVDÖ÷VçBÀ¢¦÷W&æÄÖ÷VçC¢66ÆVDÖ÷VçBÀ¢Ò“° ¢òò2âæWrVçFW'&—6RF÷76–W"—2æ÷BFV6÷&F—fS¢—B×W7B&V6öç7G'V7BF†P¢òò–FVçF–6ÂVF—FVB÷7Fw&U5Âw&‚æB7F’–æ66W76–&ÆRFò÷WG6–FW'2à¢6öç7BF÷76–W%F‚Òrö’öVçFW'&—6Rö¦÷W&æW—2òr²÷&FW$–C°¢6öç7BF÷76–W"Òv—B&V6÷&CÇ°¢÷&FW#¢²–C¢7G&–æs²F—FÆS¢7G&–æs²7FGW3¢7G&–ærÓ°¢7FvW3¢'&“Ç²¶W“¢7G&–æs²7FFS¢7G&–æs²—FV×3¢'&“Ç²–C¢7G&–ærÓâÓã°¢f–ææ6–Ç3¢²&–ÆÆVE66ÆVC¢7G&–æs²6WGFÆVE66ÆVC¢7G&–æs²÷WG7FæF–æu66ÆVC¢7G&–ærÓ°¢&÷fVææ6S¢²÷væW%66÷VC¢&ööÆVã²6öç6—7FVæ7“¢7G&–ærÓ°¢Óâ†v—B&VDVçFW'&—6TF÷76–W"‡&W†÷væW"ÆF÷76–W%F‚’ÇF‡2†÷&FW$–B’’À¢s2F÷76œ:¢V×&W6&–ÂG&ç7fW'6Âæò÷7Fw&U5Â&VÂrÃ#“°¢76W'BæWVÂ†F÷76–W"æ÷&FW"æ–BÆ÷&FW$–B“°¢76W'BæWVÂ†F÷76–W"æ÷&FW"ç7FGW2Âv6ö×ÆWFVBr“°¢76W'BæWVÂ†F÷76–W"ç&÷fVææ6Ræ÷væW%66÷VBÇG'VR“°¢76W'BæWVÂ†F÷76–W"ç&÷fVææ6Ræ6öç6—7FVæ7’Âw&WVF&ÆU÷&VBr“°¢76W'BæWVÂ†F÷76–W"æf–ææ6–Ç2æ&–ÆÆVE66ÆVBÅ7G&–ær‡66ÆVDÖ÷VçB’“°¢76W'BæWVÂ†F÷76–W"æf–ææ6–Ç2ç6WGFÆVE66ÆVBÅ7G&–ær‡66ÆVDÖ÷VçB’“°¢76W'BæWVÂ†F÷76–W"æf–ææ6–Ç2æ÷WG7FæF–æu66ÆVBÂsr“°¢6öç7BFö7VÖVçG2ÒæWrÖ†F÷76–W"ç7FvW2æÖ‡7FvSÓå·7FvRæ¶W’Ç7FvUÒ’“°¢6öç7BW†7DFö7VÖVçG2Ò°¢²v6Æ–VçBrÆ6Æ–VçD–EÒÅ²w&÷÷6ÂrÇ&÷÷6Ä–EÒÅ²v6öçG&7BrÆ6öçG&7D–EÒÀ¢²v÷&FW"rÆ÷&FW$–EÒÅ²vW†V7WF–öârÆW†V7WF–öâç&W6÷W&6Ræ–EÒÅ²vÖV7W&VÖVçBrÆÖV7W&VÖVçBç&W6÷W&6Ræ–EÒÀ¢²v&–ÆÆ–ærrÆ&–ÆÆ–ærç&W6÷W&6Ræ–çfö–6T–EÒÅ²w&V6V—f&ÆRrÆ&–ÆÆ–ærç&W6÷W&6Rç&V6V—f&ÆT–EÒÀ¢²w&V6V—BrÇ6WGFÆVÖVçD¶W•ÒÅ²v66÷VçF–ærrÆ&–ÆÆ–ærç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–EÒÀ¢²v6Æ÷6RrÆ6Æ÷6T–EÒÀ¢Ò26öç7C°¢f÷"†6öç7B·7FvRÆ–EÒöbW†7DFö7VÖVçG2—°¢6öç7B—FVÓÖFö7VÖVçG2ævWB‡7FvR“°¢76W'BæWVÂ†—FVÓòç7FFRÂvÆ–æ¶VBrÇ7FvR²rÖ—76–ærg&öÒW'6—7FVB÷væW"×66÷VBF÷76–W"r“°¢76W'Bæö²†—FVÓòæ—FV×2ç6öÖR†Wf–FVæ6SÓæWf–FVæ6Ræ–CÓÓÖ–B’Ç7FvR²r”Bv2æ÷BF†RW†7B7F÷&VBFö7VÖVçBr“°¢Ğ¢76W'Bæö²†Fö7VÖVçG2ævWB‚v66÷VçF–ærr“òæ—FV×2ç6öÖR‡&÷sÓç&÷ræ–CÓÓ×&V6V—Bç&W6÷W&6Ræ66÷VçF–æræ¦÷W&æÄ–B’À¢v&÷F‚f–ææ6–Â¦÷W&æÇ2×W7B&R–æFWVæFVçFÇ’Æ–æ¶VBr“°¢76W'BæWVÂ†Fö7VÖVçG2ævWB‚v&æ²r“òç7FFRÂvÆ–æ¶VBr“°¢76W'BæWVÂ†Fö7VÖVçG2ævWB‚v7&Òr“òç7FFRÂvæ÷EöÆ–æ¶VBrÀ¢væòf–7F—F–÷W25$Ò÷÷'GVæ—G’×W7B&RÖçVf7GW&VBr“°¢76W'BæWVÂ†Fö7VÖVçG2ævWB‚wW&6†6T÷&FW"r“òç7FFRÂvæ÷EöÆ–æ¶VBrÀ¢væòf–7F—F–÷W27W7FöÖW"ò×W7B&RÖçVf7GW&VBr“° ¢6öç7B÷væW$Æ—7BÒv—B&V6÷&CÇ°¢—FV×3¢'&“Ç²–C¢7G&–æs²&–ÆÆVE66ÆVC¢7G&–æs²6WGFÆVE66ÆVC¢7G&–ærÓã°¢vT–æfó¢²F÷FÃ¢çVÖ&W#²†4Ö÷&S¢&ööÆVâÓ°¢Óâ†v—BÆ—7DVçFW'&—6TF÷76–W'2‡&W†÷væW"À¢rö’öVçFW'&—6Rö¦÷W&æW—3÷7FGW3Ö6ö×ÆWFVBgÔVF—F÷&–gvU6—¦SÓ#r’’À¢s6f–Æv–æFFR&ö6W76÷26öÒfÆ÷&W2W'6—7F–F÷2rÃ#“°¢76W'Bæö²†÷væW$Æ—7Bæ—FV×2ç6öÖR†—FVÓÓæ—FVÒæ–CÓÓÖ÷&FW$–@¢bb—FVÒæ&–ÆÆVE66ÆVCÓÓÕ7G&–ær‡66ÆVDÖ÷VçB¢bb—FVÒç6WGFÆVE66ÆVCÓÓÕ7G&–ær‡66ÆVDÖ÷VçB’’“°¢6öç7B'”÷&FW$çVÖ&W"Òv—B&V6÷&CÇ¶—FV×3¤'&“Ç¶–C§7G&–æwÓçÓâ€¢v—BÆ—7DVçFW'&—6TF÷76–W'2‡&W†÷væW"Ârö’öVçFW'&—6Rö¦÷W&æW—3÷Òr¶÷&FW$–Bç6Æ–6RƒÃ‚’’’À¢s62'W66V×&W6&–ÂVÆò–FVçF–f–6F÷"W'6—7F–FòFõ2rÃ#“°¢76W'Bæö²†'”÷&FW$çVÖ&W"æ—FV×2ç6öÖR†—FVÓÓæ—FVÒæ–CÓÓÖ÷&FW$–B’“°¢76W'BæWVÂ‚†v—B&VDVçFW'&—6TF÷76–W"‡&W†÷WG6–FW"ÆF÷76–W%F‚’ÇF‡2†÷&FW$–B’’’ç7FGW2ÃCBÀ¢v÷WG6–FW"×W7BæWfW"&V6V—fRF÷76–W"Fö7VÖVçG2r“°¢6öç7B÷WG6–FW$Æ—7BÒv—B&V6÷&CÇ²—FV×3¢'&“Ç²–C¢7G&–ærÓâÓâ€¢v—BÆ—7DVçFW'&—6TF÷76–W'2‡&W†÷WG6–FW"Ârö’öVçFW'&—6Rö¦÷W&æW—2r’’À¢s6"W7\:&–òW‡FW&æò6VÒ6W76ò:6FV–rÃ#“°¢76W'Bæö²‚÷WG6–FW$Æ—7Bæ—FV×2ç6öÖR†—FVÓÓæ—FVÒæ–CÓÓÖ÷&FW$–B’“°¢76W'BæWVÂ‚†v—B&VDVçFW'&—6TF÷76–W"‡&W†÷væW"Ârö’öVçFW'&—6Rö¦÷W&æW—2òr·&æFöÕUT”B‚’’À¢F‡2‡&æFöÕUT”B‚’’’’ç7FGW2ÃCB“°¢76W'BæWVÂ‚†v—B&VDVçFW'&—6TF÷76–W"‡&W†÷væW"Ârö’öVçFW'&—6Rö¦÷W&æW—2ö–çfÆ–Br’À¢F‡2‚v–çfÆ–Br’’’ç7FGW2ÃC“°¢76W'BæWVÂ‚†v—BÆ—7DVçFW'&—6TF÷76–W'2‡&W†÷væW"Ârö’öVçFW'&—6Rö¦÷W&æW—3÷vU6—¦SÓ#r’’’ç7FGW2ÃCÀ¢wVæ&÷VæFVBVW'’×W7B&R&V¦V7FVBÂæWfW"6W6RgVÆÂ×F&ÆRW‡G&7F–öâr“° ¢òòBâ6öçG&öÂF÷vW"×W7B&VBF†R6ÖRW'6—7FVB÷væW"×66÷VB÷&FW"À¢òòæWfW"G&VF–æræöç–Ö÷W2öÆVv7’&V6÷&G22WF†÷&—¦VBFö7VÖVçG2à¢6öç7B6öçG&öÅF÷vW#Öv—B&V6÷&CÇ°¢—FV×3¤'&“Ç¶–C§7G&–æs·7FGW3§7G&–æs¶Wf–FVæ6S§¶ÖV7W&VÖVçG3¦çVÖ&W#¶–çfö–6W3¦çVÖ&W'×Óã°¢7VÖÖ'“§·F÷FÃ¦çVÖ&W#·VæÖV7W&VC¦çVÖ&W'Ó°¢vT–æfó§·F÷FÃ¦çVÖ&W#¶†4Ö÷&S¦&ööÆVçÓ°¢6÷W&6S§7G&–æs°¢Óâ†v—B&VD÷W&F–öæÄ6VçFW"‡&W†÷væW"À¢rö’öVçFW'&—6Rö÷W&F–öç3÷VWVSÖÆÂgÒr¶÷&FW$–Bç6Æ–6RƒÃ‚’’’À¢sB6VçG&òFR6öÖæFò6öÒFö7VÖVçF÷2W'6—7F–F÷2rÃ#“°¢76W'BæWVÂ†6öçG&öÅF÷vW"ç6÷W&6RÂw÷7Fw&W5ö÷væW%÷66÷VEö÷W&F–öç2r“°¢76W'BæWVÂ†6öçG&öÅF÷vW"çvT–æfòçF÷FÂÃ“°¢76W'Bæö²†6öçG&öÅF÷vW"æ—FV×2ç6öÖR†—FVÓÓæ—FVÒæ–CÓÓÖ÷&FW$–Bbb—FVÒç7FGW3ÓÓÒv6ö×ÆWFVBp¢bb—FVÒæWf–FVæ6RæÖV7W&VÖVçG3ÓÓÓbb—FVÒæWf–FVæ6Ræ–çfö–6W3ÓÓÓ’“°¢76W'BæWVÂ†6öçG&öÅF÷vW"ç7VÖÖ'’çVæÖV7W&VBÃ“°¢6öç7BVæWF†÷&—¦VEF÷vW#Öv—B&V6÷&CÇ°¢—FV×3¤'&“Ç¶–C§7G&–æwÓã·7VÖÖ'“§·F÷FÃ¦çVÖ&W'Ó°¢Óâ†v—B&VD÷W&F–öæÄ6VçFW"‡&W†÷WG6–FW"À¢rö’öVçFW'&—6Rö÷W&F–öç3÷VWVSÖÆÂr’’À¢sF6VçG&ò÷W&6–öæÂì:6òW‡;VRõ2FR÷WG&òW7\:&–òrÃ#“°¢76W'BæWVÂ‡VæWF†÷&—¦VEF÷vW"ç7VÖÖ'’çF÷FÂÃ“°¢76W'BæFVWWVÂ‡VæWF†÷&—¦VEF÷vW"æ—FV×2ÅµÒ“°¢76W'BæWVÂ‚†v—B&VD÷W&F–öæÄ6VçFW"‡&W†÷væW"À¢rö’öVçFW'&—6Rö÷W&F–öç3÷vU6—¦SÓ““’r’’’ç7FGW2ÃC“°¢76W'BæWVÂ‚†v—B&VD÷W&F–öæÄ6VçFW"‡&W†÷væW"À¢rö’öVçFW'&—6Rö÷W&F–öç3÷VWVSÖ–çfÆ–Br’’’ç7FGW2ÃC“° ¢6öç6öÆRæÆör„¥4ôâç7G&–æv–g’‡°¢WfVçC¢t4•4äUôõ$DU%õDõô44…ôd”5D•D”õU5ô4’rÀ¢7FFS¢t4„”åôÄ”äµ5õdU$”d”TEõt•D…ô44…ôÄTDtU"rÀ¢&VÄ7W7FöÖW%&V6÷&G47&VFVC¢Â&VÄ&æ´÷W&F–öç3¢À¢f–7F–öæÄÖ÷VçE66ÆVC¢7G&–ær‡66ÆVDÖ÷VçB’À¢Æ–æ¶VE7FvW3¢"À¢&æ´ÖF6†W3¢&æ²ç7VÖÖ'’æÖF6†VBÀ¢¦÷W&æÄ6÷VçC¢W†—7F–æt¦÷W&æÇ2ç&÷w5³Òæ6÷VçBÀ¢6fVC¢u7–çF†WF–2&æ²ÖF6†–æræBW‡Æ–6—B66÷VçF–ær'VÆW2öæÇ“²æò&VÂG&ç6fW"÷"f—66ÂG&ç6Ö—76–öâârÀ¢Ò’“°§Ò“° 