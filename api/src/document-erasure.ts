import type { TripContract } from '../../schema/src/trip-contract.js';
/** Privacy erasure deliberately redacts affected historical snapshots, retaining unrelated history. */
export function redactDocument(
  trip: TripContract,
  documentId: string,
): { trip: TripContract; changed: boolean } {
  const output = structuredClone(trip);
  let changed = false;
  for (const service of output.services) {
    if (service.documentIds.includes(documentId)) {
      service.documentIds = service.documentIds.filter((id) => id !== documentId);
      changed = true;
    }
    if (service.reservation.confirmationDocumentId === documentId) {
      service.reservation.confirmationDocumentId = null;
      service.reservation.confirmation = 'not_checked';
      changed = true;
    }
    if (service.cancellation.documentId === documentId) {
      service.cancellation.documentId = null;
      changed = true;
    }
    if (service.fieldSources?.['reservation.reference'] === documentId) {
      service.reservation.reference = null;
      delete service.fieldSources['reservation.reference'];
      changed = true;
    }
    if (service.fieldSources?.baggage === documentId) {
      service.baggage = null;
      delete service.fieldSources.baggage;
      changed = true;
    }
    if (service.fieldSources?.['cancellation.summary'] === documentId) {
      service.cancellation.summary = null;
      delete service.fieldSources['cancellation.summary'];
      changed = true;
    }
  }
  return { trip: output, changed };
}
