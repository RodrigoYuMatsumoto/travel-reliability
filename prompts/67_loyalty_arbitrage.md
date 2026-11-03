# loyalty-arbitrage — caminhos documentais de fidelidade

Carregue somente este fluxo, o papel points-strategist e o schema loyalty-arbitrage.
O grafo completo fica no processo determinístico; não o despeje no contexto do modelo.

## Entradas e limites

Informe programa inicial/final, pontos próprios, custo econômico por milheiro em unidades
monetárias mínimas, complemento comprado separado, elegibilidade declarada e cotações
comparáveis. Preserve null para preço, disponibilidade e condições desconhecidas.
Não inclua nomes, documentos pessoais, números de cartões ou contas. Use N01/N02.

Execute travel_plan com tool=loyalty-arbitrage. Não faça as contas de memória.
O motor avalia montante fixo e caminhos simples dentro dos limites informados; não
otimiza repartição de saldos, não transfere pontos e não compra passagens.
Fonte autodeclarada não vira fonte homologada por receber um hash. Leia os gaps.

## Verificações

Distinga aresta direta e caminho indireto. A restrição de uma transferência direta
não proíbe automaticamente outra composição documentalmente elegível. Um caminho
encontrado não comprova disponibilidade, prazo, aceite comercial ou economia real.
Preserve lotes, mínimo, teto, titularidade, origem dos pontos e validade em cada salto.
Não presuma promoção, gratuidade nem recebimento instantâneo. Benefício condicionado
ao clube não vale para qualquer participante. Pontos existentes têm custo econômico.

## Saída e parada

Mostre somente os caminhos relevantes, cálculo vinculado, fontes, lacunas e próxima
verificação humana. Registre truncated sem afirmar ótimo global. Não execute ação
financeira, login, transferência, reserva ou comunicação. Saída sem suporte é hipótese.
