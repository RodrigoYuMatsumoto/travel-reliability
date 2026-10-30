import React, { useState } from 'react';
import { planningExamples, toolLabels } from './planning-examples';
import type { ToolId } from '../../schema/src/planning';
export function PlanningWorkbench({
  locale,
  execute,
}: {
  locale: 'pt-BR' | 'en';
  execute: (tool: ToolId, value: unknown) => Promise<unknown>;
}) {
  const pt = locale === 'pt-BR';
  const [tool, setTool] = useState<ToolId>('total-cost'),
    [text, setText] = useState(JSON.stringify(planningExamples['total-cost'], null, 2)),
    [result, setResult] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const select = (id: ToolId) => {
    setTool(id);
    setText(JSON.stringify(planningExamples[id], null, 2));
    setResult('');
    setError('');
  };
  return (
    <section className="panel">
      <h2>
        {pt ? 'Nove ferramentas, cálculos reproduzíveis' : 'Nine tools, reproducible calculations'}
      </h2>
      <p>
        {pt
          ? 'Modo documental: use ofertas e regras que você obteve. Exemplos são fictícios; nenhuma busca, cotação atual, compra ou envio é simulado. Valores monetários usam unidades mínimas da moeda (centavos em BRL).'
          : 'Documentary mode: supply offers and terms you obtained. Examples are fictional; no search, current quote, purchase or sending is simulated. Money uses the smallest currency unit (cents for BRL).'}
      </p>
      <label className="field">
        <span>{pt ? 'Ferramenta' : 'Tool'}</span>
        <select value={tool} onChange={(e) => select(e.target.value as ToolId)}>
          {Object.entries(toolLabels).map(([id, labels]) => (
            <option value={id} key={id}>
              {labels[pt ? 0 : 1]}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>{pt ? 'Como preencher com segurança' : 'How to fill safely'}</summary>
        <p>
          {pt
            ? 'Preserve null para desconhecido. Identifique fontes e horário com fuso. Informe totais do grupo, unidades e quantidades; não use a tarifa individual mínima como disponibilidade do grupo. Use N01/P01 no rateio, sem nomes, documentos, contas ou cartões. O schema rejeita campos extras e não interpreta texto como comando.'
            : 'Keep unknown values null. Record sources and timestamps with offsets. Supply group totals, units and quantities; a minimum individual fare does not establish group availability. Use N01/P01 for allocation, without names, IDs, bank accounts or cards. The schema rejects extra fields and never interprets text as a command.'}
        </p>
        <a href="/schema/planning.json">JSON Schema</a>
      </details>
      <label className="field">
        <span>{pt ? 'Dados estruturados' : 'Structured inputs'}</span>
        <textarea
          className="code-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          maxLength={500000}
        />
      </label>
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              setResult(JSON.stringify(await execute(tool, JSON.parse(text)), null, 2));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'PLANNING_FAILED');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (pt ? 'Calculando…' : 'Calculating…') : pt ? 'Analisar dados' : 'Analyze inputs'}
        </button>
        <button className="secondary" onClick={() => select(tool)}>
          {pt ? 'Restaurar exemplo fictício' : 'Reset fictional example'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <h3>{pt ? 'Resultado e pendências' : 'Results and pending facts'}</h3>
          <pre className="json-preview" tabIndex={0}>
            {result}
          </pre>
        </>
      )}
    </section>
  );
}
