# Catálogo internacional de agentes e workflows — 0.4

O [manifesto](../agents/manifest.json), formato 3, define **onze papéis e 66
comandos**. Dez papéis são operacionais, contando o coordenador; o arquiteto é
um metapapel técnico acionado por pedido explícito. Papéis roteados não são
processos instalados nem daemons.

Os 52 comandos anteriores permanecem: 39 funções recuperadas, quatro adapters
de uso e nove complementos de domínio. Os catorze novos comandos ampliam a
agência para escalas locais, intermunicipais, entre divisões administrativas,
nacionais e internacionais, múltiplas finalidades e modalidades. Não há país
prioritário. Os nove calculadores são parte das 39 funções, sem dupla contagem.

A [cobertura](../agents/coverage.json) publica funções e IDs opacos de fontes.
Nomes, caminhos, hashes, trechos e linhas dos materiais privados de origem não
integram essa projeção. Isso não remove versões anteriormente publicadas.

## Seleção proporcional

1. Identifique finalidade, serviço, etapa, urgência e restrições materiais.
2. Consulte `travel_catalog` por domínio/fase quando disponível, ou o índice.
3. Carregue um papel/comando e somente o schema necessário. A ferramenta
   `travel_workflow` prepara as entradas, não executa a função de viagem.
4. Use capacidade real do host ou executor anunciado, respeitando configuração
   do operador e autorização específica para qualquer efeito.
5. Retorne resultado, fontes/validade, conflitos, lacunas e próxima decisão.

## Papéis

| ID                       | Papel                                                                                   | Natureza          |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------- |
| `travel-agent`           | [Agente principal de viagens](../agents/TRAVEL_AGENT.md)                                | Operacional       |
| `itinerary-planner`      | [Planejador e organizador](../agents/roles/itinerary-planner.md)                        | Operacional       |
| `travel-radar`           | [Radar de viagem](../agents/roles/travel-radar.md)                                      | Operacional       |
| `travel-risk`            | [Gestão de risco](../agents/roles/travel-risk.md)                                       | Operacional       |
| `points-strategist`      | [Estratégia de pontos e milhas](../agents/roles/points-strategist.md)                   | Operacional       |
| `consumer-rights`        | [Direitos e conformidade](../agents/roles/consumer-rights.md)                           | Operacional       |
| `evidence-organizer`     | [Organização de evidências](../agents/roles/evidence-organizer.md)                      | Operacional       |
| `ecosystem-architect`    | [Arquitetura e avaliação do ecossistema](../agents/roles/ecosystem-architect.md)        | Metapapel técnico |
| `destination-researcher` | [Pesquisa de destinos, geografia e cultura](../agents/roles/destination-researcher.md)  | Operacional       |
| `corporate-travel`       | [Viagens profissionais e negociação](../agents/roles/corporate-travel.md)               | Operacional       |
| `travel-data-integrator` | [Integração de fontes e workspace de viagem](../agents/roles/travel-data-integrator.md) | Operacional       |

## Comandos e responsabilidades

