# Travel Reliability

**Contratos de viagem abertos, provas organizadas e recuperação rastreável. Brasil primeiro, arquitetura global.**

[English](README.md) · [Planejamento e rateio](docs/PLANNING.md) · [Segurança](SECURITY.md) · [Evidências de entrega](docs/IMPLEMENTATION_STATUS.md)

Organize reservas, condições, conexões, comprovantes, ocorrências e pedidos de reembolso. O sistema distingue informação declarada, extraída e confirmada; valores ausentes continuam desconhecidos. Nenhuma compra, reclamação ou mensagem é enviada automaticamente.

## Executar

Instale Node.js 24 e execute na raiz:

```sh
npm ci
npm run demo
```

Abra **http://127.0.0.1:5173** e selecione **Explorar demonstração**. Os dados são fictícios, efêmeros e não acionam IA. Para o servidor compilado, use `npm run build` e `npm start`, em **http://127.0.0.1:4310**.

## Funcionalidades

- Contrato JSON para voo, ônibus, hotel, temporada, passeio, veículo, seguro e conexão; exportação JSON/PDF/iCal.
- Checklist pré-compra/pré-embarque, custo por moeda, margem de conexão e lacunas de pernoite.
- Preservação criptografada do original, hash, trecho-fonte, aplicação humana e exclusão de derivados.
- Ocorrências e regras brasileiras versionadas por vigência, com fontes e hipóteses pendentes.
- Dossiê factual com cronologia, valores de reembolso e manifesto; pacote criptografado verificável offline.
- Avaliações privadas vinculadas a comprovante e publicação moderada; rotas versionadas com proveniência.
- Nove ferramentas: datas flexíveis, aeroportos/companhias, conexões, promoções, custo total, alteração/reembolso, negociação, hidden-city e grupo/rateio.
- OIDC e permissões por workspace; interface pt-BR/en e PWA instalável.

Os cálculos não dependem de LLM. Extração assistida por IA é opcional, exige configuração e consentimento, recebe trechos delimitados e gera propostas sujeitas à revisão. Não confirma autenticidade, reserva ou direito a indenização.

Para PDF, imagens, DOCX, HTML e EML, use o worker isolado com OCR nativo. Para dados duráveis, siga [operações](docs/OPERATIONS.md): HTTPS, OIDC, PostgreSQL, Redis, armazenamento privado e gestão de chaves. A demonstração em memória não deve ser seu único arquivo de provas.

As ferramentas operam documentalmente. Não há conector de inventário aéreo, consulta automática a CNPJ/Cadastur ou monitor de voo ativo por padrão. Dados do fornecedor devem ser importados ou recebidos por integração configurada; ausência de integração nunca vira disponibilidade simulada.

Código, schemas, prompts e documentação: Apache-2.0. Exemplos sintéticos explicitamente identificados: CC0-1.0. [Contribuir](CONTRIBUTING.md) · [Relatar vulnerabilidade](SECURITY.md).
