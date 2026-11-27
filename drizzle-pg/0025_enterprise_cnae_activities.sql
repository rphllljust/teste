-- Permanent company activity reference, copied to a legal entity only by an authorized, explicit command.
-- This list was supplied by the operator, not independently verified against a Receita Federal CNPJ.
CREATE TABLE enterprise_declared_cnaes (
 code text PRIMARY KEY CHECK (code ~ '^[0-9]{2}\\.[0-9]{2}-[0-9]-[0-9]{2}$'),
 description text NOT NULL,
 display_order integer NOT NULL CONSTRAINT enterprise_declared_cnaes_order_uq UNIQUE CHECK(display_order>0),
 is_primary boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_declared_cnaes_single_primary_idx ON enterprise_declared_cnaes(is_primary) WHERE is_primary = true;
--> statement-breakpoint
INSERT INTO enterprise_declared_cnaes(code,description,display_order,is_primary) VALUES
 ('46.19-2-00','Representantes comerciais e agentes do comércio de mercadorias em geral não especializado',1,true),
 ('43.21-5-00','Instalação e manutenção elétrica',2,false),
 ('77.11-0-00','Locação de automóveis sem condutor',3,false),
 ('77.39-0-99','Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador',4,false),
 ('33.21-0-00','Instalação de máquinas e equipamentos industriais',5,false),
 ('81.11-7-00','Serviços combinados para apoio a edifícios, exceto condomínios prediais',6,false),
 ('41.20-4-00','Construção de edifícios',7,false),
 ('45.30-7-05','Comércio a varejo de pneumáticos e câmaras-de-ar',8,false),
 ('25.39-0-01','Serviços de usinagem, tornearia e solda',9,false),
 ('49.30-2-02','Transporte rodoviário de carga, exceto produtos perigosos e mudanças, intermunicipal, interestadual e internacional',10,false),
 ('49.30-2-01','Transporte rodoviário de carga, exceto produtos perigosos e mudanças, municipal',11,false),
 ('45.41-2-03','Comércio a varejo de motocicletas e motonetas novas',12,false),
 ('81.30-3-00','Atividades paisagísticas',13,false),
 ('46.69-9-99','Comércio atacadista de outras máquinas e equipamentos não especificados anteriormente; partes e peças',14,false),
 ('46.79-6-99','Comércio atacadista de materiais de construção em geral',15,false),
 ('45.41-2-01','Comércio por atacado de motocicletas e motonetas',16,false),
 ('45.42-1-01','Representantes comerciais e agentes do comércio de motocicletas e motonetas, peças e acessórios',17,false),
 ('43.99-1-99','Serviços especializados para construção não especificados anteriormente',18,false),
 ('47.44-0-99','Comércio varejista de materiais de construção em geral',19,false),
 ('46.79-6-04','Comércio atacadista especializado de materiais de construção não especificados anteriormente',20,false),
 ('42.11-1-01','Construção de rodovias e ferrovias',21,false),
 ('43.11-8-01','Demolição de edifícios e outras estruturas',22,false),
 ('43.13-4-00','Obras de terraplenagem',23,false),
 ('43.22-3-01','Instalações hidráulicas, sanitárias e de gás',24,false),
 ('43.30-4-04','Serviços de pintura de edifícios em geral',25,false),
 ('45.11-1-01','Comércio a varejo de automóveis, camionetas e utilitários novos',26,false),
 ('45.11-1-02','Comércio a varejo de automóveis, camionetas e utilitários usados',27,false),
 ('45.12-9-02','Comércio sob consignação de veículos automotores',28,false),
 ('28.69-1-00','Fabricação de máquinas e equipamentos para uso industrial específico não especificados anteriormente, peças e acessórios',29,false),
 ('49.29-9-02','Transporte rodoviário coletivo de passageiros, sob regime de fretamento, intermunicipal, interestadual e internacional',30,false),
 ('42.13-8-00','Obras de urbanização - ruas, praças e calçadas',31,false),
 ('77.32-2-01','Aluguel de máquinas e equipamentos para construção sem operador, exceto andaimes',32,false),
 ('43.91-6-00','Obras de fundações',33,false),
 ('42.11-1-02','Pintura para sinalização em pistas rodoviárias e aeroportos',34,false),
 ('38.11-4-00','Coleta de resíduos não-perigosos',35,false),
 ('45.11-1-06','Comércio por atacado de ônibus e microônibus novos e usados',36,false),
 ('45.41-2-02','Comércio por atacado de peças e acessórios para motocicletas e motonetas',37,false),
 ('45.30-7-06','Representantes comerciais e agentes do comércio de peças e acessórios novos e usados para veículos automotores',38,false),
 ('49.23-0-02','Serviço de transporte de passageiros - locação de automóveis com motorista',39,false),
 ('45.12-9-01','Representantes comerciais e agentes do comércio de veículos automotores',40,false),
 ('43.11-8-02','Preparação de canteiro e limpeza de terreno',41,false),
 ('78.10-8-00','Seleção e agenciamento de mão-de-obra',42,false),
 ('42.12-0-00','Construção de obras de arte especiais',43,false),
 ('42.22-7-01','Construção de redes de abastecimento de água, coleta de esgoto e construções correlatas, exceto obras de irrigação',44,false),
 ('43.99-1-04','Serviços de operação e fornecimento de equipamentos para transporte e elevação de cargas e pessoas para uso em obras',45,false),
 ('43.19-3-00','Serviços de preparação do terreno não especificados anteriormente',46,false),
 ('43.99-1-05','Perfuração e construção de poços de água',47,false),
 ('45.11-1-04','Comércio por atacado de caminhões novos e usados',48,false),
 ('50.30-1-01','Navegação de apoio marítimo',49,false);
--> statement-breakpoint
CREATE TABLE enterprise_legal_entity_cnaes (
 tenant_id text NOT NULL,
 legal_entity_id text NOT NULL,
 cnae_code text NOT NULL REFERENCES enterprise_declared_cnaes(code),
 is_primary boolean NOT NULL DEFAULT false,
 created_by text NOT NULL,
 created_at text NOT NULL,
 PRIMARY KEY(tenant_id,legal_entity_id,cnae_code),
 CONSTRAINT enterprise_entity_cnaes_company_fk FOREIGN KEY(tenant_id,legal_entity_id)
   REFERENCES enterprise_legal_entities(tenant_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_entity_cnaes_single_primary_idx ON enterprise_legal_entity_cnaes(legal_entity_id) WHERE is_primary = true;
--> statement-breakpoint
CREATE INDEX enterprise_entity_cnaes_tenant_idx ON enterprise_legal_entity_cnaes(tenant_id,legal_entity_id);
