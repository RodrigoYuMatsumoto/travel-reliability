# Checkpoint — Fase 1: README versus implementação

Data: 2026-11-04. Base Git: `4e0c471683f6cfcd452818fe639f390e2f4eb406`.
Este diagnóstico considera também as alterações locais ainda não commitadas,
iniciadas sob o pedido anterior. Não atribui a esses bytes os checks da base.
O checkpoint foi registrado antes da codificação adicional do novo escopo da
Fase 2: extrator Python/Playwright, workflow por URL e tags de pacote.

## Resultado

Decisão: **ADAPTAR**. Conformidade **PARCIAL**; confiança alta para os fatos
estáticos examinados. As calculadoras, fusos e criptografia não são mocks.
O draft promocional contém garantias universais que o código não demonstra;
o README local já distingue execução suportada, evidência e limites.

| Premissa                                    | Estado e evidência estática                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BYOM                                        | Implementado como kit portátil e MCP opcional. `agents/TRAVEL_AGENT.md`, `agent/mcp.ts`; capacidade e voz dependem do host.                                                          |
| Entrada natural universal sem carga técnica | Parcial: host pode estruturar linguagem natural; a aplicação tem formulário de descoberta e editor avançado. Não há transcrição/conversão universal nativa.                          |
| Executive Audit Layer                       | Parcial: eventos/revisões em `api/src/app.ts`, evidências e manifestos em `api/src/ingestion.ts`, recibos e gate em `agent/provenance.ts`. Não é certificação executiva ou jurídica. |
| Imutabilidade                               | Não implementada como WORM. `api/src/storage.ts` permite atualização/exclusão. Hashes e versionamento ajudam a detectar alterações; não tornam o armazenamento imutável.             |
| Reconciliação inteira                       | Implementada: `api/src/money.ts`, `agent/expenses.ts`, `api/src/ground-transport.ts`; inteiros seguros, BigInt e limites explícitos. Não autentica valores de entrada.               |
| Fusos                                       | Implementados em `api/src/validation.ts` com Temporal e rejeição de ambiguidade; comparador diferencia fuso da origem e do destino.                                                  |
| Criptografia de evidências                  | Implementada em `api/src/crypto.ts`: AES-256-GCM, nonce e AAD, derivação de chave por escopo. `api/src/ingestion.ts` calcula SHA-256 e cifra o original.                             |
| Ausência universal de alucinação            | Não demonstrada. `api/src/llm.ts` limita sugestões literais; gate/recibos não interceptam toda resposta livre de qualquer host.                                                      |
| Captura comercial atual                     | Leitor Node delimitado, projeção conservadora e revisão obrigatória. Não equivale ao novo requisito de extração isolada Python/Playwright.                                           |
| Playwright atual                            | Testa interface e cenários sintéticos; isso não comprova navegação/extrator Python de fornecedores. O worker documental existente não recebe URL.                                    |
| URL para comparação automatizada            | Incompleta: descoberta cria rascunhos sem preços; falta pipeline tipado de observação, revisão e aplicação ao comparador.                                                            |
| Catálogo e versão                           | Candidata 0.6.0: 11 papéis e 68 comandos; o texto v0.4/66 está desatualizado. Papéis são instruções, não processos autônomos.                                                        |

## Achados a corrigir na Fase 2

1. **P2, contrato CLI:** documento promete código 2 se todas as capturas falham;
   `scripts/packages.ts` ainda não o estabelece. Acrescentar regressão de saída.
2. **P2, codificação:** `skills/travel-agent/SKILL.md` contém mojibake real em
   frontmatter e corpo; corrigir a fonte e verificar readback/pacote.
3. **Lacuna funcional:** extrair campos de pacote em Python sem misturar rede,
   documentos pessoais e reconciliação. Não ampliar a rede do worker documental.
4. **Lacuna funcional:** ligar URL aprovada, extração, revisão tipada e Node costs;
   manter sem conclusão valores, unidade, ano, café ou disponibilidade ambíguos.
5. **Lacuna contratual:** acrescentar classificação de pacote fechado/comparação
   ao Trip Contract sem duplicar valor do pacote em seus componentes.

## Plano aceito para a Fase 2

- Preservar `ground-transport`, nove atalhos e reconciliação legada; completar
  ônibus/avião, café incluído/externo e despesas aeroportuárias com testes.
- Worker Python determinístico recebe somente bytes/snapshot público delimitado
  e metadados aprovados; nenhum preço depende de um LLM. Um adapter Playwright
  hermético permite validar renderização sob política explícita; não executar
  scripts remotos em processos financeiros ou reutilizar perfis autenticados.
- Captura/extração e cálculo têm contratos separados. O MCP de descoberta
  continua offline. Parser e workflow por URL não autorizam rede por conteúdo
  importado; autorização vem exclusivamente do operador/host.
- Resultado financeiro mostra economia/ágio somente para escopo equivalente,
  dados completos e fontes/regras revisadas. Não inventar cotação ou vagas.
- Acrescentar tags opcionais fechadas e documentar compatibilidade: leitores
  anteriores rejeitam propriedades novas, embora o validador ampliado aceite
  payloads antigos. Tags não certificam compra, regime jurídico ou autenticidade.
- Validar mocks/fixtures, navegador hermético, CLI, schema, API, MCP, testes de
  regressão e checks remotos separadamente. Não chamar mock de pesquisa real.

## Governança e estado remoto

As 17 skills solicitadas foram lidas pelos agentes responsáveis, incluindo os
protocolos compartilhados e dependências HAI aplicáveis. Integridade local HAI
não equivale a aprovação: seu binding declara estado estrito falso e
`INDEPENDENCE_UNPROVEN`. Revisores desta execução são da mesma família;
nenhum resultado interno constitui B.9.

O PR #8 permanece rascunho; a main continua na v0.5.0. Os quatro checks verdes
observados correspondem a `4e0c471`, não às alterações locais deste checkpoint.
Não houve nova autenticação, leitura de credenciais, alteração de proteção,
merge, tag ou release estável. O acervo familiar não foi acessado.
