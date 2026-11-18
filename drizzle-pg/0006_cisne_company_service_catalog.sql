-- CISNE RONDÔNIA company profile and operational service catalog.
-- Source: public CNPJ record 11.897.171/0001-81; validate current
-- registration before using it for tax or contractual decisions.
CREATE TABLE IF NOT EXISTS "company_profiles" (
  "cnpj" text PRIMARY KEY,
  "legal_name" text NOT NULL,
  "trade_name" text,
  "address" text NOT NULL,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "company_profiles_cnpj_valid" CHECK ("cnpj" ~ '^[0-9]{14}$'),
  CONSTRAINT "company_profiles_status_valid" CHECK ("status" IN ('active','inactive'))
);
--> statement-breakpoint
INSERT INTO "company_profiles"
  ("cnpj","legal_name","trade_name","address","city","state")
VALUES
  ('11897171000181','Cisne Rondonia Comercio e Servicos LTDA','CISNE RONDÔNIA',
   'Rua dos Farrapos, 5000, São Francisco, CEP 76813-284','Porto Velho','RO')
ON CONFLICT ("cnpj") DO UPDATE SET
  "legal_name"=EXCLUDED."legal_name",
  "trade_name"=EXCLUDED."trade_name",
  "address"=EXCLUDED."address",
  "city"=EXCLUDED."city",
  "state"=EXCLUDED."state",
  "updated_at"=now();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_catalog" (
  "id" text PRIMARY KEY,
  "company_cnpj" text NOT NULL REFERENCES "company_profiles"("cnpj") ON DELETE RESTRICT,
  "cnae" text NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_catalog_cnae_valid" CHECK ("cnae" ~ '^[0-9]{4}-[0-9]/[0-9]{2}$')
);
--> statement-breakpoint
CREATE INDEX "service_catalog_active_category_idx"
  ON "service_catalog" ("company_cnpj","active","category","name");
--> statement-breakpoint
ALTER TABLE "service_orders"
  ADD COLUMN IF NOT EXISTS "service_catalog_id" text
  REFERENCES "service_catalog"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_orders_catalog_idx"
  ON "service_orders" ("service_catalog_id");
--> statement-breakpoint
INSERT INTO "service_catalog" ("id","company_cnpj","cnae","name","category","description") VALUES
 ('cisne-representacao-comercial','11897171000181','4619-2/00','Representação comercial de mercadorias','Comercial','Representação e intermediação comercial de mercadorias em geral não especializado.'),
 ('cisne-instalacao-eletrica','11897171000181','4321-5/00','Instalação e manutenção elétrica','Instalações','Instalação, manutenção e adequação de sistemas elétricos.'),
 ('cisne-locacao-veiculos','11897171000181','7711-0/00','Locação de automóveis sem condutor','Locação','Locação de veículos automotores sem motorista.'),
 ('cisne-locacao-maquinas','11897171000181','7732-2/01','Locação de máquinas para construção','Locação','Aluguel de máquinas e equipamentos para construção sem operador.'),
 ('cisne-locacao-equipamentos','11897171000181','7739-0/99','Locação de máquinas e equipamentos industriais','Locação','Aluguel de máquinas e equipamentos comerciais e industriais sem operador.'),
 ('cisne-instalacao-maquinas','11897171000181','3321-0/00','Instalação de máquinas industriais','Industrial','Instalação e montagem de máquinas e equipamentos industriais.'),
 ('cisne-apoio-edificios','11897171000181','8111-7/00','Apoio operacional a edifícios','Facilities','Serviços combinados para apoio a edifícios, exceto condomínios prediais.'),
 ('cisne-construcao-edificios','11897171000181','4120-4/00','Construção de edifícios','Obras','Construção e execução de edifícios.'),
 ('cisne-pneus','11897171000181','4530-7/05','Comércio de pneus e câmaras de ar','Automotivo','Comércio varejista de pneumáticos e câmaras de ar.'),
 ('cisne-usinagem-solda','11897171000181','2539-0/01','Usinagem, tornearia e solda','Industrial','Serviços de usinagem, tornearia e soldagem.'),
 ('cisne-transporte-cargas-intermunicipal','11897171000181','4930-2/02','Transporte rodoviário de cargas interestadual','Transporte','Transporte rodoviário de carga, exceto produtos perigosos e mudanças.'),
 ('cisne-transporte-cargas-municipal','11897171000181','4930-2/01','Transporte rodoviário de cargas municipal','Transporte','Transporte rodoviário de cargas no âmbito municipal.'),
 ('cisne-paisagismo','11897171000181','8130-3/00','Paisagismo e manutenção de áreas verdes','Facilities','Implantação e manutenção paisagística.'),
 ('cisne-materiais-construcao','11897171000181','4679-6/99','Comércio atacadista de materiais de construção','Comercial','Comércio atacadista de materiais de construção em geral.'),
 ('cisne-reforma-construcao','11897171000181','4399-1/99','Serviços especializados de construção','Obras','Execução de serviços especializados de construção.'),
 ('cisne-rodovias-ferrovias','11897171000181','4211-1/01','Construção de rodovias e ferrovias','Obras','Execução e manutenção de obras rodoviárias e ferroviárias.'),
 ('cisne-demolicao','11897171000181','4311-8/01','Demolição de estruturas','Obras','Demolição de edifícios e outras estruturas.'),
 ('cisne-terraplenagem','11897171000181','4313-4/00','Terraplenagem','Obras','Serviços de preparação, movimentação e terraplenagem.'),
 ('cisne-instalacao-hidraulica','11897171000181','4322-3/01','Instalações hidráulicas e sanitárias','Instalações','Instalações hidráulicas, sanitárias e de gás.'),
 ('cisne-pintura-edificios','11897171000181','4330-4/04','Pintura de edifícios','Obras','Serviços de pintura de edifícios em geral.')
ON CONFLICT ("id") DO UPDATE SET
  "company_cnpj"=EXCLUDED."company_cnpj",
  "cnae"=EXCLUDED."cnae",
  "name"=EXCLUDED."name",
  "category"=EXCLUDED."category",
  "description"=EXCLUDED."description",
  "active"=true;
