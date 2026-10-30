import React, { useState } from 'react';
export function DocumentRetention({
  expiry,
  locale,
  update,
}: {
  expiry: string | null;
  locale: 'pt-BR' | 'en';
  update: (expiresAt: string | null) => Promise<void>;
}) {
  const [date, setDate] = useState(expiry?.slice(0, 10) ?? ''),
    [indefinite, setIndefinite] = useState(expiry === null),
    [message, setMessage] = useState('');
  const pt = locale === 'pt-BR';
  return (
    <details>
      <summary>{pt ? 'Prazo de retenção do documento' : 'Document retention deadline'}</summary>
      <p>
        {pt
          ? 'O prazo remove também derivados vinculados. Backups e cópias exportadas seguem a política do operador.'
          : 'Expiry removes linked derivatives too. Backups and exported copies follow operator policy.'}
      </p>
      <label className="field">
        <span>{pt ? 'Reter até o fim desta data (UTC)' : 'Retain through this date (UTC)'}</span>
        <input
          type="date"
          value={date}
          disabled={indefinite}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={indefinite}
          onChange={(e) => setIndefinite(e.target.checked)}
        />{' '}
        {pt
          ? 'Escolher retenção indefinida explicitamente'
          : 'Explicitly choose indefinite retention'}
      </label>
      <div className="button-row">
        <button
          className="secondary"
          disabled={!indefinite && !date}
          onClick={async () => {
            try {
              await update(indefinite ? null : date + 'T23:59:59Z');
              setMessage(pt ? 'Prazo atualizado.' : 'Deadline updated.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'RETENTION_FAILED');
            }
          }}
        >
          {pt ? 'Atualizar retenção' : 'Update retention'}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
