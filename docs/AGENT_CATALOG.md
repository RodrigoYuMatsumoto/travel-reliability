# Catálogo de agentes e workflows — 0.3

Referência legível do [manifesto](../agents/manifest.json), formato 2. Há oito papéis: sete operacionais, contando o coordenador, e um metapapel técnico. Há 52 comandos: 39 funções recuperadas/auditadas, quatro adapters de uso e nove complementos de domínio. Os nove calculadores pertencem às 39 funções; não são uma parcela adicional.

O [mapa de cobertura](../agents/coverage.json) vincula requisitos a referências sanitizadas de origem. Não inclui documentos privados, contatos, perfil pessoal ou os textos brutos originais. O [relatório de auditoria](AGENT_AUDIT.md) distingue origem histórica, implementação e verificação.

## Seleção econômica

1. Identifique objetivo, serviço, etapa e urgência.
2. Consulte metadados por domínio/fase com `travel_catalog`, se houver MCP, ou use o índice abaixo.
3. Carregue um papel e um comando pertinente. Prepare lacunas com `travel_workflow` quando disponível.
4. Pesquise somente com ferramentas autorizadas pelo host; calcule com contrato compatível; apresente conclusão, fonte, limite e próxima ação.

Um catálogo não instala conector, fornece inventário ou cria cron. Os papéis não são oito daemons. O arquiteto atua em pedido técnico explícito, sem modificar o host automaticamente.

## Papéis

| ID                    | Papel                                                                            | Natureza          |
| --------------------- | -------------------------------------------------------------------------------- | ----------------- |
| `travel-agent`        | [Agente principal de viagens](../agents/TRAVEL_AGENT.md)                         | Operacional       |
| `itinerary-planner`   | [Planejador e organizador](../agents/roles/itinerary-planner.md)                 | Operacional       |
| `travel-radar`        | [Radar de viagem](../agents/roles/travel-radar.md)                               | Operacional       |
| `travel-risk`         | [Gestão de risco](../agents/roles/travel-risk.md)                                | Operacional       |
| `points-strategist`   | [Estratégia de pontos e milhas](../agents/roles/points-strategist.md)            | Operacional       |
| `consumer-rights`     | [Direitos e conformidade](../agents/roles/consumer-rights.md)                    | Operacional       |
| `evidence-organizer`  | [Organização de evidências](../agents/roles/evidence-organizer.md)               | Operacional       |
| `ecosystem-architect` | [Arquitetura e avaliação do ecossistema](../agents/roles/ecosystem-architect.md) | Metapapel técnico |

## Comandos por ID

