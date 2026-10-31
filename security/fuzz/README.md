# Campanhas reproduzíveis de mutação com limites

São usados somente bytes gerados e fixtures declaradamente sintéticas do repositório. Não são lidos documentos de viajantes, provedores, diretórios pessoais ou pastas privadas. Relatórios e receitas de reprodução ficam nos diretórios ignorados `.local/security-audit/fuzz` ou `.local/security-audit/v0.3/fuzz`.

Execute na raiz do repositório, com as dependências instaladas a partir do lockfile:

```sh
uv run --project ingest python security/fuzz/ingest.py --seed 20261030 --cases 384 --seconds 120 --output .local/security-audit/fuzz/ingest.json
node --import tsx security/fuzz/typescript.ts --seed 20261030 --cases 13000 --seconds 120 --output .local/security-audit/v0.3/fuzz/typescript-20261030.json
node --import tsx security/fuzz/typescript.ts --seed 20261031 --cases 13000 --seconds 120 --output .local/security-audit/v0.3/fuzz/typescript-20261031.json
```

Os scripts retornam 0 somente quando completam todos os casos solicitados sem findings nem alteração dos fingerprints das fontes. Código 1 indica finding; código 2 indica execução incompleta, falha de infraestrutura ou alteração de fonte. O limite de tempo nunca reduz silenciosamente a quantidade solicitada: a cobertura restante produz `INCOMPLETE`. As contagens distinguem entradas aceitas de rejeições intencionais de validação/parsing. Rejeição de formato não é classificada como vulnerabilidade.

## Fronteira documental Python

As mutações estruturais e de bytes, determinadas pela seed, cobrem UTF-8/texto, HTML oculto, DOCX ZIP/XML, parsing/renderização nativa de PDF, partes/aninhamento MIME, anexos e limites agregados de texto. As propriedades conferem estado de extração não confirmado e limites de saída/fontes. Lotes de 16 casos executam em subprocessos descartáveis com prazo de doze segundos. Um timeout de inicialização anterior ao primeiro caso pode ser repetido uma vez e é informado separadamente; falha persistente de inicialização representa cobertura incompleta. Em POSIX, os workers também solicitam um GiB de espaço de endereçamento e sete segundos de CPU. No Windows, o relatório informa a ausência de limite de memória aplicado pelo sistema operacional. A geração limitada de entradas não constitui sandbox de memória nativa. Operações de DNS e conexão/envio por socket são bloqueadas no interpretador alvo. Tesseract OCR é substituído por stub; a precisão do OCR nativo tem testes próprios na suíte comum.

As amostras de PDF são pequenas e estruturadas. Erros de parser são classificados pelo tipo de exceção sem imprimir documentos ou tracebacks. Exceções inesperadas, violação de invariantes, erros de recursão/memória, encerramento de processo e timeout são findings para triagem. São preservadas receitas de reprodução para findings. Regressões reduzidas de falhas MIME já identificadas ficam em `ingest/tests/test_fuzz_regressions.py`.

## Fronteiras TypeScript

Há treze alvos intercalados. Os nove anteriores cobrem valores monetários, rateio, extração literal, parsing UTF-8, contrato de viagem, nove calculadoras de planejamento, validação de saída de modelo, horários locais e profundidade/chaves de protótipo. Os quatro adicionais cobrem as interfaces do agente:

- `agent-catalog`: consulta de metadados, filtros, paginação, recursos conhecidos e integridade de manifestos; inclui campos ausentes, referências inconsistentes e duplicações.
- `agent-brief`: roteamento por domínio/workflow, seleção de escopo do grupo, triagem de incidente e distinção entre orçamento zero, desconhecido e nulo. Nenhuma capacidade, reserva ou devolução é declarada verificada/executada.
- `agent-workflow`: checkpoints correspondentes/divergentes, descarte de campos/fontes expirados, preservação conservadora de contadores, débito de preparação, prioridades de parada e limites de prazo/repetição. Usa o argumento confiável `now` fixado em `2030-01-01T12:00:00Z`; o JSON do chamador não fornece o relógio. Capacidade declarada permanece não verificada e chamadas externas, de modelo e gravações permanecem em zero.
- `agent-expenses`: um oráculo independente em `BigInt` calcula quotas por ranking dos restos, conservação e saldos `paid - share + priorSent - priorReceived`. Verifica permutação de núcleos/despesas/beneficiários/acertos anteriores, reconciliação das sugestões residuais e ausência de transferência executada. Despesas `[]` representam zero explicitamente registrado; `priorSettlements: []` declara ausência de acertos anteriores. Ausência, `null`, regra não aceita, valores fracionários/negativos, estouros e referências inválidas devem ser rejeitados.

As quatro famílias incluem receitas válidas e hostis; as rejeições esperadas exigem `AppError` com código específico. Rejeitar uma receita válida, aceitar uma inválida ou lançar outra exceção é finding. Os dados hostis são objetos passivos, sem executar JavaScript recebido. Valores grandes e casos de arredondamento são testados sem repetir a carga máxima de 500 itens, coberta pelos testes unitários.

Cada lote tem prazo de dez segundos e processo Node próprio com 256 MiB de V8 old space. Esse limite abrange heap JavaScript, sem impor limite ao processo inteiro ou à memória nativa. As funções alvo são de validação/cálculo; `fetch` global e requisições HTTP/HTTPS são bloqueados no worker. São registrados versão do Node, seed, casos concluídos, aceitos/rejeitados/findings por alvo e hashes SHA-256 das fontes, do manifesto e dos contratos. Com 13.000 casos completos, cada alvo recebe 1.000 casos; isso não representa 1.000 entradas únicas.

As campanhas são determinísticas, baseadas em mutações/propriedades. Não são guiadas por cobertura como AFL/libFuzzer, não esgotam o espaço de entradas e não constituem auditoria integral de parsers, teste de carga ou prova de impossibilidade de prompt injection.
