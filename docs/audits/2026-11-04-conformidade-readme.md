---
lang: pt-BR
title: Auditoria de conformidade entre README e código (checkpoint da Fase 1)
subject: Diagnóstico das promessas do README.md contra o código no commit 4e0c471, antes do módulo Regional Package Arbitrage
---

# Auditoria de conformidade entre README e código

Checkpoint da Fase 1, gravado antes de qualquer código do módulo Regional Package Arbitrage.

| Item             | Valor                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Data             | 2026-11-04                                                                                                                               |
| Base auditada    | commit `4e0c471` (ramo `fix/complete-release-followups`, versão declarada 0.6.0)                                                         |
| Ramo de trabalho | `feat/regional-package-arbitrage`                                                                                                        |
| Linha de base    | `npm run typecheck` sem erros; `npm test`: 472 aprovados e 3 pulados; `pytest ingest/tests`: 28 aprovados e 1 pulado (OCR sem Tesseract) |
| Método           | quatro auditores de contexto isolado, só leitura, um por grupo de promessas; testes pontuais; sondas fora do repositório                 |
| Classe           | G2 (vários arquivos, sem dado pessoal e sem efeito externo)                                                                              |

## Síntese

- **Cálculo determinístico:** os calculadores não chamam LLM, rede nem aleatoriedade. O dinheiro usa inteiros na menor unidade, com BigInt e checagem de inteiro seguro.
- **Cifragem, OIDC, worker isolado e caminho opcional de LLM:** batem com o que o README promete.
- **Defeitos materiais:** estão em quatro pontos:
  - **validações de borda:** fuso não restrito a IANA, cronologia sem fuso e casas decimais da moeda;
  - **parâmetros de cifragem:** o pacote offline usa scrypt abaixo da recomendação OWASP, e o blob compartilha domínio com o registro;
  - **data de vigência das regras:** é lida do texto do instante, sem considerar o fuso;
  - **documentação:** contagens paradas na 0.4 e 0.5, e a 0.6 apresentada como entregue.
- **“Executive Audit Layer”:** não existe com esse nome. O equivalente é o portão `travel_audit_output`, que hoje bloqueia todo fato porque não há registro de evidência configurável (A4-04).
- **“Capability Matrix”:** não existe. A tabela “What works” tem duas colunas e não diz versão, perfil nem evidência.

## Veredito por promessa

| Promessa                                                           | Veredito                                        | Evidência principal                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Trip Contract: schema 2020-12, fuso, custo e versionamento         | incompleto                                      | `api/src/validation.ts:9-62`, `api/src/app.ts:270-290`                  |
| Pré-reserva: achados, cobertura, totais por moeda, folgas e noites | coerente, com ressalva                          | `api/src/assessment.ts:22-144`                                          |
| Evidências cifradas, manifesto, trechos e retenção                 | coerente, com achados baixos                    | `api/src/crypto.ts:16-40`, `api/src/ingestion.ts:240-319`               |
| Rupturas e webhooks assinados                                      | incompleto                                      | `api/src/app.ts:567-658`, `api/src/rules.ts:76`                         |
| Dossiês e pacote offline cifrado                                   | incompleto                                      | `api/src/exports.ts:206-248`, `web/src/offline.tsx:24-66`               |
| Avaliações e rotas                                                 | incompleto                                      | `api/src/app.ts:739-825`, `api/src/input-schemas.ts:104-113`            |
| Planejamento: nove ferramentas determinísticas                     | código coerente, documentação inconsistente     | `schema/src/planning.ts:5-18` (12 IDs), `README.md:68` (diz nove)       |
| Catálogo de workflows                                              | incompleto                                      | `agents/manifest.json` (68 comandos), `docs/AGENT_CATALOG.md` (66)      |
| Despesas incorridas                                                | coerente                                        | `agent/expenses.ts:156-295`                                             |
| Acesso: OIDC, papéis, CSRF e cookies                               | coerente, com ressalva                          | `api/src/auth.ts:38-209`                                                |
| Uso sem LLM e LLM opcional                                         | coerente                                        | `api/src/llm.ts:21-281`, `api/src/app.ts:357-433`                       |
| Extração pelo worker Python                                        | coerente                                        | `api/src/ingestion.ts:321-353`, `ingest/travel_ingest/server.py:22-107` |
| MCP offline com permissões explícitas                              | coerente no comportamento, anotações imprecisas | `agent/mcp.ts:158-481`                                                  |
| Itens da versão 0.6                                                | incompleto                                      | `CHANGELOG.md:3` (candidata), `README.md:7-9`                           |
| Paridade entre README.md e README.pt-BR.md                         | incompleto                                      | `README.pt-BR.md`                                                       |

