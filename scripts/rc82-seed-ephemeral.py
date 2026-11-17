#!/usr/bin/env python3
"""Only synthetic document and owned NextCRM records in disposable CI Postgres/MinIO."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
assert os.getenv("GITHUB_ACTIONS") == "true" and os.getenv("CI") == "true"
assert not any(k.startswith("RAILWAY_") for k in os.environ)
db = os.getenv("RC82_DB_URL", "")
target = urlparse(db)
assert (target.hostname, target.port, target.path) == ("127.0.0.1", 15432, "/nextcrm_ci")
import boto3
import psycopg2
from botocore.config import Config
fixture_path = Path("/tmp/rc82-fixture.json")
phase = os.getenv("RC82_PHASE", "seed")
if phase == "revoke":
    f = json.loads(fixture_path.read_text())
    with psycopg2.connect(db) as connection:
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "DocumentsToAccounts" WHERE document_id=%s AND account_id=%s',
                           (f["documentId"],f["accountId"]))
            assert cursor.rowcount == 1
    print("RC82_ACL_REVOKED_IN_DISPOSABLE_POSTGRES")
else:
    assert phase == "seed"
    owner, outsider, account, doc, client = [str(uuid4()) for i in range(5)]
    payload = b"%PDF-1.4\n%Synthetic RC82 private document. No customer data.\n%%EOF\n"
    digest = hashlib.sha256(payload).hexdigest()
    key = "documents/rc82/" + doc + ".pdf"
    s3 = boto3.client("s3", endpoint_url="http://127.0.0.1:19000",
        aws_access_key_id="ci-nextcrm",
        aws_secret_access_key=os.environ["CI_RC82_MINIO_PASSWORD"],
        region_name="us-east-1",config=Config(s3={"addressing_style":"path"}))
    s3.create_bucket(Bucket="nextcrm")
    s3.put_object(Bucket="nextcrm", Key=key, Body=payload, ContentType="application/pdf")
    retrieved = s3.get_object(Bucket="nextcrm", Key=key)["Body"].read()
    assert hashlib.sha256(retrieved).hexdigest() == digest
    with psycopg2.connect(db) as connection:
        with connection.cursor() as cursor:
            cursor.executemany('INSERT INTO "Users"(id,email,role,"userStatus",banned) '
                "VALUES(%s,%s,'user','ACTIVE',false)",
                [(owner,"rc82-owner-"+owner+"@example.invalid"),
                 (outsider,"rc82-outsider-"+outsider+"@example.invalid")])
            cursor.execute('INSERT INTO "crm_Accounts"(id,"__v",name,external_ref,assigned_to) '
                'VALUES(%s,0,%s,%s,%s)',(account,"RC82 synthetic account",client,owner))
            cursor.execute('INSERT INTO "Documents"(id,document_name,"document_file_mimeType",'
                'document_file_url,key,connected_documents,created_by_user,version,content_hash,size) '
                'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                (doc,"RC82 synthetic.pdf","application/pdf",
                 "https://nextcrm-minio-staging.up.railway.app/nextcrm/"+key,
                 key,[],owner,1,digest,len(payload)))
            cursor.execute('INSERT INTO "DocumentsToAccounts"(document_id,account_id) VALUES(%s,%s)',
                           (doc,account))
    fixture_path.write_text(json.dumps({"owner":owner,"outsider":outsider,"accountId":account,
        "documentId":doc,"erpClientId":client,"sha256":digest,
        "size":len(payload),"instanceKey":"rc82_ephemeral"}))
    os.chmod(fixture_path,0o600)
    print("RC82_SYNTHETIC_PRISMA_TABLES_AND_PRIVATE_MINIO_OBJECT_READY")
