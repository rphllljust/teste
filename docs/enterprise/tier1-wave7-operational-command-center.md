# CISNE ERP Tier 1 — Onda 7: List Report + Object Page + Centro de Comando

## Objetivo do release

A Onda 6 reduziu navegação duplicada e trouxe tabelas configuráveis e um planejamento de recursos transacional. A Onda 7 transforma o conteúdo inicial do ERP: **documentos empresariais e exceções autorizadas passam a aparecer antes de cartões e diagramas**. A arquitetura preserva as APIs e transições existentes.

## Experiência real implementada

**Visão operacional** e **Field Service Cockpit** passam a usar `EnterpriseOperationsWorkbench`. Os filtros da API `GET /api/enterprise/operations` incluem fila, situação, prazo, categoria e busca; a paginação e a ordenação são feitas no PostgreSQL. O usuário vê indicadores globais do próprio escopo, sem confundir o total filtrado com total da organização. Os estados derivam de `service_orders.status`; atrasos usam `due_date` ISO persistido e `CURRENT_DATE`; medição pendente requer ordem concluída e ausência comprovada em `measurements`. Uma OS sem proprietário não é exibida pelo read-model de gestão.

Ao examinar uma OS, o painel de contexto consulta `GET /api/orders/:id` sob a sessão do operador. Mostra relações, auditoria e `availableCommands` do backend. Não executa transições por atalhos: o usuário é encaminhado à OS original para ações autorizadas e versionadas.

O mapa de processos permanece acessível **sob demanda**, não ocupa a área principal em cada acesso. A faixa operacional duplicada e o cabeçalho antigo são removidos **apenas da Visão operacional**, sem alterar os módulos financeiros.

**Object Page:** o detalhe da OS usa o `EnterpriseObjectSummary` já compartilhado e âncoras reais para Escopo, Comandos, Origem comercial, Registros e Histórico. O Dossiê empresarial usa as mesmas âncoras em suas 14 etapas, valores e auditoria. A navegação preserva o hash do módulo e opera no scroll da própria gaveta.

**List Reports globais:** Clientes, Contratos e Contabilidade usam o `EnterpriseSmartGrid`, somando-se a Dossiês, Profissionais e Frota/Ativos. A configuração de colunas é local ao navegador, e não armazena clientes, transações ou credenciais. Ordenação e exportação CSV limitam-se à página de registros autorizados já recebidos da API, nunca outras páginas do banco.

## Segurança, limites e honestidade operacional

- `requestContext` antes das consultas; read-model de OS somente `owner_id = actorId`, sem proprietários nulos.
- Transação PostgreSQL `REPEATABLE READ READ ONLY`, cliente liberado e rollback em erro.
- Filtros estritos Zod, `pageSize` de 1 a 50, sem SQL de ordenação arbitrário.
- Nenhum serviço, variável, banco, volume ou tabela novo em Railway.
- Nenhum dado fictício no runtime. O teste sintético usa PostgreSQL efêmero `cisne_ci` / `cisne_test` apenas em CI.
- O painel de trabalho não assume execução, faturamento ou baixa por simples navegação.
- O login de homologação só é necessário para ler documentos; automação de navegador com sessão assinada permanece gate separado.

## Gates e release

1. CI exato: `quality`, `enterprise unused-code baseline`, `CISNE full-stack checks` e `PostgreSQL-only gate and real handler integration`.
2. Publicar somente no serviço Railway Staging existente quando 4/4 forem `SUCCESS` no commit de integração.
3. Confirmar healthcheck / migração / commit digest e testar páginas com dados autorizados em desktop, tablet e celular.
4. **NÃO promover para produção** sem homologação autenticada e auditoria das nove alterações antigas de configuração, inclusive `DATABASE_URL`, com plano de rollback e backup restaurável.

O release de produção exige evidência de comportamento, não apenas build verde.
