import React from 'react';
import type { ToolId } from '../../schema/src/planning';
import { formatMinor } from './format-money';
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const array = (value: unknown): Row[] => (Array.isArray(value) ? value.map(object) : []);
const value = (input: unknown) =>
  typeof input === 'string' || typeof input === 'number' ? String(input) : '—';

// Stable engine codes are for the advanced JSON. The main result describes the
// missing fact without exposing arbitrary source, quote or line-item identifiers.
const gapLabels: Record<string, readonly [string, string]> = {
  COST_UNKNOWN: [
    'O valor de um dos itens ainda precisa ser cotado.',
    'An item still needs a price quote.',
  ],
  COST_PROVENANCE_UNCONFIRMED: [
    'Confirme a fonte e a validade de um dos preços.',
    'Confirm the source and validity of a price.',
  ],
  OFFER_YEAR_UNCONFIRMED: [
    'Confirme o ano anunciado para a viagem.',
    'Confirm the advertised travel year.',
  ],
  YEAR_NOT_STATED: [
    'O anúncio não informa o ano da viagem.',
    'The advertisement does not state the travel year.',
  ],
  PARTY_COMPOSITION_UNKNOWN: [
    'Informe quantos adultos e crianças viajarão.',
    'Supply the number of adults and children travelling.',
  ],
  ROOM_COUNT_UNKNOWN: [
    'Informe quantos quartos serão necessários.',
    'Supply the number of rooms needed.',
  ],
  ROOM_TYPE_UNKNOWN: [
    'Confirme se o quarto é privativo ou compartilhado.',
    'Confirm whether the room is private or shared.',
  ],
  ROOM_TYPE_MISMATCH: [
    'O tipo de quarto não atende ao pedido.',
    'The room type does not meet the request.',
  ],
  ROOM_COUNT_MISMATCH: [
    'A quantidade de quartos não atende ao grupo.',
    'The room count does not match the group.',
  ],
  OCCUPANCY_UNCONFIRMED: [
    'Confirme a ocupação e a capacidade dos quartos.',
    'Confirm room occupancy and capacity.',
  ],
  INSUFFICIENT_ROOM_CAPACITY: [
    'A capacidade dos quartos é insuficiente para o grupo.',
    'The rooms cannot accommodate the whole group.',
  ],
  AVAILABILITY_UNCONFIRMED: [
    'Confirme a disponibilidade com o fornecedor.',
    'Confirm availability with the supplier.',
  ],
  NOT_AVAILABLE: [
    'O fornecedor informou indisponibilidade.',
    'The supplier reported no availability.',
  ],
  REQUIRED_SERVICES_UNCONFIRMED: [
    'Confirme todos os serviços obrigatórios.',
    'Confirm all required services.',
  ],
  SERVICE_SCOPE_UNCONFIRMED: [
    'Confirme quais serviços estão incluídos.',
    'Confirm which services are included.',
  ],
  CANCELLATION_POLICY_UNCONFIRMED: [
    'Obtenha as condições de cancelamento.',
    'Obtain the cancellation terms.',
  ],
  ACCESSIBILITY_UNCONFIRMED: [
    'Confirme as condições de acessibilidade necessárias.',
    'Confirm the required accessibility conditions.',
  ],
  DESTINATION_TIME_ZONE_UNCONFIRMED: [
    'Confirme o fuso horário do destino.',
    'Confirm the destination time zone.',
  ],
  DESTINATION_TIME_ZONE_ASSUMED_FROM_WINDOW: [
    'Sem fuso do destino, as datas do hotel usam o fuso da saída. Informe-o se forem diferentes.',
    'Without a destination zone, hotel dates use the departure zone. Supply it if they differ.',
  ],
  ARRIVAL_BREAKFAST_OUTSIDE_HOTEL_RATE: [
    'O café do dia da chegada não está na diária do hotel.',
    'Breakfast on the arrival day is not part of the hotel rate.',
  ],
  TRANSIT_NIGHTS_ARE_NOT_LODGING_NIGHTS: [
    'Noites viajando não contam como noites de hotel.',
    'Nights in transit do not count as hotel nights.',
  ],
  JOURNEY_TIME_INCOMPLETE: [
    'Confirme os horários de todos os trechos.',
    'Confirm the times of every journey leg.',
  ],
  RETURN_TO_ORIGIN_UNKNOWN: [
    'Confirme quando a viagem chega de volta à cidade de saída.',
    'Confirm when the journey arrives back at the origin city.',
  ],
  RETURN_ARRIVAL_OUTSIDE_WINDOW: [
    'A chegada de volta ocorre fora do período solicitado.',
    'The return arrival falls outside the requested period.',
  ],
  DEPARTURE_OUTSIDE_WINDOW: [
    'A saída ocorre fora do período solicitado.',
    'Departure falls outside the requested period.',
  ],
  DEPARTURE_IN_PAST: [
    'A saída informada já passou na data da avaliação.',
    'Departure is before the evaluation date.',
  ],
  JOURNEY_CHRONOLOGY_REJECTED: [
    'Os horários dos trechos estão fora de ordem.',
    'Journey times are out of chronological order.',
  ],
  ORIGIN_MISMATCH: [
    'A cidade de saída é diferente da solicitada.',
    'The departure city differs from the request.',
  ],
  DESTINATION_MISMATCH: [
    'O destino é diferente do solicitado.',
    'The destination differs from the request.',
  ],
  LODGING_DATES_UNKNOWN: [
    'Confirme as datas de entrada e saída da hospedagem.',
    'Confirm lodging check-in and check-out dates.',
  ],
  LODGING_NIGHT_COUNT_CONFLICT: [
    'As datas e a quantidade de noites de hospedagem divergem.',
    'Lodging dates and the stated number of nights disagree.',
  ],
  LODGING_INTERVAL_REJECTED: [
    'O período informado de hospedagem é inválido.',
    'The supplied lodging interval is invalid.',
  ],
  INSUFFICIENT_LODGING_NIGHTS: [
    'A hospedagem tem menos noites que o necessário.',
    'Lodging includes fewer nights than required.',
  ],
  LODGING_BEFORE_ARRIVAL: [
    'A hospedagem começa antes da chegada informada.',
    'Lodging starts before the supplied arrival.',
  ],
  LODGING_AFTER_RETURN_DEPARTURE: [
    'A hospedagem termina depois da saída de volta.',
    'Lodging ends after the return departure.',
  ],
  OVERNIGHT_BEFORE_LODGING_UNCONFIRMED: [
    'Confirme onde ficar entre a chegada e a entrada na hospedagem.',
    'Confirm accommodation between arrival and lodging check-in.',
  ],
  OVERNIGHT_AFTER_LODGING_UNCONFIRMED: [
    'Confirme onde ficar entre a saída da hospedagem e o retorno.',
    'Confirm accommodation between lodging check-out and return departure.',
  ],
  BREAKFAST_UNCONFIRMED: [
    'Confirme quais cafés da manhã estão incluídos.',
    'Confirm which breakfasts are included.',
  ],
  BREAKFAST_INCLUSION_CONFLICT: [
    'As informações sobre a inclusão do café da manhã divergem.',
    'Breakfast inclusion information conflicts.',
  ],
  EXTERNAL_BREAKFAST_COUNT_UNKNOWN: [
    'Informe quantos cafés da manhã serão feitos fora da hospedagem.',
    'Supply the number of breakfasts outside the lodging.',
  ],
  EXTERNAL_BREAKFAST_COST_SCOPE_UNKNOWN: [
    'Confirme o custo e quem está coberto pelo café da manhã avulso.',
    'Confirm the separate breakfast cost and who it covers.',
  ],
  EXTERNAL_BREAKFAST_PRICE_UNIT_UNCONFIRMED: [
    'Confirme se o preço do café avulso é por pessoa e por refeição.',
    'Confirm whether the separate breakfast price is per person and meal.',
  ],
  BREAKFAST_COUNT_SCOPE_CONFLICT: [
    'As quantidades de cafés no hotel e avulsos divergem.',
    'Hotel and separate breakfast quantities conflict.',
  ],
  INSUFFICIENT_INCLUDED_BREAKFASTS: [
    'O pacote inclui menos cafés da manhã que o necessário.',
    'The package includes fewer breakfasts than required.',
  ],
  INSUFFICIENT_PROVIDED_BREAKFASTS: [
    'Os cafés da manhã incluídos ou previstos são insuficientes.',
    'Included or budgeted breakfasts are insufficient.',
  ],
  TRANSPORT_MODE_COST_CONFLICT: [
    'Um custo informado corresponde a outro meio de transporte.',
    'A supplied cost belongs to another transport mode.',
  ],
  TRANSPORT_MODE_COVERAGE_CONFLICT: [
    'A cobertura informada corresponde a outro meio de transporte.',
    'The supplied coverage belongs to another transport mode.',
  ],
  PRICE_UNIT_CATEGORY_MISMATCH: [
    'A unidade do preço não corresponde ao serviço.',
    'The price unit does not match the service.',
  ],
  PRICE_UNIT_SCOPE_UNCONFIRMED: [
    'Confirme a unidade e a quantidade cobradas.',
    'Confirm the billed unit and quantity.',
  ],
  PRICE_UNIT_QUANTITY_MISMATCH: [
    'A quantidade cobrada não corresponde ao grupo ou à estadia.',
    'The billed quantity does not match the group or stay.',
  ],
  PARTY_PRICE_COVERAGE_INCOMPLETE: [
    'A tarifa ainda não cobre de forma comprovada todas as pessoas do grupo.',
    'The price does not yet demonstrably cover everyone in the group.',
  ],
  INCLUDED_COST_DUPLICATED: [
    'Um serviço incluído está sendo cobrado novamente.',
    'An included service is being charged again.',
  ],
  REQUIRED_COST_SCOPE_UNKNOWN: [
    'Confirme se o serviço está incluído ou será pago à parte.',
    'Confirm whether the service is included or paid separately.',
  ],
  PACKAGE_PRICE_UNKNOWN: [
    'O preço do pacote ainda precisa ser cotado.',
    'The package still needs a price quote.',
  ],
  PACKAGE_PRICE_BASIS_UNKNOWN: [
    'Confirme se o preço do pacote é por pessoa, quarto ou grupo.',
    'Confirm whether the package price is per person, room or group.',
  ],
  PACKAGE_FEE_BASIS_UNKNOWN: [
    'Confirme como a taxa obrigatória é cobrada.',
    'Confirm how the mandatory fee is charged.',
  ],
  PACKAGE_FEE_PAYMENT_UNKNOWN: [
    'Confirme se a taxa obrigatória já está incluída no pacote.',
    'Confirm whether the mandatory fee is already included in the package.',
  ],
  CHILD_PRICE_UNKNOWN: [
    'Obtenha uma tarifa confirmada para as crianças.',
    'Obtain confirmed child prices.',
  ],
  CHILD_PRICE_NOT_MODELED: [
    'A tarifa infantil informada ainda não pode ser calculada neste cenário.',
    'The supplied child fare cannot yet be calculated in this scenario.',
  ],
  PAYING_PERSONS_UNKNOWN: [
    'Confirme quantas pessoas pagam cada tarifa.',
    'Confirm how many people pay each fare.',
  ],
  PRICE_IS_FROM: [
    'O anúncio mostra um preço inicial, sem confirmar o total do grupo.',
    'The advertisement shows a starting price, not a confirmed group total.',
  ],
  PRICE_QUALIFIER_UNKNOWN: [
    'Confirme se o preço anunciado é exato ou apenas inicial.',
    'Confirm whether the advertised price is exact or a starting price.',
  ],
  TRANSPORT_PRICE_UNKNOWN: ['Cote o preço do transporte.', 'Obtain a transport quote.'],
  TRANSPORT_QUOTE_MISSING: [
    'Falta uma cotação de transporte para este cenário.',
    'A transport quote is missing for this scenario.',
  ],
  TRANSPORT_INCOMPLETE: [
    'Falta a cotação de um dos sentidos da viagem.',
    'A quote for one direction is missing.',
  ],
  LODGING_PRICE_UNKNOWN: ['Cote o preço da hospedagem.', 'Obtain a lodging quote.'],
  LODGING_QUOTE_MISSING: ['Falta uma cotação de hospedagem.', 'A lodging quote is missing.'],
  NO_COMPATIBLE_LODGING: [
    'Não há hospedagem cotada com quartos e noites compatíveis.',
    'No quoted lodging matches the required rooms and nights.',
  ],
  BREAKFAST_PRICE_UNKNOWN: [
    'Cote o preço do café da manhã avulso.',
    'Obtain a separate breakfast quote.',
  ],
  BREAKFAST_QUOTE_MISSING: [
    'Falta uma cotação para incluir café da manhã.',
    'A quote to provide breakfast is missing.',
  ],
  NO_COMPATIBLE_BREAKFAST: [
    'A cotação de café não atende à quantidade necessária.',
    'The breakfast quote does not cover the required quantity.',
  ],
  EXTRA_PRICE_UNKNOWN: [
    'Cote o preço de um dos serviços adicionais necessários.',
    'Obtain a quote for a required additional service.',
  ],
  PACKAGE_NIGHTS_UNKNOWN: [
    'Confirme quantas noites de hospedagem o pacote inclui.',
    'Confirm the number of lodging nights included in the package.',
  ],
  LODGING_NIGHTS_NOT_STATED: [
    'O anúncio não confirma separadamente as noites na hospedagem.',
    'The advertisement does not separately confirm lodging nights.',
  ],
  BREAKFAST_COUNT_UNKNOWN: [
    'Confirme quantos cafés da manhã estão incluídos.',
    'Confirm the number of included breakfasts.',
  ],
  NO_EQUIVALENT_SCENARIO: [
    'Ainda não há uma compra separada com os mesmos serviços do pacote.',
    'There is no unbundled scenario with the same package services yet.',
  ],
  UNBUNDLED_TOTAL_ZERO: [
    'O total avulso informado é zero e não sustenta uma comparação final.',
    'The supplied unbundled total is zero and cannot support a final comparison.',
  ],
  SOURCE_AFTER_EVALUATION: [
    'Uma fonte tem data posterior à avaliação; confira as datas.',
    'A source is dated after the evaluation; check the dates.',
  ],
  PACKAGE_SOURCE_AFTER_EVALUATION: [
    'A página do pacote tem data posterior à avaliação.',
    'The package page is dated after the evaluation.',
  ],
  SOURCE_STALE: ['Atualize uma das cotações antes de decidir.', 'Update a quote before deciding.'],
  PACKAGE_SOURCE_STALE: [
    'Atualize a consulta à página do pacote.',
    'Update the package page observation.',
  ],
  SOURCE_NOT_OBSERVED: [
    'Uma das fontes ainda não foi observada diretamente.',
    'A source has not been directly observed.',
  ],
  QUOTE_WITHOUT_SOURCE: ['Associe uma fonte à cotação.', 'Attach a source to the quote.'],
  CURRENCY_MISMATCH: [
    'As moedas informadas divergem; não há conversão automática.',
    'The supplied currencies differ; there is no automatic conversion.',
  ],
  PACKAGE_CURRENCY_MISMATCH: [
    'A moeda do pacote difere da moeda da comparação.',
    'The package currency differs from the comparison currency.',
  ],
  MODE_UNKNOWN: ['Confirme o meio de transporte do pacote.', 'Confirm the package transport mode.'],
  MODE_DIFFERS: [
    'O meio de transporte é diferente do pacote.',
    'The transport mode differs from the package.',
  ],
  BOARD_DIFFERS: [
    'A inclusão do café da manhã difere do pacote.',
    'Breakfast inclusion differs from the package.',
  ],
  BREAKFAST_PARTIAL: [
    'A inclusão de café da manhã é parcial.',
    'Breakfast is only partially included.',
  ],
  BREAKFAST_UNKNOWN: [
    'A inclusão de café da manhã não foi confirmada.',
    'Breakfast inclusion is unconfirmed.',
  ],
  BREAKFAST_COUNT_DIFFERS: [
    'A quantidade de cafés da manhã difere do pacote.',
    'The number of breakfasts differs from the package.',
  ],
  NIGHTS_UNKNOWN: [
    'A quantidade de noites do pacote não foi confirmada.',
    'The package night count is unconfirmed.',
  ],
  NIGHTS_DIFFER: [
    'A quantidade de noites difere do pacote.',
    'The number of nights differs from the package.',
  ],
  NIGHTS_UNCONFIRMED: [
    'Não há cotação confirmando as mesmas noites do pacote.',
    'No quote confirms the same lodging nights as the package.',
  ],
};
const categoryLabels: Record<string, readonly [string, string]> = {
  package: ['pacote completo', 'complete package'],
  outbound_bus: ['ônibus de ida', 'outbound bus'],
  return_bus: ['ônibus de volta', 'return bus'],
  outbound_flight: ['voo de ida', 'outbound flight'],
  return_flight: ['voo de volta', 'return flight'],
  airport_transfers: ['transporte entre aeroporto e hospedagem', 'airport and lodging transfers'],
  flight_baggage: ['bagagem no avião', 'flight baggage'],
  flight_seats: ['assentos no avião', 'flight seats'],
  lodging: ['hospedagem', 'lodging'],
  breakfast: ['café da manhã', 'breakfast'],
  arrival_breakfast: ['café da manhã na chegada', 'arrival breakfast'],
  local_transfers: ['deslocamentos locais', 'local transfers'],
  taxes: ['taxas', 'fees'],
  mandatory_activities: ['passeios obrigatórios', 'required activities'],
  other_meals: ['demais refeições', 'other meals'],
};
function readableGap(reason: unknown, pt: boolean): string {
  const [code = '', suffix = ''] = typeof reason === 'string' ? reason.split(':') : [];
  const text =
    gapLabels[code]?.[pt ? 0 : 1] ??
    (pt
      ? 'Há uma informação que exige revisão; consulte os dados completos.'
      : 'An item needs review; consult the full data.');
  const category = [
    'REQUIRED_COST_SCOPE_UNKNOWN',
    'PARTY_PRICE_COVERAGE_INCOMPLETE',
    'INCLUDED_COST_DUPLICATED',
    'TRANSPORT_MODE_COST_CONFLICT',
    'TRANSPORT_MODE_COVERAGE_CONFLICT',
  ].includes(code)
    ? categoryLabels[suffix]?.[pt ? 0 : 1]
    : undefined;
  return category ? `${text} ${pt ? 'Serviço' : 'Service'}: ${category}.` : text;
}
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
      rejected: pt ? 'Incompatível com o pedido' : 'Does not meet the request',
      documentary_comparable: pt
        ? 'Dados completos para comparação'
        : 'Complete inputs for comparison',
      within_declared_ceilings: pt ? 'Dentro dos tetos declarados' : 'Within declared ceilings',
    })[String(status)] ?? value(status);
  const money = (amount: unknown, currency: unknown) =>
    typeof amount === 'number' && typeof currency === 'string'
      ? formatMinor(amount, currency, locale)
      : unknown;
  const quoteMoney = (amount: unknown, currency: unknown) => {
    const formatted =
      typeof amount === 'number' && typeof currency === 'string'
        ? formatMinor(amount, currency, locale)
        : '—';
    return formatted === '—' ? (pt ? 'A cotar' : 'To quote') : formatted;
  };
  const pendingFacts = (reasons: unknown[], notes = false) => {
    const messages = [...new Set(reasons.map((reason) => readableGap(reason, pt)))];
    return messages.length ? (
      <details>
        <summary>
          {notes ? (pt ? 'Ver avisos' : 'Review notes') : pt ? 'Ver pendências' : 'Review gaps'} (
          {messages.length})
        </summary>
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </details>
    ) : null;
  };
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
  if (tool === 'package-arbitrage') {
    const nominalDifference = (scenario: Row) => {
      if (typeof scenario.deltaMinor !== 'number') return pt ? 'A cotar' : 'To quote';
      const classification = {
        agency_premium: pt ? 'Ágio da agência' : 'Agency premium',
        agency_discount: pt ? 'Deságio da agência' : 'Agency discount',
        parity: pt ? 'Mesmo total' : 'Equal totals',
      }[String(scenario.classification)];
      return classification
        ? `${classification}: ${quoteMoney(scenario.deltaMinor, data.currency)}`
        : pt
          ? 'A confirmar'
          : 'To confirm';
    };
    return (
      <div>
        <p>
          {data.final === true
            ? pt
              ? 'Cálculo completo com os valores informados. A comparação de economia exige serviços equivalentes.'
              : 'Calculation complete for the supplied amounts. Savings comparisons require equivalent services.'
            : pt
              ? 'Comparação pendente: confirme as informações abaixo antes de concluir sobre economia.'
              : 'Comparison pending: confirm the information below before drawing a savings conclusion.'}
        </p>
        {table(
          [
            pt ? 'Transporte avulso' : 'Separate transport',
            pt ? 'Hospedagem avulsa' : 'Separate lodging',
            pt ? 'Pacote da agência' : 'Agency package',
            pt ? 'Compra separada' : 'Unbundled purchase',
            pt ? 'Diferença nominal (pacote − avulso)' : 'Nominal difference (package − unbundled)',
            pt ? 'Equivalência e conclusão' : 'Equivalence and conclusion',
          ],
          array(data.scenarios).map((scenario) => {
            const equivalent = scenario.equivalent === true;
            const final = equivalent && data.final === true && scenario.status === 'computed';
            const reasons = [
              ...(Array.isArray(data.pending) ? data.pending : []),
              ...(Array.isArray(scenario.reasons) ? scenario.reasons : []),
              ...(Array.isArray(scenario.equivalenceReasons) ? scenario.equivalenceReasons : []),
            ];
            return [
              scenario.mode === 'bus'
                ? pt
                  ? 'Ônibus'
                  : 'Bus'
                : scenario.mode === 'air'
                  ? pt
                    ? 'Avião'
                    : 'Flight'
                  : pt
                    ? 'A confirmar'
                    : 'To confirm',
              scenario.board === 'with_breakfast'
                ? pt
                  ? 'Com café da manhã'
                  : 'With breakfast'
                : scenario.board === 'room_only'
                  ? pt
                    ? 'Sem café da manhã'
                    : 'Without breakfast'
                  : pt
                    ? 'A confirmar'
                    : 'To confirm',
              quoteMoney(scenario.packageTotalMinor, data.currency),
              quoteMoney(scenario.unbundledTotalMinor, data.currency),
              nominalDifference(scenario),
              <>
                <p>
                  {equivalent
                    ? pt
                      ? 'Equivalente ao pacote'
                      : 'Equivalent to the package'
                    : pt
                      ? 'Alternativa com serviços diferentes'
                      : 'Alternative with different services'}
                </p>
                <p>
                  {final
                    ? pt
                      ? 'Comparação final dos valores informados'
                      : 'Final comparison of supplied amounts'
                    : equivalent
                      ? pt
                        ? 'Comparação pendente'
                        : 'Comparison pending'
                      : pt
                        ? 'Diferença nominal; não demonstra economia.'
                        : 'Nominal difference; does not demonstrate savings.'}
                </p>
                {pendingFacts(reasons)}
              </>,
            ];
          }),
          pt
            ? 'Pacote da agência e compra separada: cenários documentados'
            : 'Agency package and unbundled purchase: documented scenarios',
        )}
        <p className="note">
          {pt
            ? 'Ágio: o pacote tem total maior que o avulso. Deságio: tem total menor. Uma diferença entre serviços distintos não comprova economia. Os totais do grupo não garantem disponibilidade nem autenticam as fontes.'
            : 'Premium means the package total is higher; discount means it is lower. A difference between different services does not establish savings. Group totals do not guarantee availability or authenticate sources.'}
        </p>
      </div>
    );
  }
  if (tool === 'ground-transport')
    return table(
      [
        pt ? 'Alternativa / destino' : 'Alternative / destination',
        pt ? 'Transporte' : 'Transport',
        pt ? 'Café no hotel / externo por pessoa' : 'Hotel / external breakfasts per person',
        pt ? 'Subtotal conhecido' : 'Known subtotal',
        pt ? 'Total final' : 'Final total',
        pt ? 'Economia demonstrável' : 'Demonstrable savings',
        pt ? 'Estado e lacunas' : 'Status and gaps',
      ],
      array(data.rows).map((row) => {
        const priced = array(row.lineItems).some((line) => typeof line.totalMinor === 'number');
        const reasons = [
          ...(Array.isArray(row.rejected) ? row.rejected : []),
          ...(Array.isArray(row.pending) ? row.pending : []),
        ];
        return [
          `${value(row.provider)} · ${value(row.destination)}`,
          row.transportMode === 'flight'
            ? pt
              ? 'Avião'
              : 'Flight'
            : row.transportMode === 'bus'
              ? pt
                ? 'Ônibus'
                : 'Bus'
              : pt
                ? 'A confirmar'
                : 'To confirm',
          `${value(row.hotelBreakfasts)} / ${value(row.externalBreakfasts)}`,
          priced ? money(row.knownSubtotalMinor, row.currency) : pt ? 'A cotar' : 'To quote',
          quoteMoney(row.finalTotalMinor, row.currency),
          typeof object(row.difference).savingsMinor === 'number'
            ? money(object(row.difference).savingsMinor, row.currency)
            : (pt ? 'Não demonstrada' : 'Not demonstrated') +
              (object(row.difference).reason === 'TRANSPORT_MODE_DIFFERS'
                ? pt
                  ? ': transporte diferente do pacote'
                  : ': transport differs from the package'
                : ''),
          <>
            <span>{label(row.status)}</span>
            {pendingFacts(reasons)}
            {pendingFacts(Array.isArray(row.warnings) ? row.warnings : [], true)}
          </>,
        ];
      }),
      pt
        ? 'Pacote, ônibus ou avião e hospedagem: com e sem café'
        : 'Package, bus or flight and lodging: with and without breakfast',
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
