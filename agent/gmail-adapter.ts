import { AppError } from '../api/src/errors.js';
import type { BookingObservation, TravelReadAdapter } from './connectors.js';

/** Credentials and message bindings are supplied by the trusted host, not a tool argument. */
export function createGmailReadAdapter(options: {
  bindings: ReadonlyArray<{
    tripKey: string;
    recordKey: string;
    messageId: string;
    sourceRef: string;
  }>;
  accessToken: () => Promise<string>;
  normalizeRawEmail: (
    bytes: Uint8Array,
    context: { recordKey: string; sourceRef: string; signal?: AbortSignal },
  ) => Promise<BookingObservation[]>;
  fetch?: typeof fetch;
}): TravelReadAdapter {
  if (options.bindings.length > 80) throw new AppError('INVALID_GMAIL_BINDINGS', 422);
  const bindings = options.bindings.map((row) => ({ ...row }));
  if (
    new Set(bindings.map((row) => row.sourceRef)).size !== bindings.length ||
    new Set(bindings.map((row) => row.messageId)).size !== bindings.length ||
    bindings.some(
      (row) =>
        !/^[A-Za-z0-9_-]{1,40}$/.test(row.tripKey) ||
        !/^[A-Z][A-Z0-9_-]{1,39}$/.test(row.recordKey) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(row.messageId) ||
        !/^SRC[0-9]{2,6}$/.test(row.sourceRef),
    )
  )
    throw new AppError('INVALID_GMAIL_BINDINGS', 422);
  const http = options.fetch ?? fetch;
  return {
    id: 'gmail',
    documentationUrl:
      'https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get',
    async read({ tripKey, recordKeys, signal }) {
      const selected = bindings.filter(
        (row) => row.tripKey === tripKey && recordKeys.includes(row.recordKey),
      );
      if (
        recordKeys.some((key) => !selected.some((row) => row.recordKey === key)) ||
        selected.length > 20
      )
        throw new AppError('GMAIL_MESSAGE_SCOPE_DENIED', 403);
      const token = await options.accessToken();
      if (!/^[A-Za-z0-9._~+\/-]{10,4096}={0,4}$/.test(token))
        throw new AppError('GMAIL_AUTH_UNAVAILABLE', 403);
      const observations: BookingObservation[] = [];
      for (const binding of selected) {
        signal.throwIfAborted();
        const response = await http(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(binding.messageId)}?format=raw`,
          {
            method: 'GET',
            redirect: 'error',
            cache: 'no-store',
            credentials: 'omit',
            signal,
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          },
        );
        if (!response.ok || !response.body) throw new AppError('GMAIL_READ_REJECTED', 502);
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > 1048576) {
              await reader.cancel();
              throw new AppError('GMAIL_RESPONSE_LIMIT', 422);
            }
            chunks.push(item.value);
          }
        } finally {
          reader.releaseLock();
        }
        const packet = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { raw?: unknown };
        if (
          typeof packet.raw !== 'string' ||
          packet.raw.length > 700000 ||
          !/^[A-Za-z0-9_-]+={0,2}$/.test(packet.raw)
        )
          throw new AppError('GMAIL_RESPONSE_REJECTED', 422);
        const raw = Buffer.from(packet.raw, 'base64url');
        if (raw.byteLength > 524288) throw new AppError('GMAIL_RESPONSE_LIMIT', 422);
        if (!raw.byteLength || raw.toString('base64url') !== packet.raw.replace(/=+$/, ''))
          throw new AppError('GMAIL_RESPONSE_REJECTED', 422);
        const normalized = await options.normalizeRawEmail(raw, {
          recordKey: binding.recordKey,
          sourceRef: binding.sourceRef,
          signal,
        });
        if (
          normalized.length > 1 ||
          normalized.some(
            (row) =>
              row.recordKey !== binding.recordKey ||
              row.sourceRef !== binding.sourceRef ||
              row.origin !== 'email_claim',
          )
        )
          throw new AppError('GMAIL_NORMALIZER_SCOPE_DENIED', 422);
        observations.push(...normalized);
      }
      return observations;
    },
  };
}
