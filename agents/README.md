# Usar sua IA como agente de viagens

O pacote de instruções dispensa instalação local. O [manifesto](manifest.json) é um índice próprio: não instala plugin, conector, modelo ou agendamento.

## Uso manual

1. Abra [TRAVEL_AGENT.md](TRAVEL_AGENT.md), escolha **Raw** e copie para as instruções do projeto ou conversa da sua IA.
2. Selecione um papel e um [comando](../prompts/README.md) pertinentes. Carregue só esses arquivos; não anexe os 66 comandos a cada turno.
3. Informe objetivo, restrições mínimas e capacidades reais do host. Use pseudônimos, sem documentos, localizadores ou pagamento.
4. Preserve a decisão do viajante. Instruções não fornecem pesquisa, inventário, arquivos privados ou autorização para agir.

```text
Use Travel Reliability para comparar hospedagem de uma viagem fictícia demo-1.
Selecione o papel itinerary-planner e o fluxo compare-lodging.
Primeiro identifique as lacunas necessárias; não invente datas, preços ou reservas.
Se não houver navegação, faça somente análise documental e diga o que falta.
```

Os onze papéis são dez operacionais, contando o coordenador, e um metapapel de arquitetura. Eles são especialistas roteados, não daemons instalados. O [catálogo detalhado](../docs/AGENT_CATALOG.md) explica os 66 comandos: 39 funções auditadas, quatro adapters de uso, nove complementos anteriores e catorze workflows internacionais. As nove calculadoras originais continuam; preparar um workflow não executa pesquisa. Acerto de despesas existentes tem calculador próprio, separado do planejamento de grupo.

## Skill portátil