## Achados sobreviventes

A coluna “Ação” separa o que esta rodada corrige do que fica registrado como pendência.

| ID    | Localização                                                                                                        | Achado                                                                                                                                  | Sev.  | Ação                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| A1-01 | `api/src/validation.ts:20,50-53`                                                                                   | Com fuso nulo, a cronologia não é conferida: um serviço que termina antes de começar é aceito                                           | média | corrigir                                |
| A1-02 | `api/src/validation.ts:17-24`, `api/src/errors.ts:4`                                                               | Fuso com offset fixo (`+03:00`) aceito como IANA; fuso inválido sai com 400, e não com 422                                              | baixa | corrigir                                |
| A1-03 | `schema/trip-contract.schema.json` (`$defs.money`), `web/src/format-money.ts:4-5`, `api/src/literal-facts.ts:3-15` | Casas decimais da moeda vêm do CLDR na interface, de uma tabela de 11 moedas na extração e de nenhuma regra no contrato; `ZZZ` é aceito | média | corrigir                                |
| A1-04 | `api/src/app.ts:276-280,809-810`                                                                                   | If-Match divergente devolve 409, e não 412; `*` e ETag fraco caem em 428 sem documentação                                               | baixa | pendência                               |
| A1-05 | `api/src/assessment.ts:131-139`                                                                                    | Hospedagem só cotada conta como noite coberta                                                                                           | média | pendência (intenção a decidir)          |
| A1-06 | `README.md:68,95`, `docs/IMPLEMENTATION_STATUS.md:35,136-147`                                                      | Contagens de ferramentas e tipos de serviço divergentes                                                                                 | baixa | corrigir                                |
| A1-07 | `api/src/planning.ts:838`, `agent/content-policy.ts:3-29`                                                          | A política de conteúdo vale para a saída inteira e recusa texto comum (“for the sake of”)                                               | média | pendência (decisão do mantenedor)       |
| A1-08 | `api/src/planning.ts:838-852`, `agent/provenance.ts:152-166`                                                       | Saídas sem schema; só três calculadores emitem recibo de cálculo                                                                        | baixa | parcial: o calculador novo emite recibo |
| A1-11 | `api/src/planning.ts:217-222`                                                                                      | Horário com segundos invalida a oferta                                                                                                  | baixa | pendência                               |
| A2-01 | `api/src/exports.ts:211`, `web/src/offline.tsx:24-29`                                                              | scrypt N=2^15, r=8, p=1, abaixo do mínimo OWASP (N=2^17); parâmetros fora do cabeçalho                                                  | média | corrigir (formato `TRB2`)               |
| A2-02 | `web/src/offline.tsx:136-140`, `scripts/verify-bundle.ts:9-16`                                                     | O pacote confere os originais, mas não permite extraí-los                                                                               | média | pendência                               |
| A2-03 | `api/src/exports.ts:243-248`, `web/src/offline.tsx:54-66`                                                          | O verificador não confronta o manifesto com os arquivos                                                                                 | baixa | corrigir                                |
| A2-04 | `api/src/ingestion.ts:267`, `api/src/storage.ts:76-78`                                                             | Blob original e registro do documento usam o mesmo escopo de chave e AAD                                                                | baixa | corrigir                                |
| A2-05 | `api/src/ingestion.ts:56-108`, `ingest/travel_ingest/extract.py:207-210`                                           | O trecho de origem pode não conter o valor extraído                                                                                     | baixa | pendência                               |
| A2-06 | `tests/core.test.ts:134-147`                                                                                       | O teste de adulteração não adultera o pacote; `decryptBundle` lança erro bruto                                                          | baixa | corrigir                                |
| A3-01 | `api/src/rules.ts:76`                                                                                              | O regime da regra depende do fuso em que o instante foi escrito (`slice(0, 10)`)                                                        | média | corrigir                                |
| A3-02 | `api/src/auth.ts:74,207`                                                                                           | O cookie `__Host-` é apagado sem `Secure`, e o navegador ignora a remoção                                                               | baixa | corrigir                                |
| A3-03 | `api/src/input-schemas.ts:104-113`                                                                                 | Licença e afirmação da fonte da rota aceitam texto vazio; data de conferência no futuro                                                 | baixa | pendência                               |
| A3-04 | `tests/`                                                                                                           | Faltam testes HTTP para avaliações, rotas e casos negativos de webhook                                                                  | baixa | pendência                               |
| A3-05 | `api/src/ingestion.ts:42-47`, `ingest/travel_ingest/extract.py:30-35`                                              | Marcadores de injeção divergem entre Node e Python                                                                                      | baixa | corrigir                                |
| A4-01 | `README.md:68`                                                                                                     | “Nine deterministic tools” contra doze no código                                                                                        | baixa | corrigir                                |
| A4-02 | `docs/AGENT_CATALOG.md`, `prompts/README.md:13-14`, `agents/TRAVEL_AGENT.md:44`                                    | Documentos lidos pela LLM negam três IDs válidos                                                                                        | média | corrigir                                |
| A4-03 | `agents/README.md:64-71`, `docs/INSTALLATION.md:81-82`                                                             | Contagem de ferramentas MCP divergente (o servidor tem 15)                                                                              | baixa | corrigir                                |
| A4-04 | `agent/mcp.ts:18,452,460`, `agent/provenance.ts:116`                                                               | O portão de auditoria não consegue documentar nenhum fato: não há registro de evidência do operador                                     | média | pendência                               |
| A4-05 | `agent/mcp.ts:158-163`, `agent/connectors.ts:242-243`                                                              | Anotações de somente leitura e idempotência imprecisas em duas ferramentas                                                              | baixa | pendência                               |
| A4-06 | `README.md:7,9`, `CHANGELOG.md:3`                                                                                  | A 0.6 aparece como entregue, mas é candidata                                                                                            | média | corrigir                                |
| A4-07 | `scripts/install-codex.py:258`                                                                                     | O manifesto de release é opcional no instalador                                                                                         | baixa | pendência                               |
| A4-08 | `README.pt-BR.md`                                                                                                  | O português omite ressalvas e seções do inglês                                                                                          | baixa | corrigir em parte                       |

