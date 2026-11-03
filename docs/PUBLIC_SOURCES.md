# Public sources and practical integration alternatives

The optional CLI offers two compiled public-data readers and a capability catalog:

```text
npm run sources -- --catalog
npm run sources -- --provider ibge-municipality --municipality 3550308 --allow-network
npm run sources -- --provider open-meteo --latitude=-23.55 --longitude=-46.63 --allow-network --non-commercial
```

The example coordinates identify a public city, not a traveler's whereabouts.
Network access is opt-in for each invocation. The default MCP remains offline;
these commands do not expand its allowlist or configure accounts.

The transport performs one fixed-provider HTTPS GET, validates public IPs, pins
the selected DNS result, preserves TLS checks, rejects redirects, applies response
and time bounds, and projects only expected JSON fields. Remote names remain
passive data, never executable instructions. Output includes the response digest,
receipt time, attribution and explicit freshness interpretation. No raw response,
credentials or private evidence is written by the reader. Weather is a forecast,
not a safety guarantee. Administrative identity does not authenticate a supplier.

| Need                                        | Implemented route and boundary                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brazilian municipality identity             | Opt-in official IBGE lookup by municipality ID.                                                                                                                                                  |
| Weather context                             | Opt-in Open-Meteo free endpoint, explicitly non-commercial and attributed. Commercial use requires the provider's suitable plan or a separately reviewed/self-hosted adapter.                    |
| Cadastur/CNPJ confirmation                  | Use a dated official lookup/export or an operator-authorized adapter. A Conecta listing does not grant universal API access; a CNPJ format check is not registration verification.               |
| Flight disruption updates                   | Existing signed event API and reviewed connector/reconciliation contracts, or traveler-supplied updates from the official supplier. ANAC VRA is historical data, not a live-status or fare feed. |
| Fares, promotions and supplier availability | Host-assisted authorized research or a licensed adapter. Preserve observation time, expiry, total-cost scope and unknowns; never synthesize a current fare.                                      |
| Claims and listing discrepancies            | Existing factual dossier export and structured evidence/reviews; traveler reviews the output. No automatic filing, payment or identity/stay certification.                                       |

An unavailable provider yields an explicit failure, not a cached or invented live
result. The operator can use dated documentary input instead, keeping its origin
and age visible. The catalog describes working alternatives and their required
inputs; it does not claim commercial provider credentials were obtained.

Official references checked 2026-11-02:

- [IBGE locality API](https://servicodados.ibge.gov.br/api/docs/localidades).
- [Open-Meteo documentation](https://open-meteo.com/en/docs) and [terms](https://open-meteo.com/en/terms): the free service is non-commercial, with attribution and provider limits.
- [Cadastur government API catalog](https://www.gov.br/conecta/catalogo/apis/cadastur-cadastro-de-prestadores-de-servicos-turisticos/).
- [ANAC VRA dataset](https://www.anac.gov.br/acesso-a-informacao/dados-abertos/areas-de-atuacao/voos-e-operacoes-aereas/voo-regular-ativo-vra).

Provider agreements, rates and availability can change. Check the terms before
deploying a commercial integration. No private account or real traveler document
is required by the synthetic tests.