| ID                         | Fluxo                                                                                                           | Papel                    | Domínios                           | Mecanismo                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ----------------------------------------- |
| `flex-dates`               | [Comparar datas flexíveis preservando duração e grupo](../prompts/01_datas_flexiveis.md)                        | `travel-agent`           | flight                             | `travel_plan`: `flex-dates`               |
| `airports`                 | [Comparar aeroportos, operadores e custo porta a porta](../prompts/02_aeroportos_e_companhias.md)               | `travel-agent`           | flight                             | `travel_plan`: `airports`                 |
| `connections`              | [Comparar rotas e conexões com viabilidade documentada](../prompts/03_rotas_e_conexoes.md)                      | `travel-risk`            | flight, ground                     | `travel_plan`: `connections`              |
| `promotions`               | [Conferir descontos, promoção e elegibilidade](../prompts/04_descontos_e_promocoes.md)                          | `points-strategist`      | flight, points                     | `travel_plan`: `promotions`               |
| `total-cost`               | [Calcular custo total equivalente sem dupla contagem](../prompts/05_custo_total_da_passagem.md)                 | `travel-agent`           | flight, budget                     | `travel_plan`: `total-cost`               |
| `fare-scenarios`           | [Comparar alteração, cancelamento e reembolso por cenário](../prompts/06_alteracao_cancelamento_e_reembolso.md) | `consumer-rights`        | flight, rights                     | `travel_plan`: `fare-scenarios`           |
| `negotiation`              | [Redigir negociação comercial factual sem enviar](../prompts/07_negociacao_comercial.md)                        | `travel-agent`           | budget                             | `travel_plan`: `negotiation`              |
| `hidden-city`              | [Avaliar preço e riscos de trecho descartado sem ocultação](../prompts/08_riscos_de_hidden_city.md)             | `travel-risk`            | flight, risk                       | `travel_plan`: `hidden-city`              |
| `group-split`              | [Planejar grupo e ratear custos por beneficiários e limites](../prompts/09_viagens_em_grupo_e_rateio.md)        | `travel-agent`           | group, budget                      | `travel_plan`: `group-split`              |
| `host-capabilities`        | [Detectar capacidades e autoridade sem presumir pelo nome do host](../prompts/10_host_capabilities.md)          | `travel-agent`           | all                                | Workflow do host; sem execução automática |
| `resume-trip`              | [Retomar estado e reconciliar somente mudanças relevantes](../prompts/11_resume_trip.md)                        | `travel-agent`           | all                                | Workflow do host; sem execução automática |
| `prepurchase-comparison`   | [Pesquisar e comparar aquisição por categoria](../prompts/12_prepurchase_comparison.md)                         | `itinerary-planner`      | flight, ground, lodging, itinerary | Workflow do host; sem execução automática |
| `extract-bookings`         | [Extrair reservas e reconciliar campos sem sobrescrever originais](../prompts/13_extract_bookings.md)           | `evidence-organizer`     | evidence, documents                | Workflow do host; sem execução automática |
| `trip-intake`              | [Coletar perfil funcional, restrições e modo proporcional](../prompts/14_trip_intake.md)                        | `travel-agent`           | all                                | Workflow do host; sem execução automática |
| `audit-logistics`          | [Auditar consistência multimodal antes e durante a viagem](../prompts/15_audit_logistics.md)                    | `travel-risk`            | flight, ground, lodging, risk      | Workflow do host; sem execução automática |
| `trip-record`              | [Consolidar ficha técnica verificável e versionada](../prompts/16_trip_record.md)                               | `evidence-organizer`     | evidence, documents                | Workflow do host; sem execução automática |
| `compare-lodging`          | [Comparar hospedagem, ocupação e condições reais](../prompts/17_compare_lodging.md)                             | `itinerary-planner`      | lodging                            | Workflow do host; sem execução automática |
| `compare-rentals`          | [Comparar locação, logística, adicionais e exposição de caixa](../prompts/18_compare_rentals.md)                | `itinerary-planner`      | ground                             | Workflow do host; sem execução automática |
| `compare-attractions`      | [Comparar passeios e ingressos antecipados](../prompts/19_compare_attractions.md)                               | `itinerary-planner`      | itinerary                          | Workflow do host; sem execução automática |
| `points-strategy`          | [Comparar dinheiro, milhas/pontos e encargos verificáveis](../prompts/20_points_strategy.md)                    | `points-strategist`      | points, budget                     | Workflow do host; sem execução automática |
| `build-itinerary`          | [Construir roteiro diário compatível com reservas e preferências](../prompts/21_build_itinerary.md)             | `itinerary-planner`      | itinerary                          | Workflow do host; sem execução automática |
| `departure-checklist`      | [Gerar checklist operacional e distribuição por bagagem](../prompts/22_departure_checklist.md)                  | `itinerary-planner`      | documents, itinerary               | Workflow do host; sem execução automática |
| `accessibility-plan`       | [Adequar logística a dependentes e acessibilidade](../prompts/23_accessibility_plan.md)                         | `itinerary-planner`      | accessibility, itinerary           | Workflow do host; sem execução automática |
| `hybrid-travel`            | [Preservar blocos de trabalho e logística de viagem híbrida](../prompts/24_hybrid_travel.md)                    | `itinerary-planner`      | itinerary, operations              | Workflow do host; sem execução automática |
| `personal-commitments`     | [Preservar compromissos pessoais/espirituais expressamente declarados](../prompts/25_personal_commitments.md)   | `itinerary-planner`      | itinerary                          | Workflow do host; sem execução automática |
| `emergency-plan`           | [Mapear infraestrutura de apoio e plano B](../prompts/26_emergency_plan.md)                                     | `travel-risk`            | health, risk                       | Workflow do host; sem execução automática |
| `weather-contingency`      | [Replanejar por clima, fechamento e imprevistos](../prompts/27_weather_contingency.md)                          | `travel-radar`           | risk, monitoring                   | Workflow do host; sem execução automática |
| `audit-itinerary`          | [Auditar o roteiro e reavaliar contradições](../prompts/28_audit_itinerary.md)                                  | `itinerary-planner`      | itinerary, risk                    | Workflow do host; sem execução automática |
| `calendar-plan`            | [Preparar agenda e reconciliação de eventos com autorização por efeito](../prompts/29_calendar_plan.md)         | `travel-agent`           | calendar                           | Workflow do host; sem execução automática |
| `deliver-trip`             | [Entregar pacote utilizável e exportações verificadas](../prompts/30_deliver_trip.md)                           | `evidence-organizer`     | evidence, documents                | Workflow do host; sem execução automática |
| `organize-documents`       | [Organizar arquivos com proveniência e preservação](../prompts/31_organize_documents.md)                        | `evidence-organizer`     | evidence, documents                | Workflow do host; sem execução automática |
| `manage-risk`              | [Avaliar riscos e cascatas de dependências de serviços](../prompts/32_manage_risk.md)                           | `travel-risk`            | risk                               | Workflow do host; sem execução automática |
| `consumer-rights`          | [Verificar direitos e conformidade por serviço e jurisdição](../prompts/33_consumer_rights.md)                  | `consumer-rights`        | rights                             | Workflow do host; sem execução automática |
| `monitor-trip`             | [Executar revisão periódica delimitada e alertar somente mudança material](../prompts/34_monitor_trip.md)       | `travel-radar`           | monitoring                         | Workflow do host; sem execução automática |
| `task-board`               | [Produzir painel de pendências com evidência e contagem reconciliada](../prompts/35_task_board.md)              | `evidence-organizer`     | operations, evidence               | Workflow do host; sem execução automática |
| `planned-vs-actual`        | [Registrar executado e readequar apenas o futuro](../prompts/36_planned_vs_actual.md)                           | `evidence-organizer`     | evidence, budget, itinerary        | Workflow do host; sem execução automática |
| `multi-trip`               | [Separar viagens concorrentes e consolidar somente o necessário](../prompts/37_multi_trip.md)                   | `travel-agent`           | operations                         | Workflow do host; sem execução automática |
| `ecosystem-setup`          | [Compor papéis e comandos por contratos sem sobreposição de gatilhos](../prompts/38_ecosystem_setup.md)         | `ecosystem-architect`    | ecosystem                          | Workflow do host; sem execução automática |
| `evaluate-agent`           | [Avaliar qualidade, fricções e custo com evidência de uso](../prompts/39_evaluate_agent.md)                     | `ecosystem-architect`    | ecosystem                          | Workflow do host; sem execução automática |
| `scheduled-review`         | [Adaptação de runtime: Agente autônomo/cron/terceiro](../prompts/40_scheduled_review.md)                        | `travel-radar`           | monitoring, operations             | Workflow do host; sem execução automática |
| `code-workbench`           | [Adaptação de runtime: CLI com arquivos/shell](../prompts/41_code_workbench.md)                                 | `travel-agent`           | operations                         | Workflow do host; sem execução automática |
| `cowork-workbench`         | [Adaptação de runtime: Cowork/desktop](../prompts/42_cowork_workbench.md)                                       | `travel-agent`           | operations                         | Workflow do host; sem execução automática |
| `chat-guidance`            | [Adaptação de runtime: Chat/manual](../prompts/43_chat_guidance.md)                                             | `travel-agent`           | all                                | Workflow do host; sem execução automática |
| `ground-transport`         | [Transporte terrestre e multimodal](../prompts/44_ground_transport.md)                                          | `itinerary-planner`      | ground                             | Workflow do host; sem execução automática |
| `travel-documents`         | [Documentação e requisitos de entrada](../prompts/45_travel_documents.md)                                       | `consumer-rights`        | documents                          | Workflow do host; sem execução automática |
| `insurance-review`         | [Seguro e assistência de viagem](../prompts/46_insurance_review.md)                                             | `travel-risk`            | insurance                          | Workflow do host; sem execução automática |
| `health-plan`              | [Preparação de saúde e apoio](../prompts/47_health_plan.md)                                                     | `travel-risk`            | health                             | Workflow do host; sem execução automática |
| `supplier-verification`    | [Verificação pré-compra de fornecedor](../prompts/48_supplier_verification.md)                                  | `consumer-rights`        | rights, risk                       | Workflow do host; sem execução automática |
| `listing-review`           | [Anúncio, entrega e avaliação estruturada](../prompts/49_listing_review.md)                                     | `evidence-organizer`     | lodging, evidence                  | Workflow do host; sem execução automática |
| `claim-dossier`            | [Dossiê factual de reclamação](../prompts/50_claim_dossier.md)                                                  | `consumer-rights`        | rights, evidence                   | Workflow do host; sem execução automática |
| `expense-settlement`       | [Acerto de despesas já ocorridas](../prompts/51_expense_settlement.md)                                          | `travel-agent`           | group, budget                      | `travel_settle_expenses`                  |
| `route-data`               | [Rotas e destinos versionados](../prompts/52_route_data.md)                                                     | `itinerary-planner`      | ground, itinerary                  | Workflow do host; sem execução automática |
| `global-context`           | [Contexto internacional e escala da viagem](../prompts/53_global_context.md)                                    | `travel-agent`           | all                                | Workflow do host; sem execução automática |
| `geography-route-check`    | [Verificar geografia, acesso e coerência de rotas](../prompts/54_geography_route_check.md)                      | `destination-researcher` | geography, itinerary, ground       | Workflow do host; sem execução automática |
| `history-culture-context`  | [Contextualizar história, patrimônio e cultura](../prompts/55_history_culture_context.md)                       | `destination-researcher` | culture, geography, itinerary      | Workflow do host; sem execução automática |
| `local-customs-etiquette`  | [Costumes locais e convivência respeitosa](../prompts/56_local_customs_etiquette.md)                            | `destination-researcher` | culture, business, itinerary       | Workflow do host; sem execução automática |
| `professional-trip-plan`   | [Planejar viagem profissional e agenda de trabalho](../prompts/57_professional_trip_plan.md)                    | `corporate-travel`       | business, operations, itinerary    | Workflow do host; sem execução automática |
| `business-negotiation`     | [Preparar negociação em viagem profissional](../prompts/58_business_negotiation.md)                             | `corporate-travel`       | business, budget, culture          | Workflow do host; sem execução automática |
| `reconcile-reservations`   | [Cruzar reservas, e-mails, vouchers e contas](../prompts/59_reconcile_reservations.md)                          | `travel-data-integrator` | connectors, documents, evidence    | Workflow do host; sem execução automática |
| `connect-account-sources`  | [Conectar fontes autorizadas de e-mail e fornecedores](../prompts/60_connect_account_sources.md)                | `travel-data-integrator` | connectors, ecosystem, evidence    | Workflow do host; sem execução automática |
| `document-workspace-plan`  | [Planejar organização e renomeação de documentos](../prompts/61_document_workspace_plan.md)                     | `travel-data-integrator` | documents, operations, evidence    | Workflow do host; sem execução automática |
| `document-workspace-apply` | [Aplicar e verificar organização documental autorizada](../prompts/62_document_workspace_apply.md)              | `travel-data-integrator` | documents, operations, evidence    | Workflow do host; sem execução automática |
| `ecosystem-extension`      | [Gerar agentes, prompts e extensões revisáveis](../prompts/63_ecosystem_extension.md)                           | `ecosystem-architect`    | ecosystem                          | Workflow do host; sem execução automática |
| `rail-ferry-cruise-plan`   | [Planejar trem, ferry, cruzeiro e conexões](../prompts/64_rail_ferry_cruise_plan.md)                            | `itinerary-planner`      | rail, water, itinerary             | Workflow do host; sem execução automática |
| `border-entry-plan`        | [Verificar fronteiras, trânsito e finalidade de entrada](../prompts/65_border_entry_plan.md)                    | `consumer-rights`        | entry, documents, health           | Workflow do host; sem execução automática |
| `travel-purpose-plan`      | [Adaptar a agência à finalidade e ao perfil da viagem](../prompts/66_travel_purpose_plan.md)                    | `travel-agent`           | all                                | Workflow do host; sem execução automática |

