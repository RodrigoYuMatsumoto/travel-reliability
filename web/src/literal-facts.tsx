import type { LiteralFact } from '../../schema/src/domain';
import { formatMinor } from './format-money';

export function LiteralFacts({ facts, locale }: { facts: LiteralFact[]; locale: 'pt-BR' | 'en' }) {
  if (!facts.length) return null;
  const pt = locale === 'pt-BR';
  return (
    <details>
      <summary>
        {pt ? 'Fornecedor, datas e valores extraídos' : 'Extracted supplier, dates and amounts'}
      </summary>
      <p className="muted small">
        {pt
          ? 'Literais do documento, não confirmados. Revise antes de preencher o contrato. Datas sem fuso continuam sem fuso; o total não identifica seus componentes.'
          : 'Unconfirmed document literals. Review before entering contract values. Dates without a zone remain unzoned; a total does not identify its components.'}
      </p>
      {facts.map((fact, index) => (
        <div className="extracted-field" key={index}>
          <span className="mini-label">
            {fact.kind} · {pt ? 'extraído, não confirmado' : 'extracted, not confirmed'}
          </span>
          <p>
            {typeof fact.value === 'string'
              ? fact.value
              : 'iso' in fact.value
                ? `${fact.value.iso} (${fact.value.precision})`
                : formatMinor(fact.value.minorUnits, fact.value.currency, locale)}
          </p>
          <blockquote>{fact.source.quote}</blockquote>
        </div>
      ))}
    </details>
  );
}
