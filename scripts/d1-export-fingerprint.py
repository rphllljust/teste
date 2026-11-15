#!/usr/bin/env python3
"""Offline, read-only fingerprint of a Cloudflare D1 SQL export.

DO NOT commit the SQL export or the generated manifest: counts and hashes may
still reveal operational information. This tool never connects to Cloudflare.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE_PATTERN = re.compile(r"pgTable\('([A-Za-z_][A-Za-z0-9_]*)'")
def tables_from_schema():
    tables = sorted(set(TABLE_PATTERN.findall((ROOT / 'db/schema.ts').read_text('utf-8'))))
    if len(tables) < 30:
        raise SystemExit('NO-GO: expected PostgreSQL domain table inventory is incomplete')
    return tables

def fingerprint(conn, name):
    quoted = '"' + name.replace('"', '""') + '"'
    columns = sorted(row[1] for row in conn.execute(f'PRAGMA table_info({quoted})'))
    if not columns or 'id' not in columns:
        raise ValueError(f'{name}: missing table, columns or id')
    digest = hashlib.sha256()
    count = 0
    cursor = conn.execute(f'SELECT * FROM {quoted} ORDER BY "id" COLLATE BINARY')
    names = [x[0] for x in cursor.description]
    for values in cursor:
        record = dict(zip(names, values))
        if any(isinstance(record[k], bytes) for k in columns):
            raise ValueError(f'{name}: unsupported BLOB; requires separate migration review')
        canonical = [[k, None if record[k] is None else str(record[k])] for k in columns]
        digest.update(json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        digest.update(b'\n')
        count += 1
    return {'columns': columns, 'rows': count, 'sha256': digest.hexdigest()}

def main():
    parser = argparse.ArgumentParser(description='Fingerprint an existing, trusted D1 SQL export offline')
    parser.add_argument('--sql', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not args.sql.is_file() or not args.sql.stat().st_size:
        raise SystemExit('NO-GO: the SQL export file is missing or empty')
    if args.sql.resolve() == args.output.resolve():
        raise SystemExit('NO-GO: export and manifest paths must differ')

    expected = tables_from_schema()
    # The temporary directory is private (0700) and deleted after parsing.
    with tempfile.TemporaryDirectory(prefix='d1-cutover-') as tmp:
        dbpath = Path(tmp) / 'offline-source.sqlite'
        db = sqlite3.connect(dbpath)
        try:
            # D1 export is an SQL dump, NOT compatible with PostgreSQL SQL import.
            # Execute it only in a temporary isolated SQLite database.
            db.executescript(args.sql.read_text('utf-8'))
            report = {table: fingerprint(db, table) for table in expected}
        finally:
            db.close()

    if sum(item['rows'] for item in report.values()) == 0:
        raise SystemExit('NO-GO: source is completely empty; confirm the correct D1 database')
    result = {
        'format': 'cisne-d1-postgres-fingerprint-v1',
        'origin': 'cloudflare-d1-offline-sql-export',
        'tables': report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Restrict permissions; file contains no raw rows but is still confidential.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as out:
        json.dump(result, out, ensure_ascii=False, indent=2, sort_keys=True)
        out.write('\n')
    print(f'Offline D1 fingerprint created: {len(report)} tables; no rows printed')

if __name__ == '__main__':
    main()