## Internacionalização e finalidade

Os domínios adicionais são `geography`, `culture`, `business`, `rail`, `water`,
`entry` e `connectors`. Não substituem os anteriores. A finalidade distingue
lazer, negócios, viagem híbrida, estudo, visita, peregrinação, esporte, saúde
logística, mudança ou outra necessidade declarada. Os fluxos pertinentes são
selecionados pelo objetivo, sem exigir viagem aérea ou reserva prévia.

Locale, idioma de resposta, fuso, moeda, unidade e jurisdição são informações
distintas. O host pode traduzir as instruções para o idioma solicitado; mensagens
determinísticas devem declarar o fallback de tradução efetivamente disponível.
Não se presume cobertura normativa universal, requisito de entrada ou API de
fornecedor somente porque há um papel com esse tema.

## Interfaces e autoridade

- Nove calculadores permanecem em `travel_plan`; acerto existente usa a
  ferramenta própria com despesas, beneficiários e transferências anteriores.
- `travel_catalog`, `travel_workflow`, `travel_schema`, `travel_prepare_brief`
  e `travel_check_trip` não instalam agentes nem confirmam reservas.
- Conectores de conta e organização local exigem engine, escopo e configuração
  reais. O catálogo não concede raiz arbitrária, credencial ou autorização.