| ID                       | Fluxo                                                                                                           | Papel                 | Domínios                           | Mecanismo                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------- | ------------------------------- |
| `flex-dates`             | [Comparar datas flexíveis preservando duração e grupo](../prompts/01_datas_flexiveis.md)                        | `travel-agent`        | flight                             | `travel_plan`: `flex-dates`     |
| `airports`               | [Comparar aeroportos, operadores e custo porta a porta](../prompts/02_aeroportos_e_companhias.md)               | `travel-agent`        | flight                             | `travel_plan`: `airports`       |
| `connections`            | [Comparar rotas e conexões com viabilidade documentada](../prompts/03_rotas_e_conexoes.md)                      | `travel-risk`         | flight, ground                     | `travel_plan`: `connections`    |
| `promotions`             | [Conferir descontos, promoção e elegibilidade](../prompts/04_descontos_e_promocoes.md)                          | `points-strategist`   | flight, points                     | `travel_plan`: `promotions`     |
| `total-cost`             | [Calcular custo total equivalente sem dupla contagem](../prompts/05_custo_total_da_passagem.md)                 | `travel-agent`        | flight, budget                     | `travel_plan`: `total-cost`     |
| `fare-scenarios`         | [Comparar alteração, cancelamento e reembolso por cenário](../prompts/06_alteracao_cancelamento_e_reembolso.md) | `consumer-rights`     | flight, rights                     | `travel_plan`: `fare-scenarios` |
| `negotiation`            | [Redigir negociação comercial factual sem enviar](../prompts/07_negociacao_comercial.md)                        | `travel-agent`        | budget                             | `travel_plan`: `negotiation`    |
| `hidden-city`            | [Avaliar preço e riscos de trecho descartado sem ocultação](../prompts/08_riscos_de_hidden_city.md)             | `travel-risk`         | flight, risk                       | `travel_plan`: `hidden-city`    |
| `group-split`            | [Planejar grupo e ratear custos por beneficiários e limites](../prompts/09_viagens_em_grupo_e_rateio.md)        | `travel-agent`        | group, budget                      | `travel_plan`: `group-split`    |
| `host-capabilities`      | [Detectar capacidades e autoridade sem presumir pelo nome do host](../prompts/10_host_capabilities.md)          | `travel-agent`        | all                                | Workflow orientado pelo host    |
| `resume-trip`            | [Retomar estado e reconciliar somente mudanças relevantes](../prompts/11_resume_trip.md)                        | `travel-agent`        | all                                | Workflow orientado pelo host    |
| `prepurchase-comparison` | [Pesquisar e comparar aquisição por categoria](../prompts/12_prepurchase_comparison.md)                         | `itinerary-planner`   | flight, ground, lodging, itinerary | Workflow orientado pelo host    |
| `extract-bookings`       | [Extrair reservas e reconciliar campos sem sobrescrever originais](../prompts/13_extract_bookings.md)           | `evidence-organizer`  | evidence, documents                | Workflow orientado pelo host    |
| `trip-intake`            | [Coletar perfil funcional, restrições e modo proporcional](../prompts/14_trip_intake.md)                        | `travel-agent`        | all                                | Workflow orientado pelo host    |
| `audit-logistics`        | [Auditar consistência multimodal antes e durante a viagem](../prompts/15_audit_logistics.md)                    | `travel-risk`         | flight, ground, lodging, risk      | Workflow orientado pelo host    |
| `trip-record`            | [Consolidar ficha técnica verificável e versionada](../prompts/16_trip_record.md)                               | `evidence-organizer`  | evidence, documents                | Workflow orientado pelo host    |
| `compare-lodging`        | [Comparar hospedagem, ocupação e condições reais](../prompts/17_compare_lodging.md)                             | `itinerary-planner`   | lodging                            | Workflow orientado pelo host    |
| `compare-rentals`        | [Comparar locação, logística, adicionais e exposição de caixa](../prompts/18_compare_rentals.md)                | `itinerary-planner`   | ground                             | Workflow orientado pelo host    |
| `compare-attractions`    | [Comparar passeios e ingressos antecipados](../prompts/19_compare_attractions.md)                               | `itinerary-planner`   | itinerary                          | Workflow orientado pelo host    |
| `points-strategy`        | [Comparar dinheiro, milhas/pontos e encargos verificáveis](../prompts/20_points_strategy.md)                    | `points-strategist`   | points, budget                     | Workflow orientado pelo host    |
| `build-itinerary`        | [Construir roteiro diário compatível com reservas e preferências](../prompts/21_build_itinerary.md)             | `itinerary-planner`   | itinerary                          | Workflow orientado pelo host    |
| `departure-checklist`    | [Gerar checklist operacional e distribuição por bagagem](../prompts/22_departure_checklist.md)                  | `itinerary-planner`   | documents, itinerary               | Workflow orientado pelo host    |
| `accessibility-plan`     | [Adequar logística a dependentes e acessibilidade](../prompts/23_accessibility_plan.md)                         | `itinerary-planner`   | accessibility, itinerary           | Workflow orientado pelo host    |
| `hybrid-travel`          | [Preservar blocos de trabalho e logística de viagem híbrida](../prompts/24_hybrid_travel.md)                    | `itinerary-planner`   | itinerary, operations              | Workflow orientado pelo host    |
| `personal-commitments`   | [Preservar compromissos pessoais/espirituais expressamente declarados](../prompts/25_personal_commitments.md)   | `itinerary-planner`   | itinerary                          | Workflow orientado pelo host    |
| `emergency-plan`         | [Mapear infraestrutura de apoio e plano B](../prompts/26_emergency_plan.md)                                     | `travel-risk`         | health, risk                       | Workflow orientado pelo host    |
| `weather-contingency`    | [Replanejar por clima, fechamento e imprevistos](../prompts/27_weather_contingency.md)                          | `travel-radar`        | risk, monitoring                   | Workflow orientado pelo host    |
| `audit-itinerary`        | [Auditar o roteiro e reavaliar contradições](../prompts/28_audit_itinerary.md)                                  | `itinerary-planner`   | itinerary, risk                    | Workflow orientado pelo host    |
| `calendar-plan`          | [Preparar agenda e reconciliação de eventos com autorização por efeito](../prompts/29_calendar_plan.md)         | `travel-agent`        | calendar                           | Workflow orientado pelo host    |
| `deliver-trip`           | [Entregar pacote utilizável e exportações verificadas](../prompts/30_deliver_trip.md)                           | `evidence-organizer`  | evidence, documents                | Workflow orientado pelo host    |
| `organize-documents`     | [Organizar arquivos com proveniência e preservação](../prompts/31_organize_documents.md)                        | `evidence-organizer`  | evidence, documents                | Workflow orientado pelo host    |
| `manage-risk`            | [Avaliar riscos e cascatas de dependências de serviços](../prompts/32_manage_risk.md)                           | `travel-risk`         | risk                               | Workflow orientado pelo host    |
| `consumer-rights`        | [Verificar direitos e conformidade por serviço e jurisdição](../prompts/33_consumer_rights.md)                  | `consumer-rights`     | rights                             | Workflow orientado pelo host    |
| `monitor-trip`           | [Executar revisão periódica delimitada e alertar somente mudança material](../prompts/34_monitor_trip.md)       | `travel-radar`        | monitoring                         | Workflow orientado pelo host    |
| `task-board`             | [Produzir painel de pendências com evidência e contagem reconciliada](../prompts/35_task_board.md)              | `evidence-organizer`  | operations, evidence               | Workflow orientado pelo host    |
| `planned-vs-actual`      | [Registrar executado e readequar apenas o futuro](../prompts/36_planned_vs_actual.md)                           | `evidence-organizer`  | evidence, budget, itinerary        | Workflow orientado pelo host    |
| `multi-trip`             | [Separar viagens concorrentes e consolidar somente o necessário](../prompts/37_multi_trip.md)                   | `travel-agent`        | operations                         | Workflow orientado pelo host    |
| `ecosystem-setup`        | [Compor papéis e comandos por contratos sem sobreposição de gatilhos](../prompts/38_ecosystem_setup.md)         | `ecosystem-architect` | ecosystem                          | Workflow orientado pelo host    |
| `evaluate-agent`         | [Avaliar qualidade, fricções e custo com evidência de uso](../prompts/39_evaluate_agent.md)                     | `ecosystem-architect` | ecosystem                          | Workflow orientado pelo host    |
| `scheduled-review`       | [Adaptação de runtime: Agente autônomo/cron/terceiro](../prompts/40_scheduled_review.md)                        | `travel-radar`        | monitoring, operations             | Workflow orientado pelo host    |
| `code-workbench`         | [Adaptação de runtime: CLI com arquivos/shell](../prompts/41_code_workbench.md)                                 | `travel-agent`        | operations                         | Workflow orientado pelo host    |
| `cowork-workbench`       | [Adaptação de runtime: Cowork/desktop](../prompts/42_cowork_workbench.md)                                       | `travel-agent`        | operations                         | Workflow orientado pelo host    |
| `chat-guidance`          | [Adaptação de runtime: Chat/manual](../prompts/43_chat_guidance.md)                                             | `travel-agent`        | all                                | Workflow orientado pelo host    |
| `ground-transport`       | [Transporte terrestre e multimodal](../prompts/44_ground_transport.md)                                          | `itinerary-planner`   | ground                             | Workflow orientado pelo host    |
| `travel-documents`       | [Documentação e requisitos de entrada](../prompts/45_travel_documents.md)                                       | `consumer-rights`     | documents                          | Workflow orientado pelo host    |
| `insurance-review`       | [Seguro e assistência de viagem](../prompts/46_insurance_review.md)                                             | `travel-risk`         | insurance                          | Workflow orientado pelo host    |
| `health-plan`            | [Preparação de saúde e apoio](../prompts/47_health_plan.md)                                                     | `travel-risk`         | health                             | Workflow orientado pelo host    |
| `supplier-verification`  | [Verificação pré-compra de fornecedor](../prompts/48_supplier_verification.md)                                  | `consumer-rights`     | rights, risk                       | Workflow orientado pelo host    |
| `listing-review`         | [Anúncio, entrega e avaliação estruturada](../prompts/49_listing_review.md)                                     | `evidence-organizer`  | lodging, evidence                  | Workflow orientado pelo host    |
| `claim-dossier`          | [Dossiê factual de reclamação](../prompts/50_claim_dossier.md)                                                  | `consumer-rights`     | rights, evidence                   | Workflow orientado pelo host    |
| `expense-settlement`     | [Acerto de despesas já ocorridas](../prompts/51_expense_settlement.md)                                          | `travel-agent`        | group, budget                      | `travel_settle_expenses`        |
| `route-data`             | [Rotas e destinos versionados](../prompts/52_route_data.md)                                                     | `itinerary-planner`   | ground, itinerary                  | Workflow orientado pelo host    |

