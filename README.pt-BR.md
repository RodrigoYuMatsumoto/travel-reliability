# Travel Reliability

**Ecossistema de agência de viagens internacional para sua própria LLM: deslocamentos multimodais, custos explícitos, fontes rastreáveis e provas privadas.**

[English](README.md) · [Agente sem instalação](#use-na-sua-ia-sem-instalação) · [Catálogo de comandos](prompts/README.md) · [Auditoria dos agentes](docs/AGENT_AUDIT.md) · [Aplicativo opcional](#aplicativo-local-opcional) · [Segurança](SECURITY.md) · [Cobertura dos testes de segurança](docs/SECURITY_TESTS.md) · [Evidências de entrega](docs/IMPLEMENTATION_STATUS.md)

O ponto de entrada é um **pacote portátil para a LLM que você escolher**. O catálogo da versão candidata 0.6 organiza onze papéis e 69 fluxos para viagens internacionais, nacionais, estaduais, intermunicipais e locais, de lazer ou profissionais. Abrange transporte, hospedagem, geografia, história, cultura, costumes, preparação comercial, seguros, logística de saúde, documentos e rateio. Os papéis são instruções selecionadas, não serviços em segundo plano. Ferramentas determinísticas validam contexto e contratos e cruzam informações; o workspace local organiza arquivos reais mediante plano revisável e autorização específica no CLI.

A versão 0.6 é candidata e ainda não foi publicada. Ela inclui [instalador/atualizador verificado para Codex](docs/INSTALLATION.md#4-codex-complete-skill-nine-shortcuts-and-offline-mcp), [fontes públicas opcionais e alternativas de integração](docs/PUBLIC_SOURCES.md), [benchmark sintético reproduzível](docs/VALIDATION.md) e [verificação dos nove assets da release](docs/PACKAGING.md#complete-nine-asset-release-v06-and-later). O MCP padrão permanece offline, com permissões explícitas.

O agente distingue fatos cotados, condições verificadas e lacunas. Um prompt não fornece acesso à internet ou ao inventário de fornecedores. As ferramentas documentais não inventam disponibilidade nem enviam transações. Compras, cancelamentos e mensagens exigem autorização específica do viajante e capacidade real de execução no host.

Não há país ou fornecedor padrão. Regras específicas permanecem em plugins delimitados; jurisdição sem cobertura não recebe regra inventada. Consulte [contexto internacional](docs/GLOBAL_CONTEXT.md), [contas e e-mails](docs/CONNECTORS.md), [operações documentais](docs/DOCUMENT_WORKSPACE.md) e [novos agentes e prompts](docs/EXTENSIONS.md) para capacidades executáveis e requisitos do operador.

## Use na sua IA, sem instalação

1. Abra [as instruções do agente](agents/TRAVEL_AGENT.md), clique em **Raw** e copie o conteúdo para as instruções de projeto da sua IA ou para uma conversa nova.
2. Selecione um papel e o [comando](prompts/README.md) pertinente. Não anexe o catálogo inteiro a cada interação; o coordenador encaminha a próxima etapa.
3. Descreva a viagem com pseudônimos e as restrições indispensáveis. Informe as capacidades reais do host: por exemplo, pesquisa autorizada na web ou ferramentas locais.

```text
Use Travel Reliability e o fluxo group-split para planejar uma viagem fictícia.
Trabalhe com núcleos N01 e N02, cinco noites e moeda USD.
Primeiro identifique as restrições necessárias para comparar o custo completo.
Não invente preços, disponibilidade ou regras de rateio aceitas.
```

As instruções Markdown não exigem Node.js, npm, Git, Docker ou servidor local. A LLM funciona no host escolhido por você, sob as permissões e a política de dados dele. Veja a [configuração do agente, o ZIP opcional de skill e a conexão MCP](agents/README.md). O [manifesto do pacote](agents/manifest.json) é um índice próprio, não um instalador universal de plugins. Hosts compatíveis com skills podem usar a pasta `travel-agent` empacotada; nas demais interfaces, use copiar/colar explicitamente.

Para ferramentas executáveis em um host compatível com MCP por stdio, instale as dependências Node.js do repositório completo e configure o host para executar `node` com o caminho absoluto de `scripts/agent-mcp.mjs`. Esse modo é opcional; não fornece pesquisa de passagens em tempo real nem funciona automaticamente em toda interface de chat. O [perfil opcional do operador](docs/OPERATOR_PROFILE.md) habilita uma pasta delimitada e leitura de mensagens Gmail previamente selecionadas. A [configuração de fonte PDF](docs/UNICODE_EXPORTS.md) verifica a cobertura dos caracteres antes da exportação.

## Aplicativo local opcional

No Windows, instale **Node.js 24**, escolha **Code → Download ZIP** no GitHub, extraia o ZIP do código-fonte completo e dê dois cliques em **`start-demo.cmd`**. O primeiro início instala as dependências fixadas; os seguintes reutilizam uma instalação compatível. O navegador abre somente depois de a demonstração sintética estar pronta. A demonstração com documentos de texto dispensa Git, Python, Docker e chave de API de modelo. Mantenha a janela aberta enquanto usar o aplicativo.

Para desenvolvedores que preferem o terminal, execute na mesma janela:

```sh
git clone https://github.com/RodrigoYuMatsumoto/travel-reliability.git
cd travel-reliability
npm ci
npm run demo
```

Abra **http://127.0.0.1:5173** e selecione **Explorar demonstração**. Os dados são fictícios, efêmeros e não acionam IA. Para o servidor compilado, use `npm run build` e `npm start`, em **http://127.0.0.1:4310**.

`Missing script` indica que o npm está lendo o package.json de outro projeto. `ERR_CONNECTION_REFUSED` indica que o servidor local não está aceitando conexões. Durante a demonstração, a interface usa a porta 5173 e a API usa 4310 (`/health`); esses endereços pertencem ao computador que executa o iniciador, não são sites hospedados pelo GitHub. Veja [instalação e diagnóstico](docs/INSTALLATION.md).

## Matriz de capacidades

A disponibilidade diz onde cada capacidade roda; a evidência aponta os testes automatizados que a cobrem. O estado da auditoria e os achados abertos estão na [auditoria de conformidade do README](docs/audits/2026-11-04-conformidade-readme.md).

| Capacidade                          | Comportamento                                                                                                                                                                                                                                                                                                                                                     | Disponibilidade                                                                                                                        | Evidência                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Trip Contract                       | Voo, ônibus, hospedagem, temporada, passeio, veículo, seguro e dependências; JSON Schema 2020-12; fusos IANA estritos, casas decimais da ISO 4217 e custo em inteiros; marcação de pacotes fechados com a comparação guardada; versionamento otimista                                                                                                             | API, aplicativo, MCP `travel_check_trip`                                                                                               | `tests/core.test.ts`, `tests/phase1-validation.test.ts`, `tests/bundled-tour-contract.test.ts`          |
| Pré-compra e pré-embarque           | Achados, cobertura de informação, totais por moeda, margem de conexão e noites descobertas                                                                                                                                                                                                                                                                        | API, aplicativo, MCP                                                                                                                   | `tests/core.test.ts`                                                                                    |
| Provas                              | Original cifrado com escopo de chave próprio, manifesto SHA-256, trecho-fonte, aplicação humana, retenção e exclusão                                                                                                                                                                                                                                              | API e aplicativo; armazenamento durável em produção                                                                                    | `tests/security.test.ts`, `tests/phase1-ingestion.test.ts`                                              |
| Ocorrências                         | Eventos manuais e webhooks assinados por workspace; regras brasileiras datadas, com revisão quando a data de vigência muda entre os fusos do Brasil                                                                                                                                                                                                               | API e aplicativo                                                                                                                       | `tests/rules.test.ts`, `tests/phase1-rules-auth.test.ts`                                                |
| Dossiês                             | Cronologia, reembolsos, JSON, PDF, calendário e pacote offline cifrado por senha (`TRB2`, scrypt N=2^17, manifesto conferido arquivo a arquivo)                                                                                                                                                                                                                   | API e aplicativo                                                                                                                       | `tests/core.test.ts`, `tests/phase1-bundle-crypto.test.ts`                                              |
| Avaliações e rotas                  | Avaliações privadas ligadas a comprovante, moderação explícita, rotas versionadas e licenças das fontes                                                                                                                                                                                                                                                           | API e aplicativo                                                                                                                       | `tests/security.test.ts` (parcial)                                                                      |
| Planejamento                        | Treze calculadores determinísticos: os nove originais, mais excursão ou ônibus com hospedagem, fidelidade, composição multimodal e arbitragem de pacotes regionais; aritmética inteira, sem modelo e sem rede                                                                                                                                                     | API, aplicativo, CLI `npm run plan`, MCP `travel_plan`                                                                                 | `tests/planning.test.ts`, `tests/planning-regressions.test.ts`, `tests/intelligence.test.ts`            |
| **Arbitragem de pacotes regionais** | Extrai destino, datas, ônibus ou avião, hospedagem, café e preço publicado de páginas de agências regionais (Atrativa Tur, Niel Turismo, Viajantes do Valle e Augustus Turismo) e compara o total da agência com ônibus e/ou avião mais hospedagem com e sem café, mostrando ágio ou deságio por cenário; valor desconhecido fica nulo e nenhum preço é inventado | Extrator Python (leitura offline; renderização só com `--allow-network`), MCP `travel_extract_package`, calculador `package-arbitrage` | `ingest/tests/test_packages_*.py`, `tests/package-arbitrage.test.ts`, `tests/package-extractor.test.ts` |
| Catálogo de workflows               | Descoberta por domínio e fase e preparação com lacunas, referências e checkpoint de dados; sem execução externa                                                                                                                                                                                                                                                   | Pacote portátil, MCP `travel_catalog` e `travel_workflow`                                                                              | `tests/agent-catalog.test.ts`, `tests/agent-workflow.test.ts`                                           |
| Despesas incorridas                 | Acerto separado de pagadores, beneficiários, pagamentos anteriores e saldos em centavos; sugestões nunca transferem dinheiro                                                                                                                                                                                                                                      | MCP `travel_settle_expenses`                                                                                                           | `tests/agent-expenses.test.ts`                                                                          |
| Acesso                              | OIDC/PKCE, workspaces privados, papéis owner/editor/viewer, CSRF e cookies seguros em produção, inclusive na remoção                                                                                                                                                                                                                                              | API de produção                                                                                                                        | `tests/oidc.test.ts`, `tests/phase1-rules-auth.test.ts`                                                 |

Veja a [arbitragem de pacotes regionais](docs/PACKAGE_ARBITRAGE.md) para as páginas suportadas, os caminhos offline e com rede autorizada e a leitura de ágio, deságio e equivalência.

Os cálculos não dependem de LLM. Extração assistida por IA é opcional, exige configuração e consentimento, recebe trechos delimitados e gera propostas sujeitas à revisão. Não confirma autenticidade, reserva ou direito a indenização.

Para PDF, imagens, DOCX, HTML e EML, use o worker isolado com OCR nativo. Para dados duráveis, siga [operações](docs/OPERATIONS.md): HTTPS, OIDC, PostgreSQL, Redis, armazenamento privado e gestão de chaves. A demonstração em memória não deve ser seu único arquivo de provas.

O [catálogo detalhado](docs/AGENT_CATALOG.md) diferencia treze calculadores de planejamento, 55 workflows de instrução e o acerto de despesas, num total de 69 comandos. O [mapa de cobertura](agents/coverage.json) e a [auditoria](docs/AGENT_AUDIT.md) registram origem sanitizada, correções e limites. Os IDs dos nove calculadores e o recurso MCP legado permanecem disponíveis.

As ferramentas operam documentalmente. Não há conector de inventário aéreo, consulta automática a CNPJ/Cadastur ou monitor de voo ativo por padrão. Dados do fornecedor devem ser importados ou recebidos por integração configurada; ausência de integração nunca vira disponibilidade simulada.

Código, schemas, prompts e documentação originais desde v0.4.0: MIT, com o endereço do repositório nos avisos de atribuição. Versões anteriores mantêm Apache-2.0. Exemplos sintéticos identificados: CC0-1.0; terceiros mantêm seus termos. [Licenciamento](docs/LICENSING.md) · [Limites de publicação](docs/PUBLICATION_BOUNDARY.md) · [Contribuir](CONTRIBUTING.md) · [Relatar vulnerabilidade](SECURITY.md).

Os [contratos de inteligência determinística](docs/INTELLIGENCE.md) descrevem fidelidade, rotas multimodais, pacotes territoriais e vinculação criptográfica de afirmações. Os nove atalhos originais permanecem disponíveis.

## Verificações para desenvolvedores

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` inclui os testes Python e por isso exige o [uv](https://docs.astral.sh/uv/). Todas as fixtures são sintéticas. Documentos reais, credenciais, dados de família e repositórios de referência baixados ficam fora deste repositório. Nenhum fornecedor específico de LLM é exigido.

Hashes provam consistência de bytes, não autenticidade nem segurança universal. Interfaces públicas: [schema da viagem](schema/trip-contract.schema.json), [schemas de planejamento](schema/planning.schema.json), [OpenAPI](api/openapi.json), [contrato de plugins](docs/PLUGINS.md), [arquitetura](docs/ARCHITECTURE.md) e [roteiro](docs/ROADMAP.md).
