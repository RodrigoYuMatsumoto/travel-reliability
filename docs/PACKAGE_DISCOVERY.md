# Descoberta de excursões e comparação de pacotes

O catálogo inicial contém 24 referências fornecidas pelo operador para Atrativa,
Niel, Viajantes do Valle e Augustus: programações, páginas de pacote e perfis
sociais. Não é cadastro oficial, recomendação de fornecedor, cotação ou catálogo
mundial completo. As referências regionais são opcionais; não mudam o escopo
internacional dos contratos.

## Uso simples

Na aplicação, abra **Planejamento e rateio**, informe cidade de saída, destino
opcional e até quatro períodos independentes. **Encontrar páginas das agências**
organiza links sem navegar. **Abrir fonte** abre uma página por escolha do usuário.
Datas no título ou URL não provam ano, vaga ou retorno dentro da janela.

**Preparar comparação sem preços presumidos** cria alternativas de pacote,
ônibus e avião, com hospedagem com e sem café. Valores, composição, ocupação e
condições começam desconhecidos; o link da agência não sustenta tarifas de
ônibus, avião ou hotel de outro fornecedor. O rascunho usa BRL e America/Recife
para esta região; revise moeda e fusos antes de reaproveitá-lo em outra viagem.
Os exemplos restaurados são fictícios, separados da pesquisa selecionada.

O host de IA pode preencher o contrato com observações revisadas e apresentar
o resultado em linguagem comum. JSON avançado é uma interface técnica, não
requisito para usar o kit de instruções pelo host.

## MCP e terminal

`travel_schema(name: "package-discovery")` descreve a entrada de
`travel_discover_packages(input: {...})`. A ferramenta é offline, paginada e não
adiciona permissão de rede. Após revisão das ofertas, use `travel_plan` com
`tool: "ground-transport"` para cálculos e recibos.

```sh
npm run packages -- --catalog
npm run packages -- --origin "Petrolina, PE" --start 2026-12-24 --end 2026-12-27 --second-start 2026-12-30 --second-end 2027-01-03
```

Cada referência tem um `sourceId`. Para consultar uma fonte estática específica:

```text
npm run packages -- --capture SOURCE_ID --allow-network
```

Substitua `SOURCE_ID` por um ID retornado pela descoberta. No máximo quatro IDs
por chamada. Não há opção de URL arbitrária, login, cookies, envio de mensagens,
reserva ou pagamento. Falhas individuais são registradas como indisponibilidade,
não como inexistência de ofertas; se todas as capturas falharem, o CLI sai com
código 2. Sem `--allow-network`, nenhuma captura ocorre.

## Interpretação e segurança

- Instagram é pista; não se extrai conta privada, comentários ou mensagens.
- Rotas `#/pacote/...` do Augustus exigem consulta da página renderizada. HTTP
  não envia o fragmento; a raiz ou dados de fallback não confirmam o pacote.
- Atrativa preserva IDs e parâmetros de consulta; Viajantes preserva `&` no
  caminho; Niel permanece limitado ao tenant informado.
- HTTPS fixa DNS público, recusa redirects e endereços privados, limita bytes,
  descompressão e tempo, sem repetição automática. Encodings declarados e
  suportados são tratados; leitura inválida não vira texto faltante.
- HTML e scripts não são executados ou persistidos pelo leitor Node, que só
  transporta e decodifica bytes. A extração tem um único responsável: o extrator
  Python de arbitragem.
- O primeiro ou menor `R$` pode ser extra ou parcela. No extrator Python, preço literal exige contexto explícito e unidade ou condições desconhecidas ficam pendentes. Não certifica oferta ou disponibilidade.
- Cadastur, identidade jurídica, capacidade de operação, quarto e condições
  da tarifa requerem verificação própria. Hash e recibo não substituem essa etapa.

Veja [custo completo e equivalência](GROUND_TRANSPORT.md). Ambos os sentidos do
transporte e a chegada efetiva à origem importam. Café fora do hotel exige
quantidade e orçamento explícitos; hospedagem sem café não é automaticamente
comparável a uma tarifa com café incluído.

## Partir de uma URL

`npm run packages -- --url "https://atrativatur.com.br/viagem.php?v=1823"` devolve o plano sem rede. Com `--allow-network`, uma URL compilada de produto estático passa por HTTPS delimitado e pelo extrator Python canônico. O CLI admite até 1 MB e o MCP até 200 KiB, sem truncamento. A extração usa o contrato package-observation/1 do Python. O plano sem rede informa em `captureStatus` o que a captura aceita: página de pacote estática (`explicit_network_approval_required`), catálogo que exige escolher o link do pacote (`package_detail_source_required`) ou perfil social e página renderizada, que exigem leitura assistida (`assisted_source_required`). Nos dois últimos casos, `--allow-network` recusa a captura sem acessar a rede. Nenhum preço literal autentica fornecedor ou confirma vaga.