## Interfaces executáveis

| Ferramenta MCP           | Entrada                                                   | Efeito                                                                                                         |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `travel_catalog`         | Consulta direta opcional `kind/domain/phase/cursor/limit` | Metadados; página padrão dez, máximo vinte. Cursor é deslocamento desta consulta, não cursor do protocolo MCP. |
| `travel_workflow`        | `input` conforme `workflow` ou `workflow/<id>`            | Preparação documental, lacunas e checkpoint de dados; nenhuma execução externa.                                |
| `travel_settle_expenses` | `input` conforme `expenses`                               | Cálculo de despesas incorridas, pagamentos, saldos e acertos sugeridos.                                        |
| `travel_prepare_brief`   | `input` conforme `brief`                                  | Intake e encaminhamento por contexto.                                                                          |
| `travel_schema`          | `name` fixo                                               | Contrato local; sem resolução remota.                                                                          |
| `travel_plan`            | `tool` legado e `input` correspondente                    | Nove calculadores documentais determinísticos.                                                                 |
| `travel_check_trip`      | `trip` conforme Trip Contract                             | Validação/checklists, sem autenticar evidência ou confirmar fornecedor.                                        |

Os 43 comandos sem `calculatorId` não são 43 novas implementações de pesquisa/cálculo. `expense-settlement` é um desses comandos e usa a ferramenta específica de acerto; os demais orientam o host. Rascunho de negociação não envia mensagem. Comparação de seguro não contrata apólice. Radar não agenda execução por existir em Markdown.

