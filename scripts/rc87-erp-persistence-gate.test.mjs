import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessRC87ErpPersistence } from './rc87-erp-persistence-gate.mjs';

const volumeId = 'f1271704-a171-4dc0-8bc1-41aa20d5cb39';
const dbId = '7202c8eb-4a9e-4cb9-9329-0988e5033263';
const dbName = 'cisne-rc85-ephemeral-pg';
const mountPath = '/var/lib/postgresql';

function isolatedFixture() {
  return {
    project: { id: '0835d357-6037-42e6-a534-6456422e1cf3', name: 'genuine-renewal' },
    environment: {
      id: 'c241a855-68b7-4d75-a722-b6a42c8581e9',
      name: 'staging', isEphemeral: false,
    },
    staged: null,
    services: [
      {
        id: dbId, name: dbName, state: 'live',
        source: { image: 'postgres:18', repo: null, branch: null },
        regions: ['us-west2'],
        latestDeployment: { status: 'SUCCESS' },
        volumeMounts: [{ volumeId, volumeName: 'rc87-erp-pg18-data', mountPath }],
      },
      {
        id: 'fed95ca7-f373-4e6a-983f-2f591f26672e',
        name: 'cisne-rc85-ephemeral-erp',
        volumeMounts: [],
      },
    ],
    volumes: [{
      id: volumeId, name: 'rc87-erp-pg18-data', state: 'live',
      region: 'us-west2', sizeMB: 1024,
      mountedOn: { serviceId: dbId, serviceName: dbName, mountPath },
    }],
  };
}
const run = (snapshot, options = { approvedVolumeId: volumeId }) =>
  assessRC87ErpPersistence(snapshot, options);

test('pass only exact live exclusive PG18 mount from reviewed volume', () => {
  assert.deepEqual(run(isolatedFixture()), { go: true, failures: [] });
});

