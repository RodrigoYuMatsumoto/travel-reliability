# Organização documental local com prévia e aprovação

Este módulo organiza **documentos em uma pasta privada de trabalho**, incluindo
texto e cópia/movimentação opaca de PDF, JPEG, PNG e WebP.
Não acessa contas, não executa conteúdo de arquivos e não confirma reservas.
O operador fornece a raiz absoluta ao abrir `DocumentWorkspace`; a raiz não é
um argumento livre para a IA escolher. Não use a pasta do código-fonte nem uma
pasta que contenha credenciais ou documentos pessoais desnecessários à tarefa.

## Operações e limites

| Operação                              | Efeito real                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `inventory()`                         | Lista IDs, caminhos relativos, tamanhos e SHA-256 de documentos permitidos. Não retorna seus corpos.            |
| `prepare(input)`                      | Produz plano, digest, prazo e conciliação sem criar diretórios ou arquivos.                                     |
| `apply(plan, authorization)`          | Copia ou move os itens escolhidos e gera registro JSON/Markdown, somente para o digest explicitamente aprovado. |
| `rollback(plan, authorization)`       | Restaura originais movidos e remove resultados criados, desde que seus hashes permaneçam iguais.                |
| `status(plan)`                        | Confere os arquivos de um estado terminal; alterações ou operação parcial exigem reconciliação.                 |
| `savePlan(plan)` / `loadPlan(digest)` | Persistem/leem um plano privado, por chamada explícita do operador.                                             |

Textos `.txt`, `.md`, `.json`, `.csv`, `.eml` e `.ics` exigem UTF-8 válido sem
controles binários e têm limite de 256 KiB. PDFs e imagens `.pdf`, `.jpg`, `.jpeg`,
`.png` e `.webp` são bytes opacos, limitados a 8 MiB por item: o módulo calcula
hash e pode copiar/mover, sem interpretar, renderizar, abrir links ou executar
conteúdo. O limite total é 64 MiB, 100 arquivos, 400 entradas e seis níveis.
Registros, planos e journal continuam sob limite de texto de 256 KiB.
Extensão permitida não prova formato autêntico nem ausência de malware. Extração
de PDF/imagem pertence ao serviço isolado de ingestão, mediante outra operação.
Arquivos Office/executáveis/arquivos compactados permanecem fora deste módulo.
Um `.eml` inventariado não abre anexos nem valida remetente; um `.ics` copiado
não cria eventos nem envia convites.

Use `copy` como escolha usual para preservar a origem; o campo é obrigatório e
`move` precisa ser escolhido explicitamente. A movimentação escreve e confere o
destino antes de remover a origem. Resultados ficam sob
`.travel-workspace/trips/<tripKey>/`, com nomes derivados de serviço, data e ID,
e não de nomes de viajantes. Colisões diferentes interrompem o plano; conteúdo
preexistente idêntico é identificado e não é apagado pelo rollback.

## Uso pelo operador

Requer o código-fonte completo e as dependências instaladas. Execute da pasta
do repositório; a raiz de documentos do exemplo é deliberadamente externa a ele.

```powershell
node scripts/document-workspace.mjs inventory --root 'C:/TravelWorkspace/demo'
node scripts/document-workspace.mjs prepare --root 'C:/TravelWorkspace/demo' --input organize.json --save-plan
```

Crie `organize.json` dentro da raiz privada, substituindo o `fileId` pelo ID
retornado no inventário. O exemplo abaixo contém apenas dados sintéticos:

```json
{
  "tripKey": "demo-1",
  "documents": [
    {
      "fileId": "F000000000000000000000000",
      "serviceType": "rail",
      "serviceDate": "2030-01-20",
      "recordId": "R01",
      "sourceRefs": ["SRC01"],
      "mode": "copy"
    }
  ],
  "records": []
}
```

Revise todas as ações, origens, destinos, hashes, custos normalizados e o digest.
Só então substitua os marcadores no comando de aplicação:

```powershell
node scripts/document-workspace.mjs apply --root 'C:/TravelWorkspace/demo' --plan '<DIGEST-REVISADO>' --approve '<MESMO-DIGEST>'
node scripts/document-workspace.mjs status --root 'C:/TravelWorkspace/demo' --plan '<DIGEST-REVISADO>'
node scripts/document-workspace.mjs rollback --root 'C:/TravelWorkspace/demo' --plan '<DIGEST-REVISADO>' --approve '<MESMO-DIGEST>'
```

O prazo de quinze minutos vale para a primeira aplicação. Reexecutar uma
aplicação concluída apenas verifica seu resultado; não refaz a movimentação.
O rollback pode ocorrer depois desse prazo, exige aprovação própria e mantém
planos/journal para auditoria. Não automatize a aprovação a partir do digest
produzido pela própria IA: o campo prova correspondência de bytes, não identidade
de quem aprovou nem manifestação humana independente.

## Conciliação e integração

### Revisões por diferença

Use os comandos locais abaixo com uma pasta privada absoluta já existente,
fora de um repositório Git. O JSON informa a chave da viagem, o instante
da revisão, as fontes, os fatos, as tarefas e os cálculos. Consulte o
exemplo executável em `examples/trip-update.json`.

```text
npm run trip:update -- preview ROOT INPUT
npm run trip:update -- apply ROOT INPUT DIGEST
npm run trip:update -- current ROOT
```

Use em `apply` o digest devolvido pela prévia e a mesma entrada. Cada revisão
aprovada tem índice, painel, checklist, registro com fontes e JSON de alertas
críticos. `current` localiza o índice da última revisão completa. Os alertas
incluem uma chave que um executor externo pode usar para evitar duplicatas.
Para consultar uma versão anterior, abra seu índice. Para corrigir a versão
atual, aplique uma nova revisão com as evidências corrigidas.

