# Arbitragem de pacotes regionais (Regional Package Arbitrage)

Este fluxo compara uma excursão fechada de agência regional com a compra separada do mesmo roteiro. A excursão costuma ser ônibus mais hospedagem e café. A compra separada é a passagem de ônibus e/ou de avião mais a hospedagem com café, ou mais a hospedagem sem café. O resultado mostra o **ágio** (o pacote custa mais que o avulso) ou o **deságio** (o pacote custa menos), cenário por cenário. O fluxo tem duas partes isoladas:

| Parte         | Linguagem | Onde fica                        | O que faz                                                               | O que não faz                                           |
| ------------- | --------- | -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Extração      | Python    | `ingest/travel_ingest/packages/` | Lê o HTML de uma página de pacote e devolve fatos literais com citações | Calcular, comparar, inventar preço ou ano, ler contatos |
| Reconciliação | Node.js   | `api/src/package-arbitrage.ts`   | Soma em inteiros, confere a equivalência e classifica ágio ou deságio   | Acessar a rede, buscar preços, converter moedas         |

O contrato entre as duas partes é a observação `package-observation/1` (`schema/src/package-observation.ts`). Todo valor desconhecido é `null`.

## Fontes suportadas pelo extrator

| Site               | Detecção                    | Particularidades                                                                                                                                                                            |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atrativa Tur       | `atrativatur.com.br`        | HTML no servidor. Rótulos `Saída`, `Chegada`, `Acomodação`, `Valor à vista` e blocos `INCLUSO` e `NÃO INCLUSOS`. Ano com dois dígitos                                                       |
| Niel Turismo       | `*.suareservaonline.com.br` | Página grande. O cabeçalho `Saída ... Volta` vem sem ano, e os embarques trazem a data completa. A seção de pacotes recomendados é ignorada                                                 |
| Viajantes do Valle | `viajantesdovalle.com.br`   | Loja com JSON-LD `Product`. O título e a descrição não trazem o ano. O valor não diz se é por pessoa. A hospedagem pode mudar                                                               |
| Augustus Turismo   | `augustusturismo.com.br`    | Aplicação em JavaScript. O HTML estático traz pacotes de demonstração e **não é evidência**: é preciso a página renderizada. O site pode calcular a data de volta e ajustar o ano das datas |
| Outros             | qualquer outro host         | Leitura genérica e conservadora, com mais campos nulos                                                                                                                                      |

Instagram é apenas uma pista de descoberta. Este extrator não implementa coleta de perfis, acesso autenticado ou mensagens; conteúdo público fornecido pelo operador continua sujeito às permissões e condições aplicáveis.

## Como obter a página

1. **Pelo host da LLM.** Se o host tem navegação autorizada, ele obtém a página e envia o HTML à ferramenta MCP `travel_extract_package`. Ela aceita até 200 KiB; antes de enviar, remova `<script>` e `<style>`, mas preserve `application/ld+json`. O MCP continua offline: a ferramenta só lê o texto recebido.
2. **Pelo operador, sem rede.** Salve a página e rode:

   ```text
   uv run --project ingest python -m travel_ingest.packages parse --html-file pagina.html --url https://... --observed-at 2026-11-04T09:00:00-03:00 --retrieval static_html
   ```

3. **Renderização externa isolada, opcional.** O subcomando `fetch` exige `--allow-network` e uma imagem Docker imutável configurada pelo operador. Sem imagem válida ou Docker disponível, falha antes de DNS, robots ou navegação. Não instala nem habilita um navegador com acesso direto à rede.

### Preparação do renderer

Com Docker em contêineres Linux e Python 3.12/uv já preparados, execute na raiz do código-fonte:

```sh
docker build --build-arg PLAYWRIGHT_BASE=mcr.microsoft.com/playwright/python:v1.64.1-noble@sha256:330d401ae23c905896a0c26c66c36fc971b621519e7b11b435a8328d7bf6e031 -f deploy/renderer/Dockerfile --iidfile renderer_image.id .
export TRAVEL_RELIABILITY_RENDERER_IMAGE="$(cat renderer_image.id)"
uv run --project ingest python -m travel_ingest.packages fetch --url 'https://augustusturismo.com.br/#/pacote/morro-de-sao-paulo-natal-2026-619-2026-12-23' --observed-at 2026-11-11T12:00:00Z --allow-network --then parse
```

No PowerShell, substitua a linha de exportação por `$env:TRAVEL_RELIABILITY_RENDERER_IMAGE = Get-Content -LiteralPath renderer_image.id`. Informe a data/hora real da leitura em `--observed-at`; o exemplo não comprova disponibilidade ou vigência de uma oferta. `renderer_image.id` é um identificador local de imagem, não uma credencial. A imagem é opcional e independente da demonstração e do MCP offline.

### Contenção e proveniência

O Chromium roda com usuário não privilegiado e sandbox ativo, `--network none`, sistema de arquivos somente leitura, capacidades removidas, sem volumes do host e com limites de memória, CPU, processos, tempo e protocolo. A configuração efetiva do contêiner é inspecionada antes da execução. O perfil seccomp e as dependências da imagem são fixados por hashes; a licença de terceiros permanece em `deploy/renderer`.

