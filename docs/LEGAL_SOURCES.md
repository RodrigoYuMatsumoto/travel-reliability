# Brazilian information pack: source record

Verified on 2026-10-29. Machine-readable scope and effective intervals are in
`rules/br/rules.json`; review is due on 2026-11-28. Unknown facts or stale rules
produce `needs_review`. This is a limited information pack, not a complete legal
decision engine or automated consumer-law opinion.

| Subject                           | Official source and scope                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Air transport                     | [ANAC Resolution 400/2016](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/2016/resolucao-no-400-13-12-2016), as amended; assistance and disruption scope must be checked against the actual flight and event.                                                                                              |
| 2026 assistance changes           | [ANAC Resolution 813/2026](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/2026/resolucao-813): the former art. 27(I) communication threshold is historical from 2026-10-26; assistance exceptions/alternatives affect application.                                                                         |
| Future information wording        | [ANAC Resolution 819/2026](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/2026/resolucao-819): the new art. 20 wording has a separate 2026-11-25 effective date.                                                                                                                                           |
| Regular interstate road transport | [ANTT Resolution 6,033/2023](https://anttlegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&numeroAto=00006033&tipo=RES&valorAno=2023&orgao=DG/ANTT/MT&seqAto=000): arts. 179, 181–182; art. 264 establishes 2024-02-01 commencement. Not automatically applicable to urban, intermunicipal or charter services. |
| Tourism registration              | [Official Cadastur service](https://www.gov.br/pt-br/servicos/cadastrar-prestadora-de-servico-turistico): applicability depends on provider category. A registration does not guarantee quality, solvency or delivery.                                                                                                          |

The contract models CNPJ/other registrations and Cadastur conditionally. Neither
is a universal mandatory identifier for every provider worldwide. Unknown
applicability remains visible; no synthetic active registration is invented.

No automatic liability, abusive-clause finding, compensation amount, universal
refund entitlement or claim filing is produced. A factual dossier keeps user
reports distinct from supplier-confirmed facts. Consumer/privacy statutes and
other jurisdictions require case-specific analysis and official source review;
the software does not claim comprehensive CDC/LGPD compliance certification.

Country-pack review must follow: official text → commencement/amendments → exact
provision → factual prerequisites → consequence → exceptions → procedure. Each
change requires regression tests for thresholds and temporal transitions.

## CNPJ format checks

The numeric/alphanumeric checksum follows the [Receita Federal/Serpro technical manual](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf), checked during the reference comparison. This is a mathematical format check: it does not establish an active registration, ownership, Cadastur status or supplier reliability.
