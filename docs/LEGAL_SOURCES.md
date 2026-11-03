# Brazilian information pack: source record

Verified on 2026-11-01. Machine-readable scope and effective intervals are in
`rules/br/rules.json`; review is due on 2026-12-01. Unknown facts or stale rules
produce `needs_review`. This is a limited information pack, not a complete legal
decision engine or automated consumer-law opinion.

| Subject                           | Official source and scope                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Air transport                     | [ANAC Resolution 400/2016](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/resolucoes-2016/resolucao-no-400-13-12-2016), as amended; assistance and disruption scope must be checked against the actual flight and event. Original art. 27(I)-(III) (communication, food and lodging) and art. 20 entries cover earlier events.                                                                                      |
| 2026 assistance changes           | [ANAC Resolution 813/2026](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/2026/resolucao-813): the former art. 27(I) communication threshold is historical from 2026-10-26; the new art. 27 caput limits material assistance to national territory; assistance exceptions/alternatives affect application.                                                                                                          |
| Future information wording        | [ANAC Resolution 819/2026](https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/2026/resolucao-819): the new art. 20 wording has a separate 2026-11-25 effective date.                                                                                                                                                                                                                                                    |
| Regular interstate road transport | [ANTT Resolution 6,033/2023](https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&link=S&tipo=RES&numeroAto=00006033&seqAto=000&valorAno=2023&orgao=DG%2FANTT%2FMT&cod_modulo=420&cod_menu=7734): arts. 179 (departure delay over one hour or cases under art. 178, III and V), 181-182; art. 264 establishes 2024-02-01 commencement. Not automatically applicable to urban, intermunicipal or charter services. |
| Tourism registration              | [Official Cadastur service](https://www.gov.br/pt-br/servicos/cadastrar-prestadora-de-servico-turistico): applicability depends on provider category. A registration does not guarantee quality, solvency or delivery.                                                                                                                                                                                                                   |

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

## Air lodging: overnight exception

Rechecked the official ANAC 813/2026 and 819/2026 texts on 2026-11-02. Article
27(III) normally requires an overnight need; paragraph 2 expressly removes that
requirement for passengers with disabilities or reduced mobility and their
companions, subject to adequate substitute accommodation with express consent.
The [historical paragraph 2](https://www.anac.gov.br/acesso-a-informacao/reunioes-da-diretoria-colegiada/reunioes-deliberativas-da-diretoria/2016/26a-reuniao-deliberativa-da-diretoria/00058-054992-2014-33/ra2016-0400-retificada.pdf)
also provided an overnight exception for PNAE and companions. `specialAssistance` is only a declaration of a potentially qualifying
condition, not proof of eligibility or of every accommodation exception. Lodging
advice without overnight need therefore remains visible but always returns
`needs_review`, including under the historical wording. The exception is not
removed. The future article 20 entry links to Resolution 819/2026, which expressly
amends Resolution 813/2026 and fixes commencement on 2026-11-25.

## Aggregate bus assistance: component review

Rechecked the official ANTT text on 2026-11-02: article 181(2) conditions lodging
on inability to continue that day; paragraph 4 permits its omission for a resident
at the origin when return transport is assured. Article 182 treats full-refund
choices and incidents/accidents/assaults separately. The current event contract
does not establish all those facts. `BR-BUS-CONTINUITY` therefore always returns
`needs_review`, including for nonresidents, and requests same-day continuity and
residence/transfer evidence. Its aggregate message never confirms every component.
This does not withdraw article 179 alternatives with otherwise established scope.

Article 179 also covers article 178(V): another reason attributable to the carrier
that interrupts or delays the trip. The current engine models departure delay
and cancellation branches only; it does not classify every interruption or
determine carrier responsibility. `waitingMinutes` is a declared elapsed-time
proxy from scheduled departure or actual interruption, not an independent timer.
The strict over-180-minute continuity trigger cannot establish every article 181
prerequisite and always produces component review.

`applicable` means only that the modeled prerequisites match declared facts; it is
not a supplier obligation adjudicated by the software. Refund choice and unknown
or active exceptional conditions retain their existing conservative review guard.

## CNPJ format checks

The numeric/alphanumeric checksum follows the [Receita Federal/Serpro technical manual](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf), checked during the reference comparison. This is a mathematical format check: it does not establish an active registration, ownership, Cadastur status or supplier reliability.
