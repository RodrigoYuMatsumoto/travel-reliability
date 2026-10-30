import { useState } from 'react';
import { scryptAsync } from '@noble/hashes/scrypt.js';
interface OfflineBundle {
  format: string;
  dossier: { trip: { title: string }; request: string; timeline: unknown[] };
  files: Array<{ id: string; sha256: string; base64: string }>;
}
export function OfflineViewer() {
  const [file, setFile] = useState<File | null>(null),
    [passphrase, setPassphrase] = useState(''),
    [bundle, setBundle] = useState<OfflineBundle | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const unlock = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setBundle(null);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('Bundle exceeds 64 MiB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'TRB1' || bytes.length < 48)
        throw new Error('Invalid bundle');
      const key = await scryptAsync(new TextEncoder().encode(passphrase), bytes.slice(4, 20), {
        N: 32768,
        r: 8,
        p: 1,
        dkLen: 32,
      });
      const imported = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, [
        'decrypt',
      ]);
      key.fill(0);
      const sealed = new Uint8Array(bytes.length - 32);
      sealed.set(bytes.slice(48));
      sealed.set(bytes.slice(32, 48), bytes.length - 48);
      const plain = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes.slice(20, 32),
          additionalData: new TextEncoder().encode('TRB1'),
          tagLength: 128,
        },
        imported,
        sealed,
      );
      const result = JSON.parse(new TextDecoder().decode(plain)) as OfflineBundle;
      if (
        result.format !== 'travel-reliability-bundle/1.0.0' ||
        !Array.isArray(result.files) ||
        typeof result.dossier?.trip?.title !== 'string'
      )
        throw new Error('Invalid manifest');
      for (const evidence of result.files) {
        if (
          !/^[a-f0-9-]{36}$/i.test(evidence.id) ||
          !/^[a-f0-9]{64}$/i.test(evidence.sha256) ||
          typeof evidence.base64 !== 'string'
        )
          throw new Error('Invalid evidence record');
        const data = Uint8Array.from(atob(evidence.base64), (char) => char.charCodeAt(0));
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        if (hash !== evidence.sha256) throw new Error('Evidence integrity failure');
      }
      setBundle(result);
      setPassphrase('');
    } catch {
      setError(
        'Senha incorreta, pacote inválido ou integridade comprometida. / Wrong passphrase, invalid bundle or compromised integrity.',
      );
    } finally {
      setBusy(false);
    }
  };
  const download = (value: string, name: string) => {
    const blob = new Blob([value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return (
    <main className="welcome">
      <a className="brand" href="/">
        <img src="/icon.svg" alt="" />
        <strong>Travel Reliability</strong>
      </a>
      <section className="panel">
        <h1>Offline evidence</h1>
        <p>
          Verificação local. Nenhum pacote ou senha é enviado ao servidor.
          <br />
          Local verification. No bundle or passphrase is sent to a server.
        </p>
        <label className="field">
          <span>Pacote / Bundle (.trb)</span>
          <input
            type="file"
            accept=".trb"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setBundle(null);
            }}
          />
        </label>
        <label className="field">
          <span>Senha / Passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="primary"
          disabled={!file || !passphrase || busy}
          onClick={() => void unlock()}
        >
          {busy ? 'Verificando / Verifying…' : 'Abrir e verificar / Open and verify'}
        </button>
        {error && <p role="alert">{error}</p>}
        {bundle && (
          <div role="status">
            <h2>{bundle.dossier.trip.title}</h2>
            <p>{bundle.files.length} arquivo(s) verificado(s) / verified file(s)</p>
            <p>
              Hashes não provam autenticidade ou data externa. / Hashes do not prove authenticity or
              trusted time.
            </p>
            <button
              className="secondary"
              onClick={() => download(JSON.stringify(bundle.dossier, null, 2), 'dossier.json')}
            >
              Dossiê JSON / JSON dossier
            </button>
            <pre className="json-preview">{JSON.stringify(bundle.dossier, null, 2)}</pre>
            <button
              className="danger"
              onClick={() => {
                setBundle(null);
                setPassphrase('');
                setFile(null);
              }}
            >
              Bloquear / Lock
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
