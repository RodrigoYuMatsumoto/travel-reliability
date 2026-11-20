# Public contracts

`trip-contract.schema.json` is the authoritative TripContract contract (JSON Schema 2020-12).
Run `npm run schema:types` to generate TypeScript. CI checks that generated output is current.

Contracts distinguish a quote from a booking and information from confirmation. Null means unknown;
it never means free, safe, confirmed or not applicable. Identifiers are opaque strings, not numbers.
Provider registration requirements belong to a dated country rule and a provider category.

Only bundled, reviewed schemas may be compiled. Remote references and user-supplied schemas are prohibited.

## Precisão documental

Datas sem hora são aceitas nos serviços de hospedagem e seguro. Uma data
sem hora nunca vira um instante de conexão. O registro de seguro
`insuranceEvidence` vincula pedido, pagamento ou emissão a um documento do
serviço. A cobertura do trecho final exige um certificado emitido, a ligação
com o trecho e comprovação do âmbito e da vigência. Contratos antigos sem
esse campo continuam legíveis e ficam com emissão a verificar.
