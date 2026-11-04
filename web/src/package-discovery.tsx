import React, { useRef, useState } from 'react';
import { requirePackageTimeZone } from './package-comparison-draft';

export interface PackageSearchWindow {
  id: string;
  startDate: string;
  endDate: string;
}
export interface PackageSearchInput {
  origin: string;
  destination: string | null;
  windows: PackageSearchWindow[];
  providerIds?: string[];
  cursor?: number;
  limit?: number;
}
export interface PackageReference {
  sourceId: string;
  providerId: string;
  providerName: string;
  label?: string;
  kind: string;
  browserUrl: string;
  fetchUrl: string | null;
  access: string;
  originMatch: string;
  dateStatus: string;
}
interface DiscoveryResult {
  items: PackageReference[];
  total: number;
  nextCursor: number | null;
}
const providers = [
  ['atrativa', 'Atrativa Tur'],
  ['niel', 'Niel Turismo'],
  ['viajantes-do-valle', 'Viajantes do Valle'],
  ['augustus', 'Augustus Turismo'],
] as const;
const safeLink = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
};

/** Discovery uses only the local reference catalog. External pages open on a user click. */
export function PackageDiscovery({
  locale,
  discover,
  prepare,
  disabled = false,
  onCriteriaChange,
}: {
  locale: 'pt-BR' | 'en';
  discover: (input: PackageSearchInput) => Promise<unknown>;
  prepare: (
    input: PackageSearchInput,
    source: PackageReference,
    windowIndex: number,
    timeZone: string,
  ) => void;
  disabled?: boolean;
  onCriteriaChange?: () => void;
}) {
  const pt = locale === 'pt-BR';
  const [origin, setOrigin] = useState('Petrolina, PE');
  const [destination, setDestination] = useState('');
  const [timeZone, setTimeZone] = useState('America/Recife');
  const [windows, setWindows] = useState<PackageSearchWindow[]>([
    { id: 'window-1', startDate: '', endDate: '' },
  ]);
  const [selected, setSelected] = useState<string[]>(providers.map(([id]) => id));
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [executed, setExecuted] = useState<{ input: PackageSearchInput; timeZone: string } | null>(
    null,
  );
  const [comparisonWindow, setComparisonWindow] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const running = useRef(false);
  const blocked = busy || disabled;
  const invalidate = () => {
    generation.current++;
    setResult(null);
    setExecuted(null);
    setComparisonWindow('');
    setError('');
    onCriteriaChange?.();
  };
  const changeWindow = (index: number, key: 'startDate' | 'endDate', value: string) => {
    invalidate();
    setWindows(windows.map((window, i) => (i === index ? { ...window, [key]: value } : window)));
  };
  const search = async (cursor = 0) => {
    if (disabled || running.current) return;
    running.current = true;
    const requestGeneration = ++generation.current;
    setBusy(true);
    setError('');
    try {
      if (!selected.length)
        throw new Error(pt ? 'Selecione pelo menos uma agência.' : 'Select at least one agency.');
      const selectedTimeZone = requirePackageTimeZone(
        cursor && executed ? executed.timeZone : timeZone,
      );
      const input: PackageSearchInput =
        cursor && executed
          ? { ...executed.input, cursor }
          : {
              origin: origin.trim(),
              destination: destination.trim() || null,
              windows: windows.map((window) => ({ ...window })),
              providerIds: [...selected],
              cursor,
              limit: 12,
            };
      if (
        !input.origin ||
        input.windows.some(
          (window) => !window.startDate || !window.endDate || window.startDate > window.endDate,
        )
      )
        throw new Error(
          pt
            ? 'Informe origem e intervalos de datas válidos.'
            : 'Supply an origin and valid date windows.',
        );
      const response = (await discover(input)) as DiscoveryResult;
      if (requestGeneration === generation.current) {
        setResult(response);
        setExecuted({ input, timeZone: selectedTimeZone });
      }
    } catch (failure) {
      if (requestGeneration === generation.current)
        setError(failure instanceof Error ? failure.message : 'DISCOVERY_FAILED');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="panel"
      aria-label={pt ? 'Encontrar excursões locais' : 'Find local excursions'}
    >
      <h2>{pt ? 'Encontrar excursões e pacotes locais' : 'Find local excursions and packages'}</h2>
      <p>
        {pt
          ? 'Escolha origem e datas, mesmo sem destino definido. O catálogo organiza as páginas das agências; abrir um link não confirma preço, ano, vaga ou regularidade. Instagram é apenas uma pista de pesquisa.'
          : 'Choose an origin and dates, even without a destination. The catalog organizes agency pages; opening a link does not verify prices, year, availability or supplier registration. Instagram is a research lead only.'}
      </p>
      <div className="field-grid">
        <label className="field">
          <span>{pt ? 'Cidade de saída' : 'Departure city'}</span>
          <input
            value={origin}
            maxLength={100}
            onChange={(event) => {
              invalidate();
              setOrigin(event.target.value);
            }}
            disabled={blocked}
          />
        </label>
        <label className="field">
          <span>{pt ? 'Destino (opcional)' : 'Destination (optional)'}</span>
          <input
            value={destination}
            maxLength={100}
            onChange={(event) => {
              invalidate();
              setDestination(event.target.value);
            }}
            disabled={blocked}
          />
        </label>
        <label className="field">
          <span>{pt ? 'Fuso IANA da origem' : 'Origin IANA time zone'}</span>
          <input
            value={timeZone}
            maxLength={100}
            onChange={(event) => {
              invalidate();
              setTimeZone(event.target.value);
            }}
            disabled={blocked}
          />
        </label>
      </div>
      <p>
        {pt
          ? 'O fuso regional sugerido está visível acima. Confirme o fuso da origem; mudar a cidade não altera o fuso automaticamente.'
          : 'The suggested regional time zone is visible above. Confirm the origin time zone; changing a city never changes it automatically.'}
      </p>
      {windows.map((window, index) => (
        <fieldset key={window.id} disabled={blocked}>
          <legend>
            {pt ? 'Período independente' : 'Independent window'} {index + 1}
          </legend>
          <div className="field-grid">
            <label className="field">
              <span>{pt ? 'Saída a partir de' : 'Departure from'}</span>
              <input
                type="date"
                value={window.startDate}
                onChange={(event) => changeWindow(index, 'startDate', event.target.value)}
              />
            </label>
            <label className="field">
              <span>{pt ? 'Chegada de volta até' : 'Return home by'}</span>
              <input
                type="date"
                value={window.endDate}
                min={window.startDate || undefined}
                onChange={(event) => changeWindow(index, 'endDate', event.target.value)}
              />
            </label>
          </div>
        </fieldset>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={blocked || windows.length >= 4}
          onClick={() => {
            invalidate();
            setWindows([
              ...windows,
              { id: 'window-' + (windows.length + 1), startDate: '', endDate: '' },
            ]);
          }}
        >
          {pt ? 'Adicionar outro período' : 'Add another window'}
        </button>
        {windows.length > 1 && (
          <button
            type="button"
            className="secondary"
            disabled={blocked}
            onClick={() => {
              invalidate();
              setWindows(windows.slice(0, -1));
            }}
          >
            {pt ? 'Remover último período' : 'Remove last window'}
          </button>
        )}
      </div>
      <fieldset disabled={blocked}>
        <legend>{pt ? 'Agências de referência' : 'Reference agencies'}</legend>
        {providers.map(([id, name]) => (
          <label className="checkbox-row" key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={(event) => {
                invalidate();
                setSelected(
                  event.target.checked
                    ? [...selected, id]
                    : selected.filter((value) => value !== id),
                );
              }}
            />
            {name}
          </label>
        ))}
      </fieldset>
      <button type="button" className="primary" disabled={blocked} onClick={() => void search()}>
        {busy
          ? pt
            ? 'Organizando fontes…'
            : 'Preparing sources…'
          : pt
            ? 'Encontrar páginas das agências'
            : 'Find agency pages'}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>
            {pt ? 'Referências encontradas no catálogo' : 'Catalog references found'}:{' '}
            {result.total}.{' '}
            {pt
              ? 'Datas e condições ainda precisam de confirmação na oferta.'
              : 'Offer dates and terms still need verification.'}
          </p>
          {executed && (
            <label className="field">
              <span>{pt ? 'Período para esta comparação' : 'Window for this comparison'}</span>
              <select
                value={comparisonWindow}
                disabled={blocked}
                onChange={(event) => {
                  setComparisonWindow(event.target.value === '' ? '' : Number(event.target.value));
                  onCriteriaChange?.();
                }}
              >
                <option value="">{pt ? 'Selecione um período' : 'Select a window'}</option>
                {executed.input.windows.map((window, index) => (
                  <option key={window.id} value={index}>
                    {index + 1} · {window.startDate} — {window.endDate} · {executed.timeZone}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="cards">
            {result.items.map((source) => (
              <article className="decision-card" key={source.sourceId}>
                <h3>
                  {source.providerName} ·{' '}
                  {source.label ??
                    (source.kind === 'package'
                      ? pt
                        ? 'Pacote'
                        : 'Package'
                      : pt
                        ? 'Programação'
                        : 'Schedule')}
                </h3>
                <p>
                  {source.access === 'rendered_snapshot'
                    ? pt
                      ? 'Confira a página completa no navegador: o catálogo está em uma aplicação dinâmica.'
                      : 'Review the full browser page: this catalog is a dynamic application.'
                    : source.kind === 'social_hint'
                      ? pt
                        ? 'Perfil social: não constitui oferta confirmada.'
                        : 'Social profile: not a confirmed offer.'
                      : pt
                        ? 'Página pública de referência; oferta não verificada.'
                        : 'Public reference page; unverified offer.'}
                </p>
                {source.originMatch !== 'operator_seed_hint' && (
                  <p>
                    {pt
                      ? 'O embarque nesta origem não está demonstrado.'
                      : 'Departure from this origin is not established.'}
                  </p>
                )}
                <div className="button-row">
                  {safeLink(source.browserUrl) && (
                    <a href={source.browserUrl} target="_blank" rel="noreferrer noopener">
                      {pt ? 'Abrir fonte' : 'Open source'}
                    </a>
                  )}
                  {source.kind === 'package' && executed && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={blocked || comparisonWindow === ''}
                      onClick={() => {
                        if (!disabled && !running.current && comparisonWindow !== '')
                          prepare(executed.input, source, comparisonWindow, executed.timeZone);
                      }}
                    >
                      {pt
                        ? 'Preparar comparação sem preços presumidos'
                        : 'Prepare comparison without assumed prices'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {result.nextCursor !== null && (
            <button
              type="button"
              className="secondary"
              disabled={blocked}
              onClick={() => void search(result.nextCursor!)}
            >
              {pt ? 'Próximas referências' : 'Next references'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