const negative = [
  ['missing snapshot', () => null, 'PROJECT_NOT_APPROVED'],
  ['wrong project', s => { s.project.id = 'production'; }, 'PROJECT_NOT_APPROVED'],
  ['wrong environment', s => { s.environment.id = 'production'; }, 'ENVIRONMENT_NOT_APPROVED'],
  ['production name', s => { s.environment.name = 'production'; }, 'ENVIRONMENT_NOT_APPROVED'],
  ['ephemeral environment', s => { s.environment.isEphemeral = true; }, 'ENVIRONMENT_NOT_APPROVED'],
  ['staged patch in flight', s => { s.staged = { status: 'STAGED' }; }, 'UNCOMMITTED_STAGED_CHANGES'],
  ['wrong db service', s => { s.services[0].id = 'legacy'; }, 'POSTGRES_SERVICE_MISMATCH'],
  ['wrong db name', s => { s.services[0].name = 'nextcrm-db'; }, 'POSTGRES_SERVICE_MISMATCH'],
  ['legacy PostgreSQL', s => { s.services[0].source.image = 'postgres:17'; }, 'POSTGRES_SOURCE_MISMATCH'],
  ['repository instead of approved image', s => { s.services[0].source.repo = 'some/repo'; }, 'POSTGRES_SOURCE_MISMATCH'],
  ['staged db service', s => { s.services[0].state = 'live-with-staged-changes'; }, 'POSTGRES_NOT_LIVE'],
  ['db deployment failure', s => { s.services[0].latestDeployment.status = 'FAILED'; }, 'POSTGRES_NOT_LIVE'],
  ['db region mismatch', s => { s.services[0].regions = ['us-east4']; }, 'POSTGRES_WRONG_REGION'],
  ['unattached volume', s => { s.volumes[0].mountedOn = null; }, 'POSTGRES_VOLUME_OWNERSHIP_INVALID'],
  ['volume mounted to CRM instead', s => { s.volumes[0].mountedOn.serviceName = 'nextcrm'; }, 'POSTGRES_VOLUME_OWNERSHIP_INVALID'],
  ['volume not live', s => { s.volumes[0].state = 'staged-create'; }, 'POSTGRES_VOLUME_NOT_LIVE'],
  ['volume less than 1 GB', s => { s.volumes[0].sizeMB = 512; }, 'POSTGRES_VOLUME_SIZE_INVALID'],
  ['volume wrong region', s => { s.volumes[0].region = 'us-east4'; }, 'POSTGRES_VOLUME_REGION_INVALID'],
  ['PG18 old mount path', s => { s.volumes[0].mountedOn.mountPath = '/var/lib/postgresql/data'; s.services[0].volumeMounts[0].mountPath = '/var/lib/postgresql/data'; }, 'POSTGRES_VOLUME_OWNERSHIP_INVALID'],
  ['volume mismatched at service', s => { s.services[0].volumeMounts[0].volumeId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; }, 'POSTGRES_MOUNT_NOT_EXCLUSIVE'],
  ['multiple db mounts', s => { s.services[0].volumeMounts.push({ volumeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', volumeName: 'unexpected', mountPath: '/backup' }); }, 'POSTGRES_MOUNT_NOT_EXCLUSIVE'],
  ['duplicate volume ownership', s => { s.volumes.push({ ...s.volumes[0], id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }); }, 'POSTGRES_MOUNT_NOT_EXCLUSIVE'],
  ['volume shared with other service', s => { s.services[1].volumeMounts.push({ volumeId, mountPath }); }, 'POSTGRES_MOUNT_NOT_EXCLUSIVE'],
  ['wrong volume record id', s => { s.volumes[0].id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; }, 'APPROVED_VOLUME_NOT_FOUND'],
];

for (const [name, mutate, expected] of negative) {
  test('NO-GO ' + name, () => {
    const snapshot = isolatedFixture();
    const bad = mutate(snapshot);
    const verdict = run(bad === null ? null : snapshot);
    assert.equal(verdict.go, false);
    assert.ok(verdict.failures.includes(expected), name + ': ' + verdict.failures.join(','));
    assert.ok(verdict.failures.every(v => /^[A-Z0-9_]+$/.test(v)), name);
  });
}

test('no operator approval or invalid volume ID fails closed', () => {
  const snapshot = isolatedFixture();
  for (const options of [{}, { approvedVolumeId: '' }, { approvedVolumeId: 'nextcrm-db' },
    { approvedVolumeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]) {
    const result = run(snapshot, options);
    assert.equal(result.go, false);
    assert.ok(result.failures.length > 0);
  }
});

test('no schema, secrets or database values appear in the emitted checks', () => {
  const snapshot = isolatedFixture();
  snapshot.volumes[0].region = 'secret-postgres-password-value';
  const { failures } = run(snapshot);
  assert.ok(failures.includes('POSTGRES_VOLUME_REGION_INVALID'));
  assert.ok(!JSON.stringify(failures).includes('secret-postgres-password-value'));
});

test('the actual RC86 schema-less Railway staging inventory remains NO-GO', () => {
  const snapshot = isolatedFixture();
  snapshot.services[0].volumeMounts = [];
  snapshot.volumes = [];
  const verdict = run(snapshot);
  assert.equal(verdict.go, false);
  assert.ok(verdict.failures.includes('APPROVED_VOLUME_NOT_FOUND'));
  assert.ok(verdict.failures.includes('POSTGRES_MOUNT_NOT_EXCLUSIVE'));
});


const cli = fileURLToPath(new URL('./rc87-erp-persistence-gate.mjs', import.meta.url));
const runCli = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8',
  timeout: 5000,
  env: { ...process.env, ...env },
});

test('CLI rejects missing input and never proceeds without operator volume approval', () => {
  const noInput = runCli([]);
  assert.equal(noInput.status, 1);
  assert.match(noInput.stderr, /RC87_PERSISTENCE_NO_GO: INVALID_SNAPSHOT/);

  const folder = mkdtempSync(join(tmpdir(), 'rc87-safe-'));
  const filepath = join(folder, 'inventory.json');
  try {
    writeFileSync(filepath, JSON.stringify(isolatedFixture()));
    const noApproval = runCli([filepath], { RC87_APPROVED_VOLUME_ID: '' });
    assert.equal(noApproval.status, 1);
    assert.match(noApproval.stderr, /VOLUME_ID_NOT_APPROVED/);

    const approved = runCli([filepath], { RC87_APPROVED_VOLUME_ID: volumeId });
    assert.equal(approved.status, 0);
    assert.match(approved.stdout, /RC87_PERSISTENCE_METADATA_PASS/);
    assert.match(approved.stdout, /RC87_REMAINING_GATES/);
    assert.doesNotMatch(approved.stdout, /ready-for-production/);

    writeFileSync(filepath, '{"DATABASE_URL":"secret-db-password",');
    const invalid = runCli([filepath], { RC87_APPROVED_VOLUME_ID: volumeId });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /INVALID_SNAPSHOT/);
    assert.doesNotMatch(invalid.stderr, /secret-db-password/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
