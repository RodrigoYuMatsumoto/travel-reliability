import React, { useState } from 'react';
interface Preview {
  enabled: boolean;
  model: string | null;
  destination: string | null;
  snippets: Array<{ text: string; page?: number; line: number }>;
}
export function EvidenceAssist({
  id,
  locale,
  request,
  refresh,
}: {
  id: string;
  locale: 'pt-BR' | 'en';
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  refresh: () => Promise<void>;
}) {
  const pt = locale === 'pt-BR',
    [preview, setPreview] = useState<Preview | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ASSIST_FAILED');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="text-link"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setPreview((await request(`/v1/documents/${id}/suggest-preview`)) as Preview);
            setConsent(false);
          })
        }
      >
        {pt ? 'Conferir extração opcional por IA' : 'Review optional AI extraction'}
      </button>
      {preview && (
        <div className="note">
          <p>
            {preview.enabled
              ? `${preview.destination} · ${preview.model}`
              : pt
                ? 'LLM desativado pelo operador. Nenhum envio será feito.'
                : 'LLM disabled by the operator. Nothing will be sent.'}
          </p>
          <p>
            {pt
              ? 'Somente os trechos abaixo serão enviados ao provedor configurado. Confira e remova identificadores no documento antes de prosseguir. O resultado exige revisão e pode conter texto hostil da fonte.'
              : 'Only the snippets below will be sent to the configured provider. Review and remove identifiers in the document before proceeding. Results need review and may contain hostile source text.'}
          </p>
          {preview.snippets.map((s, i) => (
            <blockquote key={i}>{s.text}</blockquote>
          ))}
          {preview.enabled && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{' '}
                {pt
                  ? 'Conferi os trechos e autorizo este envio.'
                  : 'I reviewed the snippets and consent to this transmission.'}
              </label>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={busy || !consent || !preview.snippets.length}
                  onClick={() =>
                    void run(async () => {
                      const result = (await request(`/v1/documents/${id}/suggest`, {
                        method: 'POST',
                        body: JSON.stringify({ consent: true }),
                      })) as { status: string; calls: number };
                      setMessage(
                        `${result.status} · ${result.calls} ${pt ? 'chamada(s); resultado reutilizado quando já processado.' : 'call(s); reused when already processed.'}`,
                      );
                      setConsent(false);
                      await refresh();
                    })
                  }
                >
                  {pt ? 'Solicitar propostas limitadas' : 'Request bounded suggestions'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