O broker no host é o único componente com rede. Ele fornece recursos por protocolo STDIO limitado, aceita somente GET HTTPS em destinos autorizados, verifica todos os endereços DNS e fixa o IP da conexão, mantém SNI e certificado TLS, recusa redirecionamentos e aplica limites globais de requisições, bytes e tempo. Cookies e credenciais do operador não são encaminhados. Preflight CORS é respondido localmente, sem enviar OPTIONS ao fornecedor. WebSockets, downloads, service workers, novas páginas e mudanças de produto são bloqueados ou encerram a execução.

O aplicativo público Augustus usa um identificador anônimo publicado pelo próprio site. Quando necessário, o broker o mantém somente em memória e o restringe aos dois endpoints GET públicos compilados. Ele não vem de conta, variável de ambiente ou mensagem do usuário; não é gravado no recibo. O JSON obrigatório precisa conter o produto solicitado: resposta vazia, identidade ambígua ou ausência de dados não autoriza usar os pacotes de demonstração embutidos na página.

`robots.txt`, regras RFC 9309 e `Content-Signal: ai-input=no` são respeitados para cada origem. Os provedores e recursos suportados são compilados; mudança de API, política, HTML ou disponibilidade pode produzir indisponibilidade explícita. Não existe fallback para navegador irrestrito, página antiga ou preço inventado.

O resultado registra `retrieval: rendered_dom`, identidade exata da página, imagem, isolamento e hashes dos recursos consultados. Isso demonstra a cadeia técnica de captura dentro do escopo testado; não autentica o fornecedor nem confirma vagas, preço final ou condições comerciais. Callbacks Python injetados em testes continuam exigindo o par completo e gerando apenas `retrieval: fixture`.

Os testes herméticos usam Docker/Chromium reais na CI e tentam alcançar um canário do host sem passar pelas rotas do Playwright. Um teste público separado exige autorização operacional explícita, grava somente metadados e preserva causas de indisponibilidade, sem armazenar HTML, contatos ou preços.

Para descobrir viagens parecidas, use o modo `listing` sobre a página de listagem ou catálogo da agência. Ele devolve os links, os títulos, a data de saída e o preço “a partir de”, quando estiverem visíveis.

## Cotações da compra separada

As cotações vêm de quem usa o fluxo, cada uma com fonte e data:

- **Transporte:** `bus` e/ou `air`, ida e volta (`round_trip`) ou trechos separados, por pessoa ou por grupo.
- **Hospedagem:** `breakfast` (com café) ou `room_only` (sem café), por quarto e noite ou pela estadia. As noites e os quartos têm de bater com o pacote.
- **Café avulso:** opcional, por pessoa e dia, para montar o cenário com café a partir da hospedagem sem café. Se o pacote inclui café, os dias seguem a contagem declarada no pacote; se o pacote não inclui café, seguem as noites de hospedagem, e o cenário continua sendo alternativa, não equivalente.
- **Extras:** traslados, taxas, passeios e refeições que reproduzem o que o pacote inclui (`mirrorsPackageInclusion: true`).

## Leitura do resultado

Cada cenário combina um modal com um regime de café. Ele traz:

- o total do pacote e o total avulso;
- a diferença em valor e em pontos-base;
- a classificação: `agency_premium` (ágio), `agency_discount` (deságio), `parity` ou `not_computable`;
- `equivalent`, que diz se o cenário é equivalente ao pacote.

Só um cenário **equivalente e final** sustenta a afirmação de economia. Para isso, o modal, o café e as noites precisam ser iguais aos do pacote. Avião contra ônibus, ou hospedagem sem café contra pacote com café, são alternativas: aparecem no resultado, mas não são economia.

Estes casos deixam o resultado não final:

- ano não declarado;
- preço “a partir de”;
- base de preço desconhecida;
- preço de criança desconhecido;
- fonte posterior ao instante da avaliação;
- cotação sem fonte;
- fonte que não foi observada diretamente (`declared` ou `indicative`);
- fonte, ou página do pacote, observada mais de 7 dias antes da avaliação, porque preço de pacote muda rápido (é uma política do calculador, não uma norma);
- total avulso igual a zero.

Moedas diferentes tornam o cenário não calculável, porque o fluxo não converte câmbio.

O Trip Contract registra o resultado em `bundledTours`, com o recibo de cálculo. Os serviços que fazem parte do pacote recebem a marcação `bundle`.

## Limites

- Extração não é confirmação do fornecedor: preço publicado não garante disponibilidade, e o pacote pode mudar.
- A estrutura das páginas muda sem aviso. Um campo não reconhecido fica nulo e nunca é preenchido por estimativa.
- Taxas obrigatórias seguem o que a página diz:
  - taxa já incluída no valor (`in_package`) não é somada de novo e aparece em `includedFeesMinor`;
  - taxa paga no local (`paid_locally`) entra no total e aparece também em `localCashMinor`, como dinheiro em espécie;
  - taxa sem essa informação (`unknown`) fica pendente e não é somada.
- O fluxo não emite parecer sobre contrato, cancelamento ou direitos do consumidor.
- As fixtures de teste são sintéticas, com hosts `example.invalid`. Nenhuma página real é copiada para o repositório.