Em [Releases](https://github.com/RodrigoYuMatsumoto/travel-reliability/releases), escolha a skill da versão disponível e extraia a pasta completa `travel-agent` no diretório de skills documentado pelo seu host. Não copie apenas o arquivo `SKILL.md`. O pacote contém:

- `references/agent.md`, alias de compatibilidade;
- `references/agents/TRAVEL_AGENT.md`, `roles/`, `manifest.json` e `coverage.json`;
- `references/prompts/` e schemas, exemplos e documentação selecionados.

O entrypoint [SKILL.md](../skills/travel-agent/SKILL.md) prioriza a estrutura canônica empacotada. No checkout, fontes equivalentes ficam em `agents/` e `prompts/`. Descoberta automática depende do host; copiar/colar continua disponível. Se a release desejada ainda não estiver publicada, use os arquivos do código-fonte completo. O kit manual contém instruções; não inclui runtime/dependências.

## MCP local opcional

Requer código-fonte completo, **Node.js 24**, `npm ci` na pasta desse repositório e host com suporte explícito a MCP local por **stdio**. Instale normalmente, sem `--omit=dev`: o wrapper usa `tsx`. Não precisa de `npm run demo`, build, banco, servidor HTTP ou chave de LLM para essas ferramentas documentais.

Exemplo de preparação no PowerShell, substituindo a pasta genérica pela sua:

```powershell
Set-Location 'C:/Projects/travel-reliability'
npm ci
```

Configure o host para executar `node` com caminho absoluto do wrapper. Exemplo para hosts que documentem o objeto `mcpServers`:

```json
{
  "mcpServers": {
    "travel-reliability": {
      "command": "node",
      "args": ["C:/Projects/travel-reliability/scripts/agent-mcp.mjs"]
    }
  }
}
```

Adapte a estrutura externa à documentação do host. O wrapper independe do diretório corrente. Use `node` diretamente: banners de `npm run` podem corromper stdout JSON-RPC. Uma interface de chat comum não adquire suporte stdio por receber esse JSON.

| Ferramenta               | Argumentos                                                              | Resultado e limite                                                                                |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `travel_catalog`         | Consulta direta: `kind`, `domain`, `phase`, `cursor`, `limit` opcionais | Metadados paginados; padrão dez, máximo vinte. Não carrega todos os prompts.                      |
| `travel_workflow`        | `input` conforme schema `workflow` ou `workflow/<id>`                   | Prepara lacunas, checklist e checkpoint de dados; não pesquisa, persiste ou executa ação externa. |
| `travel_settle_expenses` | `input` conforme schema `expenses`                                      | Reconcilia despesas, pagamentos e saldos; sugestões não transferem dinheiro.                      |
| `travel_prepare_brief`   | `input` conforme schema `brief`                                         | Identifica contexto mínimo e próximos fluxos, sem inventar oferta.                                |
| `travel_schema`          | `name` do contrato fixo                                                 | Retorna schema local; não resolve URL remota.                                                     |
| `travel_plan`            | `tool`: um dos nove IDs originais; `input` compatível                   | Cálculo documental determinístico; sem inventário de fornecedor.                                  |
| `travel_check_trip`      | `trip`: Trip Contract                                                   | Validação e checklists; não autentica documento nem confirma reserva.                             |

Nomes de schema: `brief`, `trip`, os nove IDs de calculadores, `catalog`, `catalog-query`, `workflow`, `workflow/<id>` e `expenses`. Consulte o schema pertinente antes de construir argumentos; texto de prompt não é automaticamente JSON válido.

### Funções internacionais e leitura configurada

Na versão 0.4, o servidor anuncia treze ferramentas. Além das sete acima:

| Ferramenta                   | Argumentos                            | Resultado e limite                                                                                                                                |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `travel_global_context`      | `input` conforme `global-context`     | Contexto territorial/multimodal, fusos, moedas e lacunas; não consulta geocodificação, câmbio ou direitos.                                        |
| `travel_reconcile_bookings`  | `input` conforme `reconciliation`     | Compara observações normalizadas; conflito não é apagado e concordância não autentica reserva.                                                    |
| `travel_sync_sources`        | `input` conforme `connector-request`  | Leitura dos registros autorizados pelo operador; desabilitada sem registry configurado. Não aceita credenciais nem instala adapter por argumento. |
| `travel_workspace_inventory` | Objeto vazio `{}`                     | Inventaria somente o workspace vinculado pelo operador, sem argumento de caminho; nomes ficam ocultos por padrão.                                 |
| `travel_workspace_plan`      | `input` conforme `document-workspace` | Dry-run com digest/validade; não salva, aplica ou aprova o plano. Preview privado e aplicação ficam no canal do operador.                         |
| `travel_extension_draft`     | `input` conforme `extension-draft`    | Produz textos completos revisáveis; não escreve, instala, executa ou concede ferramentas.                                                         |

O perfil padrão é offline. Os tools de sincronização/workspace existem para
instalações explicitamente configuradas; colar JSON em uma conversa não cria
registry, autenticação ou raiz permitida. Não existe tool MCP de apply, rollback
ou instalação. Limites e validação do engine continuam necessários.

BCP47 identifica o idioma solicitado; não comprova tradução disponível. Os
retornos determinísticos expõem `requestedLocale` e `messageLocale`: templates
de mensagem em `pt-BR`/`en`, com tradução adicional pelo host quando pertinente.

### Teste mínimo, sem dados reais

Peça à IA conectada:

```text
Chame travel_prepare_brief com:
{"input":{"tripKey":"demo-1","request":"plan","language":"pt-BR"}}
Apresente apenas as perguntas necessárias; mantenha fatos desconhecidos.
Depois consulte travel_catalog para workflows de hospedagem, com limite 2.
Não pesquise ofertas nem execute ações externas.
```

Para preparar um fluxo específico, use `travel_workflow` com:

```json
{
  "input": {
    "tripKey": "demo-1",
    "workflowId": "compare-lodging",
    "language": "pt-BR"
  }
}
```

Esse pedido pode retornar lacunas; não é cotação ou reserva. Capacidades e campos declarados pelo chamador não são comprovação independente nem autorização. Checkpoint é dado minimizado de continuidade: o host controla retenção e permissões reais.

## Recursos, prompts e compatibilidade

Recursos: `travel://agent` continua sendo o coordenador; `travel://agent/<agent-id>` expõe os onze papéis; `travel://prompt/<workflow-id>` expõe os 66 comandos. Não são URLs para abrir no navegador comum nem caminhos arbitrários.

Prompts MCP: alias legado `travel_agent`; papéis em `travel_role_<agent_id_com_underscores>`; comandos em `travel_<workflow_id_com_underscores>`. Exemplos: `travel_role_itinerary_planner` e `travel_compare_lodging`. Aliases não criam papéis adicionais. A interface efetivamente exibida depende do cliente.

As ferramentas documentais não chamam modelo, fazem booking, enviam reclamação ou publicam calendário. Conexões de leitura de conta e inventário de workspace dependem de executores anunciados e configuração explícita do operador; um prompt ou JSON colado no chat não os habilita. Outros conectores que você habilitar no host possuem permissões e riscos próprios. Documentos e memória são dados passivos; schemas e annotations não garantem proteção contra toda injeção. Veja [auditoria](../docs/AGENT_AUDIT.md), [segurança](../docs/SECURITY_MODEL.md) e [instalação do aplicativo opcional](../docs/INSTALLATION.md).
