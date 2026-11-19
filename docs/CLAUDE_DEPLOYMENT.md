---
title: 'Implantação do Travel Reliability no Claude Code'
subject: 'Distribuição do plugin e operação do MCP remoto autenticado'
lang: pt-BR
---

# Travel Reliability no Claude Code

Valide o pacote com `node scripts/package-claude-plugin.mjs --check` e `claude plugin validate --strict --profile directory ./plugins/travel-reliability`. Para iniciar uma sessão de teste, use `claude --plugin-dir ./plugins/travel-reliability`. A skill é `/travel-reliability:travel-agent`.

O endpoint permanece desativado na edição de homologação do plugin. A promoção exige que o operador configure um serviço remoto HTTPS, teste o consentimento e registre o endpoint HTTPS terminado em `/mcp` em `deploy/claude-plugin.json`. Gere a pasta novamente com `node scripts/package-claude-plugin.mjs` e rode `node scripts/package-claude-plugin.mjs --release-check`.

## Servidor remoto no Cloud Run

Use projetos ou serviços separados para homologação e produção. O contêiner do MCP tem receita própria em `deploy/Dockerfile.mcp`. A receita fixa a imagem base por digest. Antes da promoção, confira atualizações de segurança e registre o digest da imagem resultante. A identidade do serviço deve ter apenas os acessos necessários para ler os segredos vinculados e alcançar a instância de Redis pela rede privada. Comece em São Paulo com 1 CPU, 512 MiB, concorrência 8, mínimo zero e teto de duas instâncias. Confira custo e carga antes de ampliar.

Variáveis de implantação:

- `TRAVEL_MCP_PUBLIC_ORIGIN`: origem HTTPS pública do Cloud Run, sem caminho.
- `TRAVEL_MCP_ISSUER`: origem HTTPS do tenant Auth0.
- `TRAVEL_MCP_PROOF_KEY`: chave de 32 bytes em Base64 URL sem preenchimento, armazenada no Secret Manager. A rotação invalida recibos anteriores, cuja validade é de 15 minutos.
- `TRAVEL_MCP_QUOTA_REDIS`: conexão privada, com autenticação e TLS conforme a instância. Obrigatória no Cloud Run.
- `TRAVEL_MCP_QUOTA_NAMESPACE`: identificador diferente por ambiente para o limite compartilhado de uso.

O ingresso HTTPS permite descoberta OAuth. A aplicação exige o token do Auth0 em cada interação MCP. Configure no Auth0 o indicador de recurso igual ao endpoint em `/mcp`, assinatura RS256, vida útil curta e escopos `travel:read`, `travel:calculate` e `travel:audit`. Verifique os redirecionamentos do Claude hospedado e do Claude Code. Valide cadastro compatível com os dois clientes, consentimento, renovação, revogação e o retorno à aplicação antes de disponibilizar o conector.

Use somente fixtures sintéticas na homologação. Confira `/health`, descoberta do recurso, exigência de autenticação, relação de ferramentas por escopo, cálculo e recibo. Inclua teste entre duas instâncias e falha do Redis. O serviço opera com contadores de validade curta e sem persistência de conteúdo de viagem. Configure também a retenção de registros do provedor e o monitoramento de erros sem payloads ou tokens.

Em caso de incidente, retire o tráfego da revisão, restaure a imagem e o catálogo anteriores e suspenda a aplicação OAuth se houver comprometimento. Teste o procedimento em homologação. Limites de instâncias e alertas orçamentários ajudam a controlar custos, mas não garantem um teto de cobrança.

[Autenticação para conectores](https://claude.com/docs/connectors/building/authentication) · [Implantação no Cloud Run](https://docs.cloud.google.com/run/docs/deploying) · [Submissão do plugin e do conector](https://claude.com/docs/plugins/submit)
