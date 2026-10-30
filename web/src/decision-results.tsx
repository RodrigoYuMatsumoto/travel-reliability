import React from 'react';
import type { ToolId } from '../../schema/src/planning';
import { formatMinor } from './format-money';
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const array = (value: unknown): Row[] => (Array.isArray(value) ? value.map(object) : []);
const value = (input: unknown) =>
  typeof input === 'string' || typeof input === 'number' ? String(input) : '—';
export function DecisionResults({
  tool,
  result,
  locale,
}: {
  tool: ToolId;
  result: unknown;
  locale: 'pt-BR' | 'en';
}) {
  const pt = locale === 'pt-BR',
    data = object(result),
    unknown = pt ? 'Indeterminado' : 'Undetermined';
  const label = (status: unknown) =>
    ({
      conditional: pt ? 'Condicional' : 'Conditional',
      ineligible: pt ? 'Incompatível' : 'Ineligible',
      documented: pt ? 'Documentado' : 'Documented',
      within_declared_ceilings: pt ? 'Dentro dos tetos declarados' : 'Within declared ceilings',
    })[String(status)] ?? value(status);
  const money = (amount: unknown, currency: unknown) =>
    typeof amount === 'number' && typeof currency === 'string'
      ? formatMinor(amount, currency, locale)
      : unknown;
  const totals = (input: unknown) => {
    const entries = Object.entries(object(input));
    return entries.length
      ? entries.map(([currency, total]) => money(total, currency)).join(' · ')
      : unknown;
  };
  const interval = (input: unknown, currency: unknown) => {
    const item = object(input);
    return item.lowMinor === item.highMinor
      ? money(item.lowMinor, currency)
      : `${money(item.lowMinor, currency)} — ${money(item.highMinor, currency)}`;
  };
  const table = (columns: string[], rows: React.ReactNode[][], caption: string) => (
    <div className="table-scroll">
      <table className="decision-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (tool === 'group-split')
    return (
      <div>
        {array(data.scenarios).map((s) => (
          <article key={value(s.id)} className="decision-card">
            <h3>
              {value(s.destination)} · {label(s.status)}
            </h3>
            <p>
              {pt ? 'Escopo' : 'Scope'}: {value(s.scope)} · {value(s.nights)}{' '}
              {pt ? 'noites' : 'nights'}
            </p>
            <p>
              {pt ? 'Subtotal conhecido' : 'Known subtotal'}:{' '}
              <strong>{interval(s.groupKnownCost, data.currency)}</strong> ·{' '}
              {pt ? 'Total final' : 'Final total'}:{' '}
              <strong>
                {s.groupFinalCost ? interval(s.groupFinalCost, data.currency) : unknown}
              </strong>
            </p>
            {table(
              [
                pt ? 'Núcleo' : 'Household',
                pt ? 'Teto' : 'Ceiling',
                pt ? 'Gasto final' : 'Final expense',
                pt ? 'Déficit' : 'Deficit',
                pt ? 'Pico de caixa informado' : 'Supplied peak cash',
              ],
              array(s.households).map((h) => [
                value(h.id),
                money(h.ceilingMinor, data.currency),
                h.finalCost ? interval(h.finalCost, data.currency) : unknown,
                h.deficit ? interval(h.deficit, data.currency) : unknown,
                money(h.peakCashMinor, data.currency),
              ]),
              pt ? 'Rateio por núcleo' : 'Household allocation',
            )}
            <p className="note">
              {pt
                ? 'Caução e bloqueio de cartão ficam separados do gasto. O pico considera somente o calendário informado; não comprova que todos os pagamentos foram incluídos.'
                : 'Deposits and card holds remain separate from expense. The peak uses only supplied dated flows; it does not certify payment-schedule completeness.'}
            </p>
          </article>
        ))}
      </div>
    );
  if (tool === 'negotiation')
    return (
      <div>
        {Array.isArray(data.drafts) &&
          data.drafts.map((draft, index) => (
            <article className="decision-card" key={index}>
              <h3>
                {pt ? 'Rascunho' : 'Draft'} {index + 1}
              </h3>
              <p>{value(draft)}</p>
            </article>
          ))}
        <p className="note">
          {pt
            ? 'Revise os fatos antes de enviar manualmente. Nenhuma mensagem foi enviada.'
            : 'Review facts before manual sending. No message was sent.'}
        </p>
      </div>
    );
  if (tool === 'hidden-city')
    return (
      <div>
        <p>
          {pt ? 'Diferença nominal documentável' : 'Documentable nominal difference'}:{' '}
          <strong>{money(data.nominalDifferenceMinor, data.currency)}</strong>
        </p>
        {table(
          [
            pt ? 'Tema' : 'Topic',
            pt ? 'Condição documentada' : 'Documented condition',
            pt ? 'Verificação' : 'Verification',
          ],
          array(data.risks).map((r) => [
            value(r.topic),
            typeof r.condition === 'string' ? r.condition : unknown,
            label(r.status),
          ]),
          pt
            ? 'Matriz de riscos contratuais e operacionais'
            : 'Contractual and operational risk matrix',
        )}
        <p className="note">
          {pt
            ? 'A diferença nominal não garante economia líquida. Condições e jurisdição exigem análise própria; não há orientação para ocultar intenção.'
            : 'Nominal difference does not guarantee net savings. Conditions and jurisdiction need separate review; no concealment guidance is provided.'}
        </p>
      </div>
    );
  if (tool === 'fare-scenarios')
    return table(
      [
        pt ? 'Tarifa' : 'Fare',
        pt ? 'Normal' : 'Normal',
        pt ? 'Alteração adicional' : 'Additional change cost',
        pt ? 'Reembolso em dinheiro' : 'Cash refund',
        pt ? 'Crédito' : 'Credit',
        pt ? 'Restrições do crédito' : 'Credit restrictions',
      ],
      array(result).map((r) => [
        value(r.id),
        money(r.normalMinor, r.currency),
        money(r.changeAdditionalMinor, r.currency),
        money(r.cashRefundMinor, r.currency),
        money(r.creditMinor, r.currency),
        typeof r.creditConditions === 'string' ? r.creditConditions : unknown,
      ]),
      pt ? 'Cenários separados por tarifa' : 'Separate fare scenarios',
    );
  if (tool === 'promotions')
    return table(
      [
        pt ? 'Benefício' : 'Benefit',
        pt ? 'Elegibilidade' : 'Eligibility',
        pt ? 'Estado' : 'Status',
        pt ? 'Economia demonstrável' : 'Demonstrable savings',
      ],
      array(result).map((r) => [
        value(r.id),
        value(r.eligibility),
        label(r.status),
        money(object(r.difference).savingsMinor, object(r.difference).currency),
      ]),
      pt ? 'Condições promocionais documentadas' : 'Documented promotion conditions',
    );
  return table(
    [
      pt ? 'Oferta' : 'Offer',
      pt ? 'Operador / vendedor' : 'Operator / seller',
      pt ? 'Estado' : 'Status',
      pt ? 'Subtotal conhecido' : 'Known subtotal',
      pt ? 'Total final' : 'Final total',
      pt ? 'Economia demonstrável' : 'Demonstrable savings',
      pt ? 'Pendências' : 'Pending facts',
    ],
    array(data.rows).map((r) => {
      const cost = object(r.cost),
        difference = object(r.difference);
      const pending = [
        ...(Array.isArray(r.failures) ? r.failures : []),
        ...(Array.isArray(r.pending) ? r.pending : []),
      ];
      return [
        value(r.id),
        `${value(r.operator)} / ${value(r.seller)}`,
        label(r.status),
        totals(cost.knownTotals),
        cost.complete ? totals(cost.finalTotals) : unknown,
        money(difference.savingsMinor, difference.currency),
        pending.length ? pending.map(value).join(' · ') : '—',
      ];
    }),
    pt ? 'Comparação documental das ofertas' : 'Documentary offer comparison',
  );
}
