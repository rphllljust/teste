# NextCRM PostgreSQL: backup and restore readiness rehearsal

## What this gate proves

The workflow `.github/workflows/nextcrm-postgres-restore-rehearsal.yml` creates a disposable PostgreSQL 17/pgvector database in GitHub Actions, inserts one entirely fictitious company/amount/text/vector row, and:
1. Captures a custom-format `pg_dump --format=custom` file in a private temporary runner directory.
2. Restores it to a **different database** via `pg_restore --exit-on-error --no-owner --no-acl`.
3. Compares source and restored row counts and MD5 of a deterministic canonical representation of all fields.
4. Deliberately changes a monetary value in the *restored* database and proves the comparison fails.
5. Removes the local backup, with no artifact published or data sent to Railway.

**This is only a technical recovery rehearsal with synthetic data.** It does not prove the real Railway PostgreSQL volume has backups or that any real backup is restorable. It does not cover the MinIO document store, Inngest state or D1 historical records. MD5 in this fixture is only a deterministic drift detector, not a security signature or backup encryption.

## Actual staging go/no-go requirements

Before deploying the NextCRM stack in `genuine-renewal/staging`:
- Establish and verify an independent backup schedule for `nextcrm-postgres-data`, `nextcrm-minio-data` and `nextcrm-web-data`; backup copies must be encrypted, access-controlled, retained and restored in a separate isolated destination.
- On the existing ERP `Postgres`, restore a backup to an isolated PostgreSQL instance and compare data before any new ERP migration; the current 36 business tables were found empty in staging, which is not evidence about historical D1 records.
- Ensure `pg_dump` is taken at an application-consistent checkpoint and includes or coordinates MinIO object metadata, background jobs and migrations.
- Run UAT for authenticated login and document links, then test rollback without dropping immutable audit events or creating divergence.
- Track exact deployed image digests and migration IDs; retain operational restoration procedures accessible without Cloudflare D1 credentials.

**Do not declare production cutover or accept-deploy approved on the basis of this synthetic rehearsal alone.**
