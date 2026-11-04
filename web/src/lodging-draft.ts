/** Draft lodging needs at least one night; a same-day trip gets a next-day check-out to edit. */
export function lodgingDraftDates(trip?: { startDate?: string; endDate?: string }) {
  const checkIn = trip?.startDate ?? '2030-01-01';
  const end = trip?.endDate ?? checkIn;
  if (end > checkIn) return { checkIn, checkOut: end };
  const next = new Date(`${checkIn}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { checkIn, checkOut: next.toISOString().slice(0, 10) };
}