O encerramento exige fontes vigentes dos tipos indicados pela tarefa e
evidência vinculada aos fatos acompanhados. Mudanças na agenda ou expiração
de evidência podem reabrir a tarefa e suas dependentes. Cabe ao operador
escolher a fonte de cada fato e conferir sua autenticidade.

### Leitura seletiva de planilha, anexo e PDF longo

```text
uv run --directory ingest python -m travel_ingest.selected_sources agenda ABSOLUTE_INPUT.xlsx --sheet Current --first 3 --last 25 --date-column C --time-column D --label-column E --carry-date
uv run --directory ingest python -m travel_ingest.selected_sources attachment ABSOLUTE_INPUT.zip --entry selected.eml
uv run --directory ingest python -m travel_ingest.selected_sources pdf ABSOLUTE_INPUT.pdf --first 51 --last 80
```

Selecione a aba, as linhas e as colunas que pertencem ao grupo. O resultado
registra hash, linhas e células. A data anterior só é carregada quando
solicitado. Fórmulas ficam sem valor declarado. A leitura do ZIP abre apenas
o anexo selecionado. A do PDF mantém a numeração original e processa até
50 páginas por chamada. Páginas sem texto ficam marcadas para OCR.

Para integrar a agenda ao controle, acrescente `--source-id`, `--fact-prefix`,
`--observed-at` e `--utc-offset` ao comando da planilha. Divida a leitura
se houver mudança de fuso. Salve a saída JSON em local privado e use
`--fragment ARQUIVO.json` ao final de `preview` e `apply`. A planilha fornece
observações de horário. Use um identificador novo para cada captura e
selecione apenas um fragmento por fato alterado.

### Estimativas de rota e previsão

```text
npm run trip:observation -- fetch REQUEST.json --allow-network
npm run trip:observation -- import REQUEST.json RESPONSE.json OBSERVED_AT
```

A importação é local. A consulta exige `--allow-network` e envia as coordenadas
selecionadas a um único fornecedor fixo. Use a consulta quando os termos do
fornecedor e a finalidade autorizarem. Use `kind`, `sourceId` e `factPrefix`
em todas as solicitações.
Rotas recebem `from` e `to`. Previsões recebem `at`, `day` e `timeZone`.
As coordenadas seguem a ordem longitude, latitude.

Cada resultado inclui fonte, hash, instante observado, prazo de reconsulta
e fatos para `--fragment`. O prazo de reconsulta é de 24 horas para rota
e seis horas para previsão. O cálculo pode usar `routeMinutesFact` mais os
minutos operacionais informados pelo operador. A rota OSRM é uma estimativa
sem trânsito ao vivo. A previsão Open-Meteo é resultado de modelo. Consulte
diretamente os avisos meteorológicos oficiais pertinentes.

[Formato OSRM](https://project-osrm.org/docs/v5.24.0/api/) e
[formato Open-Meteo](https://open-meteo.com/en/docs).

`reconcileDocuments({ tripKey, records })` compara snapshots já normalizados,
associados por `reservationKey` explícito. Cada snapshot declara `sourceRef`,
canal, tipo de serviço, fornecedor pseudônimo, estado, instantes, local e dinheiro
em unidades menores. Valores desconhecidos continuam `null`; zero declarado
continua zero. Instantes equivalentes com offsets diferentes são comparados em
UTC. Divergências permanecem visíveis, sem escolher automaticamente a fonte mais
recente ou um fornecedor como verdadeiro. Concordância é
`consistent_as_supplied`, com `independentlyVerified: false`.

O MCP pode oferecer inventário/prévia sobre uma instância já configurada pelo
operador. A integração deve controlar se caminhos relativos podem ser mostrados
ao modelo; IDs opacos não autorizam divulgar nomes de arquivos. Aplicação e
rollback permanecem fora das ferramentas MCP de leitura. O formato de ID não é
um detector de PII: não use localizadores, nomes ou documentos reais como IDs.

## Segurança e recuperação

São rejeitados traversal, caminhos absolutos em entradas relativas, UNC, ADS,
nomes reservados Windows, controles/bidi em nomes, links simbólicos/junctions,
hardlinks, arquivos alterados desde a prévia e raízes dentro de um checkout Git.
Pastas `.git`, `node_modules`, `.venv` e nomes `.env` são excluídos. A raiz é
vinculada a caminho canônico e identidade do diretório. O journal registra
sequência, classe de evento e índice da ação, sem corpos dos documentos.

O lock é cooperativo. Node.js não oferece uma transação atômica de todo o lote
nem uma API `openat` portátil que elimine todas as corridas entre diretórios.
Use uma raiz controlada pelo operador, sem escritores concorrentes ou processos
hostis com a mesma conta do sistema operacional. Abortos, falha de disco ou queda
entre uma escrita e seu registro podem deixar estado parcial. Nesse caso não há
retry automático: a operação informa `needs_reconciliation`, e o rollback recusa
apagar alvos sem registro ou modificados. Isso preserva evidência para revisão,
sem afirmar recuperação automática de toda falha possível.

Testes usam somente pastas TEMP sintéticas, fora de qualquer checkout Git ancestral
(caso contrário a própria guarda as rejeita), e executam cópia, movimento, rollback,
replay, CLI, adulteração, expiração, colisões e ataques de caminho. Nenhuma pasta
pessoal, conta de fornecedor ou reserva real foi acessada na validação.
