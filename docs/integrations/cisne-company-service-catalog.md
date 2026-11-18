# CISNE RONDÔNIA — empresa e catálogo operacional

## Fonte cadastral analisada

- CNPJ: `11.897.171/0001-81`
- Razão social: **Cisne Rondonia Comercio e Servicos LTDA**
- Situação informada na consulta pública: ativa
- Atividade principal informada: representação comercial de mercadorias em geral não especializado
- Localização informada: Porto Velho/RO

Os dados públicos são usados como referência operacional. Para efeitos fiscais,
contratuais ou de faturamento, a situação vigente deve ser confirmada no
comprovante oficial da Receita Federal.

## O que foi implantado no Field

- perfil da empresa com CNPJ, razão social, endereço, cidade, UF e situação;
- catálogo inicial de serviços com CNAE, categoria, descrição e status ativo;
- endpoint autenticado `GET /api/service-catalog`;
- campo opcional `serviceCatalogId` na criação da ordem de serviço;
- validação servidor-servidor: a OS só aceita serviço ativo do catálogo da empresa;
- persistência do serviço escolhido em `service_orders.service_catalog_id`.

O catálogo inicial cobre representação comercial, instalações elétricas e
hidráulicas, locações, construção, transporte, paisagismo, facilities,
usinagem/solda, pneus e materiais de construção, entre outros CNAEs
secundários publicados na consulta.