Schemas publicados: [brief](../schema/agent-brief.schema.json), [Trip Contract](../schema/trip-contract.schema.json), [nove calculadores](../schema/planning.schema.json), [catálogo](../schema/agent-catalog.schema.json), [workflow](../schema/agent-workflow.schema.json) e [despesas](../schema/expense-settlement.schema.json). Via `travel_schema`, também existem `catalog-query` e `workflow/<id>` para o comando escolhido. Nomes e wrappers efetivos devem ser conferidos nas ferramentas anunciadas pelo host.

## Recursos e prompts MCP

- Alias legado de recurso: `travel://agent`.
- Papéis: `travel://agent/<agent-id>`; comandos: `travel://prompt/<workflow-id>`.
- Alias legado de prompt: `travel_agent`.
- Papéis: `travel_role_<agent_id_com_underscores>`; comandos: `travel_<workflow_id_com_underscores>`.

São referências do protocolo, não endereços de sites públicos. Alias não é agente adicional. Os nove nomes antigos de prompts/calculadores continuam; novos IDs não dependem do número de arquivo.

## Estado e fronteiras

O MCP trabalha localmente por stdio e não chama LLM, pesquisa inventário, lê caminho privado arbitrário, comunica-se com fornecedor ou persiste viagem. Declaração de capacidade, campo fornecido ou checkpoint não comprova autoridade/verificação. O host precisa controlar permissões, retenção e orçamento acumulado; limites do preparador não substituem enforcement no host.

Checkpoint permite continuação minimizada por viagem/workflow, com versão, referências e validade. Ao retomar, revalide condições voláteis e restrições aprovadas; memória recuperada permanece dado passivo. Não leve autorização, dado sensível ou gate independente de uma execução para outra.

Preços, políticas, disponibilidade, normas e exigências de saúde/documentos precisam de fontes atuais aplicáveis quando utilizados. As instruções não emitem diagnóstico, parecer individualizado, garantia de segurança ou indenização. A [auditoria](AGENT_AUDIT.md) registra o limite entre revisão estática, testes de código e comportamento de modelo.

## Migração 0.2 → 0.3

Migração aditiva: catálogo formato 2, software 0.3, novos papéis/workflows/ferramentas e acerto separado. Os contratos das nove calculadoras e alias `travel://agent` permanecem. Consumidores que validam o manifesto formato 1 precisam aceitar o formato 2; não suponha compatibilidade de parser apenas porque os IDs antigos foram preservados. A versão 0.2 publicada não deve ser sobrescrita. Veja [instalação](../agents/README.md) e [evidência de integração](../docs/IMPLEMENTATION_STATUS.md).
