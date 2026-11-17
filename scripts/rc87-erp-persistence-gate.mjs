import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Operator-supplied, read-only Railway describe_environment snapshot.
// This gates infrastructure only. It cannot prove the durability of data,
// backup/restore, a successful migration, or business-level UAT.
const EXPECTED = Object.freeze({
  projectId: '0835d357-6037-42e6-a534-6456422e1cf3',
  environmentId: 'c241a855-68b7-4d75-a722-b6a42c8581e9',
  dbServiceId: '7202c8eb-4a9e-4cb9-9329-0988e5033263',
  dbServiceName: 'cisne-rc85-ephemeral-pg',
  image: 'postgres:18',
  region: 'us-west2',
  path: '/var/lib/postgresql',
  minSizeMB: 1024,
});

const single = (items, predicate) => {
  const found = Array.isArray(items) ? items.filter(predicate) : [];
  return found.length === 1 ? found[0] : null;
};

/**
 * @param {unknown} snapshot The complete output of Railway describe_environment
 * @param {{approvedVolumeId?:string}} options ID explicitly reviewed by the operator
 * @returns {{go:boolean,failures:string[]}} No secrets, URLs or user data.
 */
export function assessRC87ErpPersistence(snapshot, { approvedVolumeId } = {}) {
  const failures = [];
  const check = (name, valid) => { if (!valid) failures.push(name); };
  const obj = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot : {};
  const services = Array.isArray(obj.services) ? obj.services : [];
  const volumes = Array.isArray(obj.volumes) ? obj.volumes : [];

  check('PROJECT_NOT_APPROVED', obj.project?.id === EXPECTED.projectId);
  check('ENVIRONMENT_NOT_APPROVED',
    obj.environment?.id === EXPECTED.environmentId &&
    obj.environment?.name === 'staging' && obj.environment?.isEphemeral === false);
  check('UNCOMMITTED_STAGED_CHANGES', obj.staged === null);
  check('VOLUME_ID_NOT_APPROVED',
    typeof approvedVolumeId === 'string' &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(approvedVolumeId));

  const db = single(services,
    service => service?.id === EXPECTED.dbServiceId &&
      service?.name === EXPECTED.dbServiceName);
  check('POSTGRES_SERVICE_MISMATCH', Boolean(db));
  check('POSTGRES_SOURCE_MISMATCH',
    db?.source?.image === EXPECTED.image &&
    db?.source?.repo == null && db?.source?.branch == null);
  check('POSTGRES_NOT_LIVE',
    db?.state === 'live' && db?.latestDeployment?.status === 'SUCCESS');
  check('POSTGRES_WRONG_REGION',
    Array.isArray(db?.regions) && db.regions.length === 1 &&
    db.regions[0] === EXPECTED.region);

  const volume = single(volumes, v => v?.id === approvedVolumeId);
  check('APPROVED_VOLUME_NOT_FOUND', Boolean(volume));
  check('POSTGRES_VOLUME_NOT_LIVE', volume?.state === 'live');
  check('POSTGRES_VOLUME_SIZE_INVALID',
    Number.isFinite(volume?.sizeMB) && volume.sizeMB >= EXPECTED.minSizeMB);
  check('POSTGRES_VOLUME_REGION_INVALID', volume?.region === EXPECTED.region);
  check('POSTGRES_VOLUME_OWNERSHIP_INVALID',
    volume?.mountedOn?.serviceId === EXPECTED.dbServiceId &&
    volume?.mountedOn?.serviceName === EXPECTED.dbServiceName &&
    volume?.mountedOn?.mountPath === EXPECTED.path);

  const dbMount = single(db?.volumeMounts,
    mount => mount?.volumeId === approvedVolumeId);
  check('POSTGRES_MOUNT_NOT_EXCLUSIVE',
    dbMount?.volumeName === volume?.name &&
    dbMount?.mountPath === EXPECTED.path &&
    db?.volumeMounts?.length === 1 &&
    volumes.filter(v => v?.mountedOn?.serviceId === EXPECTED.dbServiceId).length === 1 &&
    services.filter(service =>
      service?.id !== EXPECTED.dbServiceId &&
      Array.isArray(service?.volumeMounts) &&
      service.volumeMounts.some(m => m?.volumeId === approvedVolumeId)
    ).length === 0);

  return { go: failures.length === 0, failures: failures.sort() };
}

// Deliberately accept no Railway API token or database credentials.
// The snapshot file must be obtained via the authorized Railway account.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  const approvedVolumeId = process.env.RC87_APPROVED_VOLUME_ID;
  let snapshot;
  try {
    if (!inputPath || process.argv.length !== 3)
      throw new Error('snapshot file path required');
    snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch {
    console.error('RC87_PERSISTENCE_NO_GO: INVALID_SNAPSHOT');
    process.exitCode = 1;
  }
  if (snapshot) {
    const verdict = assessRC87ErpPersistence(snapshot, { approvedVolumeId });
    if (!verdict.go) {
      console.error('RC87_PERSISTENCE_NO_GO: ' + verdict.failures.join(','));
      process.exitCode = 1;
    } else {
      console.log('RC87_PERSISTENCE_METADATA_PASS: isolated PostgreSQL 18 has an approved, exclusive Railway volume.');
      console.log('RC87_REMAINING_GATES: verify restart durability, independent backup/restore, migration attestation, readiness and UAT.');
    }
  }
}
