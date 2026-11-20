-- P0: widen fixed-scale fiscal amounts/rates without rewriting or deleting rows.
-- 0014 is append-only; this migration is safe to replay through the ledger.
ALTER TABLE fiscal_documents
  ALTER COLUMN gross_amount TYPE bigint USING gross_amount::bigint,
  ALTER COLUMN tax_base TYPE bigint USING tax_base::bigint,
  ALTER COLUMN iss_rate TYPE bigint USING iss_rate::bigint,
  ALTER COLUMN iss_amount TYPE bigint USING iss_amount::bigint,
  ALTER COLUMN icms_rate TYPE bigint USING icms_rate::bigint,
  ALTER COLUMN icms_amount TYPE bigint USING icms_amount::bigint,
  ALTER COLUMN ipi_amount TYPE bigint USING ipi_amount::bigint,
  ALTER COLUMN pis_amount TYPE bigint USING pis_amount::bigint,
  ALTER COLUMN cofins_amount TYPE bigint USING cofins_amount::bigint,
  ALTER COLUMN withheld_amount TYPE bigint USING withheld_amount::bigint;

-- The legacy UNIQUE constraint treats NULL series values as distinct. The
-- expression index gives an omitted series the same identity as an empty one,
-- while document_type remains part of the business identity.
ALTER TABLE fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_actor_id_number_series_direction_key;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_identity_unique
  ON fiscal_documents(actor_id, number, COALESCE(series, ''), direction, document_type);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_nonnegative_amounts') THEN
    ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_nonnegative_amounts CHECK (
      gross_amount >= 0 AND tax_base >= 0 AND iss_amount >= 0 AND icms_amount >= 0 AND
      ipi_amount >= 0 AND pis_amount >= 0 AND cofins_amount >= 0 AND withheld_amount >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_rate_range') THEN
    ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_rate_range CHECK (
      iss_rate BETWEEN 0 AND 1000000 AND icms_rate BETWEEN 0 AND 1000000
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fiscal_documents_actor_identity
  ON fiscal_documents(actor_id, id);
