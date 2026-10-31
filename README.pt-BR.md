# Travel Reliability

**Use sua própria IA como agente de viagens, com fontes rastreáveis, custos explícitos e provas verificáveis. Brasil primeiro, arquitetura global.**

[English](README.md) · [Agente sem instalação](#use-na-sua-ia-sem-instalação) · [Catálogo de comandos](prompts/README.md) · [Auditoria dos agentes](docs/AGENT_AUDIT.md) · [Aplicativo opcional](#aplicativo-local-opcional) · [Segurança](SECURITY.md) · [Cobertura dos testes de segurança](docs/SECURITY_TESTS.md) · [Evidências de entrega](docs/IMPLEMENTATION_STATUS.md)

O ponto de entrada é um **pacote portátil de instruções para a sua própria LLM**. O catálogo 0.3 organiza oito papéis e 52 comandos sobre transporte, hospedagem, roteiros, seguros, logística de saúde, provas e custos de grupo. São instruções roteadas, não oito serviços ativos; a quantidade decorre das necessidades auditadas, sem quota artificial. Ferramentas locais opcionais validam contratos e cálculos; o aplicativo apoia a organização privada de provas.

O agente distingue fatos cotados, condições verificadas e lacunas. Um prompt não fornece acesso à internet ou ao inventário de fornecedores. As ferramentas documentais não inventam disponibilidade nem enviam transações. Compras, cancelamentos e mensagens exigem autorização específica do viajante e capacidade real de execução no host.

## Use na sua IA, sem instalação

1. Abra [as instruções do agente](agents/TRAVEL_AGENT.md), clique em **Raw** e copie o conteúdo para as instruções de projeto da sua IA ou para uma conversa nova.
2. Selecione um papel e o [comando](prompts/README.md) pertinente. Não anexe o catálogo inteiro a cada interação; o coordenador encaminha a próxima etapa.
3. Descreva a viagem com pseudônimos e as restrições indispensáveis. Informe as capacidades reais do host: por exemplo, pesquisa autorizada na web ou ferramentas locais.

```text
Use Travel Reliability e o fluxo group-split para planejar uma viagem fictícia.
Trabalhe com núcleos N01 e N02, cinco noites e moeda BRL.
Primeiro identifique as restrições necessárias para comparar o custo completo.
Não invente preços, disponibilidade ou regras de rateio aceitas.
```

As instruções Markdown não exigem Node.js, npm, Git, Docker ou servidor local. A LLM funciona no host escolhido por você, sob as permissões e a política de dados dele. Veja a [configuração do agente, o ZIP opcional de skill e a conexão MCP](agents/README.md). O [manifesto do pacote](agents/manifest.json) é um índice próprio, não um instalador universal de plugins. Hosts compatíveis com skills podem usar a pasta `travel-agent` empacotada; nas demais interfaces, use copiar/colar explicitamente.

Para ferramentas executáveis em um host compatível com MCP por stdio, instale as dependências Node.js do repositório completo e configure o host para executar `node` com o caminho absoluto de `scripts/agent-mcp.mjs`. Esse modo é opcional; não fornece pesquisa de passagens em tempo real nem funciona automaticamente em toda interface de chat.

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

## Funcionalidades

- Contrato JSON para voo, ônibus, hotel, temporada, passeio, veículo, seguro e conexão; exportação JSON/PDF/iCal.
- Checklist pré-compra/pré-embarque, custo por moeda, margem de conexão e lacunas de pernoite.
- Preservação criptografada do original, hash, trecho-fonte, aplicação humana e exclusão de derivados.
- Ocorrências e regras brasileiras versionadas por vigência, com fontes e hipóteses pendentes.
- Dossiê factual com cronologia, valores de reembolso e manifesto; pacote criptografado verificável offline.
- Avaliações privadas vinculadas a comprovante e publicação moderada; rotas versionadas com proveniência.
- Nove calculadores originais preservados: datas flexíveis, aeroportos/companhias, conexões, promoções, custo total, alteração/reembolso, rascunhos de negociação, hidden-city e cenários de grupo.
- Acerto de despesas existentes separado: pagadores, beneficiários, regra aceita, pagamentos anteriores e saldos em centavos, sem destino/noites artificiais e sem transferência de dinheiro.
- Descoberta por domínio/fase e preparação de workflows com lacunas, referências e checkpoint de dados; preparação não executa pesquisa ou contratação.
- OIDC e permissões por workspace; interface pt-BR/en e PWA instalável.

Os cálculos não dependem de LLM. Extração assistida por IA é opcional, exige configuração e consentimento, recebe trechos delimitados e gera propostas sujeitas à revisão. Não confirma autenticidade, reserva ou direito a indenização.

Para PDF, imagens, DOCX, HTML e EML, use o worker isolado com OCR nativo. Para dados duráveis, siga [operações](docs/OPERATIONS.md): HTTPS, OIDC, PostgreSQL, Redis, armazenamento privado e gestão de chaves. A demonstração em memória não deve ser seu único arquivo de provas.

O [catálogo detalhado](docs/AGENT_CATALOG.md) diferencia os nove calculadores das 43 entradas sem calculador legado e do acerto de despesas. O [mapa de cobertura](agents/coverage.json) e a [auditoria](docs/AGENT_AUDIT.md) registram origem sanitizada, correções e limites. Os IDs dos nove calculadores e o recurso MCP legado permanecem disponíveis.

As ferramentas operam documentalmente. Não há conector de inventário aéreo, consulta automática a CNPJ/Cadastur ou monitor de voo ativo por padrão. Dados do fornecedor devem ser importados ou recebidos por integração configurada; ausência de integração nunca vira disponibilidade simulada.

Código, schemas, prompts e documentação: Apache-2.0. Exemplos sintéticos explicitamente identificados: CC0-1.0. [Contribuir](CONTRIBUTING.md) · [Relatar vulnerabilidade](SECURITY.md).
