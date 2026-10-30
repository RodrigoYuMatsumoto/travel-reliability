import { Temporal } from '@js-temporal/polyfill';
import type { LiteralFact } from '../../schema/src/domain.js';
const places: Record<string, number> = {
  BRL: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};
/** Only explicit labels and unambiguous literals; no date, currency or component defaults. */
export function literalFacts(text: string): LiteralFact[] {
  const facts: LiteralFact[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (facts.length >= 30) break;
    const source = { line: index + 1, quote: line.slice(0, 600) };
    const supplier = /^(?:supplier|provider|fornecedor|prestador)\s*:\s*(.{1,200})$/i.exec(
      line.trim(),
    );
    if (supplier) facts.push({ kind: 'supplier', value: supplier[1]!, state: 'extracted', source });
    const date =
      /^(?:date|data|departure|arrival|partida|chegada|check[- ]?in|check[- ]?out)\s*:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)\s*$/i.exec(
        line.trim(),
      );
    if (date)
      try {
        const value = date[1]!;
        if (value.length === 10) {
          Temporal.PlainDate.from(value);
          facts.push({
            kind: 'date',
            value: { iso: value, precision: 'date' },
            state: 'extracted',
            source,
          });
        } else if (/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
          Temporal.Instant.from(value);
          facts.push({
            kind: 'date',
            value: { iso: value, precision: 'offset_datetime' },
            state: 'extracted',
            source,
          });
        } else {
          Temporal.PlainDateTime.from(value);
          facts.push({
            kind: 'date',
            value: { iso: value, precision: 'local_datetime_zone_unknown' },
            state: 'extracted',
            source,
          });
        }
      } catch {
        /* Invalid or ambiguous source remains unparsed. */
      }
    const amount =
      /^(?:total(?: paid)?|valor total|amount|pre[cç]o)\s*:\s*([A-Z]{3}|R\$)\s*([0-9][0-9.,]{0,40})\s*$/i.exec(
        line.trim(),
      );
    if (amount) {
      const currency = amount[1]!.toUpperCase() === 'R$' ? 'BRL' : amount[1]!.toUpperCase(),
        digits = places[currency];
      if (digits === undefined) continue;
      let raw = amount[2]!;
      if (currency === 'BRL' && raw.includes(',')) {
        if (!/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(raw)) continue;
        raw = raw.replaceAll('.', '').replace(',', '.');
      }
      if (!new RegExp('^\\d+' + (digits ? '(?:\\.\\d{' + digits + '})?' : '') + '$').test(raw))
        continue;
      const [whole, fraction = ''] = raw.split('.'),
        minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt(fraction || '0');
      if (minor <= 9000000000000n)
        facts.push({
          kind: 'money',
          value: { currency, minorUnits: Number(minor) },
          state: 'extracted',
          source,
        });
    }
  }
  return facts.slice(0, 30);
}
