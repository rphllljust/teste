# CISNE ERP — contrato de transformação global Tier 1

**Referência:** SAP Fiori floorplans (List Report, Object Page, Flexible Column Layout), Microsoft Fluent 2, Oracle Redwood / Oracle JET.

**Situação:** candidata, sem aprovação ou implantação automática. Esta especificação não certifica homologação.

## Fonte oficial e licenças

- SAP Fiori (estrutura e composição): https://www.sap.com/design-system/fiori-design-web/v1-120/page-types/floorplans/when-to-use-which-floorplan
- UI5 Web Components (Apache-2.0): https://github.com/UI5/webcomponents
- Microsoft Fluent UI React (MIT): https://github.com/microsoft/fluentui
- Microsoft Fluent 2: https://fluent2.microsoft.design/
- Oracle JET (UPL-1.0): https://github.com/oracle/oraclejet
- Oracle Redwood / JET: https://docs.oracle.com/en/middleware/developer-tools/jet/19/develop/use-css-themes-oracle-jet-apps.html

Não copiar código, ícones sujeitos a licença própria, imagens, CSS proprietário, marcas ou ativos de produtos fechados (SAP S/4HANA, Oracle Fusion Cloud, Microsoft Dynamics 365). Documentação de design inspira composição; dependências abertas exigem licença e notices. Não instalar frameworks duplicados sem matriz de compatibilidade, performance, bundle e SSR React 19 / Vinext.

## Diagnóstico observado na homologação 21/11/2026

Capturas de Ordens de serviço, Centro de operações e Visão operacional mostram headers e controles corporativos parcialmente adotados, mas falta uma experiência integrada de processo. A fila retorna mensagem de credencial autorizada e o dashboard pode ficar sem dados. **401/403 não são prova de fila vazia ou módulo aprovado.** Nunca contornar login, falsificar dados ou divulgar segredos.

## Arquitetura obrigatória

1. **Visão de tarefas (Overview):** exceções auditáveis, prioridades com dados autorizados, links para filas efetivas e estados de indisponibilidade explícitos.
2. **List Report / Worklist:** título e comandos, filtros relacionados à API, ordenação/paginação do servidor, registros compactos sem perda de identidade e ações no mobile, vazio vs erro vs não autorizado distintos.
3. **Object Page:** identidade do registro, estado empresarial real, fatos relevantes, links para entidades de origem/destino, seções ancoradas, histórico e comandos autorizados com versão do registro; nunca drawer como único detalhe.
4. **Master/detail:** painel de lista e contexto adaptável conforme viewport. Não perder informação no mobile nem inventar atualização automática.
5. **Processos ponta a ponta:** Cliente → Proposta → Pedido do cliente → Contrato → OS → Execução → Medição → Faturamento → Financeiro → Fiscal → Contabilidade; quando uma integração não existir, mostrar sua indisponibilidade em vez de sucesso simulado.
6. **Comandos:** nunca criar, editar, aprovar, estornar, liquidar ou faturar sem permissões, validação, controle transacional, owner scope e disponibilidade reais.
7. **Design system:** conservar Fluent Provider, componentes tipados e tokens; cor/spacing sem precedência caótica; evitar estilos globais que destroem variações dos módulos.
8. **Navegação empresarial:** domínios operacionais, relacionamento, recursos, finanças, suprimentos e fiscal/contabilidade; contexto cruzado por destinos existentes, sem links mortos.
9. **Acessibilidade:** navegação por teclado, foco visível, labels reais, landmarks sem duplicação, WCAG 2.1 AA, reflow 320px, 390px, 834px, 1440px; não usar click({force:true}) ou evaluate(element.click()) para fabricar êxito.
10. **Internacionalização:** português brasileiro; datas, números, moedas, status e semântica financeira coerentes.

## Matriz de aceite / DoD obrigatória

- Registrar todos os workspaces descobertos pela fonte, agrupá-los por floorplan e validar cada um nas larguras desktop, tablet e mobile.
- Para cada alteração: evidência do arquivo e diff, teste unitário/contrato, TypeScript, lint, build Vinext, Playwright real, screenshots antes/depois, a11y e testes de fluxos de erro e não autorizado.
- Gateway *mocked synthetic* valida renderização e somente isso; teste autenticado em Railway com dados reais e escopo autorizado exige credencial de staging dedicada e autorização. Distinguir browser test de aceitação de negócio.
- Páginas de dados financeiros/contábeis, faturamento e operações exigem owner scope, logs de auditoria, invariantes de status, rowVersion e integração PostgreSQL com rollback.
- Não modificar schemas, migrations nem contratos de API em uma alteração cosmética; não adicionar dependência pesada sem avaliar licença, suporte, bundle e custo SSR.
- Gates no SHA exato, ancestralidade, base atual, build, E2E, staging digest e aceite empresarial são independentes; qualquer evidência ausente = **NO-GO**.
- Não fazer merge forçado, desabilitar testes, reclassificar failures como skips, mudar thresholds ou afirmar implantação sem verificar release identity.

## Implementação desta primeira onda

- Agrupamento explícito dos 26 destinos por domínios com rótulos preexistentes e sem remoção de operações.
- Barra compartilhada de navegação contextual, com três destinos operacionais reais por workspace.
- Centro de operações com filtro de busca + visão + categoria + ordenação em um painel coeso com labels visíveis.
- CSS responsivo para a barra de contexto e filtros; preservação das ações e consultas originais.
- Testes de contrato de integridade dos 26 destinos e de navegação no Playwright.

**Ainda não implementado integralmente:** floorplan List Report + Object Page e fluxos autenticados/aceitos em todos os módulos. Este arquivo é uma diretriz de continuidade, não um certificado Tier 1.
