# Integração híbrida — auditoria e pacotes regionais

Base adotada: PR #9, commit `e8ef35d5867ac0ce20c34adac62f53f59ba2415c`,
empilhado sobre o PR #8. O trabalho local anterior foi preservado em seu diretório
original; a integração ocorre em outro worktree, sem substituição silenciosa.
Os checks verdes da base não validam o delta híbrido.

| Parte                                              | Decisão                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extrator Python e `package-observation/1` do PR #9 | Reaproveitados como implementação canônica; nenhum segundo extrator concorrente foi incorporado.                                                             |
| Calculador 13 e comando 69 `package-arbitrage`     | Preservados. Desconhecidos, equivalência e condição final governam a leitura do ágio/deságio.                                                                |
| Descoberta local                                   | Acrescentadas 24 referências compiladas, paginação, períodos independentes, origem e destino opcional; MCP offline.                                          |
| Captura estática                                   | Leitor HTTPS delimitado, por ID aprovado, entrega HTML ao Python; cálculo permanece em Node. CLI aceita até 1 MB; MCP até 200 KiB.                           |
| Interface                                          | Período e IANA explícitos, rascunho sem preços presumidos, proteção de resposta obsoleta e tabelas legíveis.                                                 |
| Comparador `ground-transport`                      | Ampliado para ônibus/avião, cafés externos custeados, tarifas infantis e pernoites sem cobertura; legado preservado.                                         |
| Trip Contract                                      | Mantidos `bundledTours`/`bundle` do PR #9, evitando duas classificações concorrentes e cobrança duplicada.                                                   |
| Governança                                         | Mantidas correções de criptografia, moeda e fuso do PR #9. Hash, audit log e cálculo não equivalem a WORM, certificação ou ausência universal de alucinação. |

## Correções após a revisão da base

- Quantidade desconhecida de café deixou de ser substituída por noites no
  calculador de arbitragem. Total/equivalência final ficam pendentes.
- Cafés externos declarados exigem custo, quantidade e cobertura mesmo fora da
  lista global de categorias. Caução ou opcional desmarcado não satisfazem custo.
- Identidade da captura preserva caminho, query e fragmento: uma rota SPA não
  pode receber HTML de outro pacote.
- O renderer de produção do PR #9 permitia requisições fora de escopo. Foi
  desativado antes de qualquer tráfego enquanto não existir homologação de
  contenção de egress. Fixtures e leitura assistida não são chamadas de
  renderização real homologada. Robots usa DNS público fixado e TLS verificado.
- Metadados de captura recebidos por MCP são declarações do caller, não
  atestado de navegador. Fixtures podem ser identificadas explicitamente.
- Normalização Unicode, tags ignoradas e preços parcialmente consumidos têm
  regressões; candidatos não viram automaticamente preço final.

## Limites de leitura do resultado

Uma alternativa aérea a um pacote rodoviário ou uma tarifa sem café pode ter
comparação nominal, mas não demonstra economia equivalente. O calculador 13
trabalha sobre o escopo econômico declarado; validar a janela inteira, o retorno
efetivo e os arranjos de pernoite continua necessário no contrato/roteiro.

Não houve confirmação de vagas, cadastro, reserva ou contratação. Dados reais
de viajantes não foram usados. Revisões desta execução são internas, de mesma
família, e não fecham B.9. Uma release estável depende de seus próprios gates.
