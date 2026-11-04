import React, { useRef, useState } from 'react';
import { planningExamples, toolLabels } from './planning-examples';
import type { ToolId } from '../../schema/src/planning';
import { DecisionResults } from './decision-results';
import { PackageDiscovery, type PackageSearchInput } from './package-discovery';
import { createPackageComparisonDraft } from './package-comparison-draft';
export function PlanningWorkbench({
  locale,
  execute,
  discover,
}: {
  locale: 'pt-BR' | 'en';
  execute: (tool: ToolId, value: unknown) => Promise<unknown>;
  discover: (input: PackageSearchInput) => Promise<unknown>;
}) {
  const pt = locale === 'pt-BR';
  const [tool, setTool] = useState<ToolId>('total-cost'),
    [text, setText] = useState(JSON.stringify(planningExamples['total-cost'], null, 2)),
    [result, setResult] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [stalePreparedDraft, setStalePreparedDraft] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  const preparedFromDiscovery = useRef(false);
  const invalidateResult = () => {
    generation.current++;
    setResult('');
    setError('');
  };
  const select = (id: ToolId) => {
    if (running.current) return;
    invalidateResult();
    preparedFromDiscovery.current = false;
    setStalePreparedDraft(false);
    setTool(id);
    setText(JSON.stringify(planningExamples[id], null, 2));
    setResult('');
    setError('');
  };
  return (
    <>
      <PackageDiscovery
        locale={locale}
        discover={discover}
        disabled={busy}
        onCriteriaChange={() => {
          invalidateResult();
          if (preparedFromDiscovery.current) setStalePreparedDraft(true);
        }}
        prepare={(input, source, windowIndex, timeZone) => {
          if (running.current) return;
          try {
            const draft = createPackageComparisonDraft(input, source, windowIndex, timeZone);
            invalidateResult();
            preparedFromDiscovery.current = true;
            setStalePreparedDraft(false);
            setTool('ground-transport');
            setText(JSON.stringify(draft, null, 2));
            setResult('');
            setError('');
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'DRAFT_REJECTED');
          }
        }}
      />
      <section className="panel">
        <h2>
          {Object.keys(toolLabels).length}{' '}
          {pt ? 'ferramentas, cálculos reproduzíveis' : 'tools, reproducible calculations'}
        </h2>
        <p>
          {pt
            ? 'Modo documental: use ofertas e regras que você obteve. Exemplos são fictícios; nenhuma busca, cotação atual, compra ou envio é simulado. Valores monetários usam unidades mínimas da moeda (centavos em BRL).'
            : 'Documentary mode: supply offers and terms you obtained. Examples are fictional; no search, current quote, purchase or sending is simulated. Money uses the smallest currency unit (cents for BRL).'}
        </p>
        <label className="field">
          <span>{pt ? 'Ferramenta' : 'Tool'}</span>
          <select value={tool} disabled={busy} onChange={(e) => select(e.target.value as ToolId)}>
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
        {stalePreparedDraft && (
          <p role="status">
            {pt
              ? 'Os critérios da pesquisa mudaram. Os dados anteriores foram preservados; prepare outra comparação para analisar as novas condições.'
              : 'Search criteria changed. Previous inputs have been preserved; prepare another comparison to analyze the new conditions.'}
          </p>
        )}
        <label className="field">
          <span>{pt ? 'Dados estruturados' : 'Structured inputs'}</span>
          <textarea
            className="code-editor"
            value={text}
            onChange={(e) => {
              invalidateResult();
              setText(e.target.value);
            }}
            spellCheck={false}
            maxLength={500000}
            disabled={busy}
          />
        </label>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || stalePreparedDraft}
            onClick={async () => {
              if (running.current || stalePreparedDraft) return;
              running.current = true;
              const requestGeneration = ++generation.current;
              setBusy(true);
              setError('');
              try {
                const response = await execute(tool, JSON.parse(text));
                if (requestGeneration === generation.current)
                  setResult(JSON.stringify(response, null, 2));
              } catch (err) {
                if (requestGeneration === generation.current)
                  setError(err instanceof Error ? err.message : 'PLANNING_FAILED');
              } finally {
                running.current = false;
                setBusy(false);
              }
            }}
          >
            {busy
              ? pt
                ? 'Calculando…'
                : 'Calculating…'
              : pt
                ? 'Analisar dados'
                : 'Analyze inputs'}
          </button>
          <button className="secondary" disabled={busy} onClick={() => select(tool)}>
            {pt ? 'Restaurar exemplo fictício' : 'Reset fictional example'}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            <h3>{pt ? 'Resultado e pendências' : 'Results and pending facts'}</h3>
            <DecisionResults
              tool={tool}
              result={(JSON.parse(result) as { result: unknown }).result}
              locale={locale}
            />
            <details>
              <summary>
                {pt ? 'Dados completos e fórmulas (JSON)' : 'Full data and formulas (JSON)'}
              </summary>
              <pre className="json-preview" tabIndex={0}>
                {result}
              </pre>
            </details>
          </>
        )}
      </section>
    </>
  );
}