## Contagem do teste de não fabricação

```text
59 candidatas / 28 sobreviventes / 12 rebaixadas / 19 descartadas
```

Por frente:

- contrato e planejamento: 16/9/2/5;
- evidências e cifragem: 16/6/4/6;
- rupturas, acesso, LLM e ingestão: 14/5/4/5;
- catálogo, MCP e release: 13/8/2/3.

## Causas-raiz consolidadas

1. **Contagem escrita à mão em vários documentos, sem teste de paridade com o manifesto.** Explica A1-06, A4-01, A4-02, A4-03 e parte de A4-08. A correção é derivar as contagens do manifesto num teste.
2. **Validação de borda delegada a bibliotecas sem regra explícita do projeto.** Explica A1-01, A1-02, A1-03 e A3-01: o Temporal aceita offset, o CLDR dá as casas decimais e a data vem do texto. A correção é uma tabela própria de moedas (ISO 4217) e uma regra de fuso de referência.
3. **Parâmetros e domínios criptográficos fixados no código, sem versão no formato.** Explica A2-01 e A2-04. A correção é um formato versionado e escopos separados.

## Limites deste checkpoint

- Não rodei os testes com PostgreSQL, Redis e S3 reais nem o isolamento do Docker Compose.
- O OCR real não foi testado: o Tesseract não está instalado nesta máquina.
- A remoção do cookie `__Host-` não foi conferida num navegador real.
- O instalador do Codex e o `release-bundle.py verify` não foram executados.
- A vigência das Resoluções ANAC 813/2026 e 819/2026 e ANTT 6.033/2023 não foi conferida em fonte oficial.
- A auditoria foi feita por subagentes da mesma família de modelo do integrador. Não houve verificação B.9.
