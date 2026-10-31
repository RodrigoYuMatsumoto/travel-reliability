# Unicode em exportações

JSON e iCalendar preservam UTF-8. O PDF verifica previamente todos os textos que serão
renderizados; um único caractere sem cobertura impede a geração completa. Não há
transliteração, substituição silenciosa ou fallback por trecho.

## Configuração do operador

Sem configuração, o PDF usa Helvetica padrão e aceita caracteres da codificação WinAnsi.
Para outros alfabetos, configure uma fonte local licenciada para incorporação:

```powershell
$env:PDF_FONT_PATH = 'C:/Windows/Fonts/arial.ttf'
# Opcional para um arquivo de fonte individual; nome PostScript exato quando definido.
$env:PDF_FONT_FAMILY = 'ArialMT'
npm start
```

```sh
export PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
export PDF_FONT_FAMILY=DejaVuSans
npm start
```

O caminho deve ser absoluto, local e regular, com no máximo 32 MiB. Links simbólicos,
caminhos de rede/URL e alternate data streams são recusados. Em coleções TTC/dfont,
`PDF_FONT_FAMILY` deve identificar a face pelo nome PostScript. Em fonte individual,
omita a variável se desconhecer esse nome. A fonte escolhida precisa cobrir também os
rótulos fixos em português/inglês. Uma fonte só de ideogramas pode ser insuficiente.

Essas opções são configuração confiável do processo. Não existem campos de fonte nos
pedidos HTTP, documentos importados ou ferramentas MCP. A configuração valida o caminho;
a existência e cobertura são verificadas em cada exportação. Os mesmos bytes lidos e
verificadas são incorporadas, sem reabrir o caminho durante a renderização. Nenhuma fonte
é baixada, distribuída ou instalada automaticamente. Respeite a licença da fonte escolhida.

## Falhas explícitas

| Código                                     | Consequência                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `PDF_FONT_MISSING_GLYPH` (422)             | A fonte não cobre algum texto; selecione outra fonte.                      |
| `PDF_FONT_CONFIGURATION_INVALID` (503)     | Caminho/família inválidos na configuração do operador.                     |
| `PDF_FONT_UNAVAILABLE` (503)               | Arquivo ausente, não regular, alterado durante leitura ou acima do limite. |
| `PDF_FONT_INVALID_OR_FACE_NOT_FOUND` (503) | Arquivo inválido ou nome PostScript incorreto.                             |
| `PDF_FONT_FACE_REQUIRED` (503)             | Coleção sem face selecionada.                                              |
| `PDF_TEXT_LIMIT` (422)                     | Mais de 2 milhões de unidades UTF-16 no conjunto a renderizar.             |
| `PDF_RENDER_FAILED` (500)                  | O renderizador não concluiu a geração.                                     |

Erros não revelam texto, caracteres, caminhos, nomes de face nem mensagens do parser.
O código de cobertura não substitui exame de conteúdo ou revisão probatória.

## Verificação e limites tipográficos

```sh
uv sync --project ingest --locked
npx vitest run tests/pdf-unicode.test.ts
```

Os testes usam apenas dados sintéticos, a fonte Arial do Windows ou DejaVu Sans do Linux
e o `pypdf` já preparado no ambiente de ingestão. No Linux/CI, instale previamente
`fonts-dejavu-core` pelo mecanismo do sistema. O teste não instala dependências e falha
claramente se a fonte ou `ingest/.venv` não estiverem disponíveis. Ele demonstra extração
independente fiel de cirílico, continuidade do PDF latino, UTF-8 em JSON/iCalendar e recusa
de fonte/cobertura inválidas.

Arial e DejaVu Sans não cobrem todas as línguas, inclusive diversos ideogramas CJK.
Cobertura por glifo é condição necessária, mas não certifica ordem bidirecional, shaping,
ligaturas, escrita vertical, diacríticos combinantes, quebras ou seleção/cópia em todos os
leitores. Faça revisão visual específica antes de usar tipografia complexa em produção.
Não se declara suporte universal a línguas.

APIs oficiais verificadas em 31/10/2026:
[PDFKit: fontes e texto](https://pdfkit.org/docs/text.html),
[fontkit: `create` e `hasGlyphForCodePoint`](https://github.com/foliojs/fontkit),
[codificação WinAnsi do PDFKit 0.20.2](https://github.com/foliojs/pdfkit/blob/v0.20.2/lib/font/afm.js).
`fontkit` é dependência direta fixada em 2.0.4, a mesma versão já travada pelo PDFKit.