- Aplicação de plano de arquivos exige prévia, digest/versão e aprovação pelo
  canal confiável do operador. O LLM não autoriza o próprio efeito.
- Geração de extensão produz proposta revisável, sem ativar código, carregar
  módulos ou alterar permissões automaticamente.

O runtime 0.4 anuncia treze tools. `travel_global_context`,
`travel_reconcile_bookings` e `travel_extension_draft` são preparadores/cálculos
locais. `travel_sync_sources` exige registry do operador;
`travel_workspace_inventory` e `travel_workspace_plan` exigem workspace já
vinculado, sem raiz arbitrária em argumentos. Nomes ficam ocultos por padrão.
Não há tool de aplicação, reversão ou instalação. Leia os schemas
`global-context`, `reconciliation`, `connector-request`, `document-workspace`
e `extension-draft` antes das respectivas entradas. O perfil padrão é offline.

Recursos fixos: alias `travel://agent`, onze `travel://agent/<id>` e 66
`travel://prompt/<id>`, totalizando 78. Prompts MCP têm alias `travel_agent`,
`travel_role_<id_com_underscores>` e `travel_<workflow_com_underscores>`. O cliente
pode expor somente parte dessas interfaces; URIs não são URLs HTTP ou caminhos
de arquivos arbitrários.

## Evidência e compatibilidade

O formato passa de 2 para 3, com `defaultLanguage:host`, licença MIT e domínios/papéis
adicionais. Consumidores que fixavam `pt-BR`, Apache-2.0, oito papéis ou 52 comandos
precisam atualizar suas expectativas. Os IDs dos nove calculadores, contratos
legados e aliases de coordenador foram preservados. Uma nova capacidade de
runtime só existe quando anunciada e testada em sua instalação.

A revisão textual não comprova comportamento de toda LLM nem independência de
família arquitetural. Veja [auditoria](AGENT_AUDIT.md) e [segurança](SECURITY_MODEL.md).
Conteúdo original desta versão usa [MIT](../LICENSE); materiais de terceiros e
fontes oficiais mantêm seus próprios termos.
