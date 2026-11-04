---
lang: pt-BR
title: Fixtures sintéticas do extrator de pacotes
subject: Páginas sintéticas e saídas esperadas do extrator de pacotes rodoviários regionais
license: CC0-1.0
---

# Fixtures sintéticas do extrator de pacotes

Todas as páginas desta pasta são **sintéticas**. Elas imitam apenas a *estrutura* das páginas
de pacotes rodoviários das agências suportadas (Atrativa Tur, Niel Turismo, Viajantes do Valle
e Augustus Turismo), observada em 04/11/2026. Nenhum texto, preço, nome, hotel, cidade,
telefone ou endereço real foi copiado: destinos, hotéis e cidades são “Sintético(a)”, os preços
são fictícios e os contatos seguem o padrão falso `+55 00 00000-0000`.

As URLs usam hosts `*.example.invalid`, que nunca resolvem; por isso os testes passam o site
explicitamente (`site=`). Nenhum teste acessa a rede.

Licença: **CC0-1.0** (domínio público). Não há dados pessoais nem dados reais.

## Arquivos

| Fixture | Site | Recuperação | O que exercita |
|---|---|---|---|
| `atrativa_detail.html` | atrativa | `fixture` | ano com dois dígitos, parcelas, café parcial, contato dentro de item incluso |
| `atrativa_listing.html` | atrativa | `fixture` | listagem `viagem.php?local=&data=` com cartões |
| `niel_detail.html` | niel | `fixture` | `Saída`/`Volta` sem ano, embarques com data completa, “A partir de”, investimento, taxa obrigatória paga no ônibus, seção `Atividades recomendadas` que não pode vazar |
| `valle_detail.html` | valle | `fixture` | JSON-LD `Product`, datas sem ano, `basis` desconhecido, ressalva de hospedagem, WhatsApp falso que não pode vazar |
| `valle_listing.html` | valle | `fixture` | catálogo com link de WhatsApp e link de outra loja que devem ser ignorados |
| `augustus_static_shell.html` | augustus | `static_html` | casca estática com pacotes de demonstração no script, que não são evidência |
| `augustus_rendered_detail.html` | augustus | `rendered_dom` | DOM renderizado do detalhe (`.detail-info`, `.summary-rows`, `.price-box`) |
| `augustus_rendered_listing.html` | augustus | `rendered_dom` | grade `.pkg-grid` renderizada |
| `injection_atrativa.html` | atrativa | `fixture` | a mesma página de `atrativa_detail.html` com frases de injeção visíveis, ocultas e em comentário |

## Saídas esperadas

- `expected/<nome>.json`: observações `package-observation/1` (uma por página de detalhe), no
  formato canônico (`json.dumps` com `ensure_ascii=False`, `sort_keys=True`, `indent=2` e quebra
  de linha final). O lado Node valida estes arquivos contra `schema/src/package-observation.ts`.
- `expected/listings/<nome>.json`: candidatos de descoberta (`parse_listing`), que **não** são
  observações e não seguem aquele schema.

Para regenerar após uma mudança intencional no extrator:

```bash
PACKAGES_UPDATE_GOLDENS=1 uv run --project ingest python -m pytest ingest/tests/test_packages_golden.py -q
```

Revise o diff gerado antes de aceitar: cada valor novo precisa ter citação literal em `evidence`.
