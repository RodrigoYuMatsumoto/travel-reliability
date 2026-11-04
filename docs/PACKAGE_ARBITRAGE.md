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

Instagram não é suportado: a página exige login, e os termos de uso não permitem coleta automática.

## Como obter a página

1. **Pelo host da LLM.** Se o host tem navegação autorizada, ele obtém a página e envia o HTML à ferramenta MCP `travel_extract_package`. Ela aceita até 200 KiB; antes de enviar, remova `<script>` e `<style>`, mas preserve `application/ld+json`. O MCP continua offline: a ferramenta só lê o texto recebido.
2. **Pelo operador, sem rede.** Salve a página e rode:

   ```text
   uv run --project ingest python -m travel_ingest.packages parse --html-file pagina.html --url https://... --observed-at 2026-11-04T09:00:00-03:00 --retrieval static_html
   ```

3. **Pelo operador, com rede autorizada.** O subcomando `fetch` exige `--allow-network` e só aceita os quatro hosts suportados. Ele confere o robots.txt para o agente `TravelReliabilityPackageReader` e recusa o site que declarar `Content-Signal: ai-input=no`. A renderização usa o Playwright para Python, que não é dependência obrigatória e precisa ser instalado à parte, junto com o navegador.

Para descobrir viagens parecidas, use o modo `listing` sobre a página de listagem ou catálogo da agência. Ele devolve os links, os títulos, a data de saída e o preço “a partir de”, quando estiverem visíveis.

## Cotações da compra separada

As cotações vêm de quem usa o fluxo, cada uma com fonte e data:

- **Transporte:** `bus` e/ou `air`, ida e volta (`round_trip`) ou trechos separados, por pessoa ou por grupo.
- **Hospedagem:** `breakfast` (com café) ou `room_only` (sem café), por quarto e noite ou pela estadia. As noites e os quartos têm de bater com o pacote.
- **Café avulso:** opcional, por pessoa e dia, para montar o cenário com café a partir da hospedagem sem café.
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
