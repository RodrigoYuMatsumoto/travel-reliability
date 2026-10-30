/** Conservative screening for optional outbound model snippets, never a PII guarantee. */
export function sensitiveTextReasons(text: string): string[] {
  const value = text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const reasons: string[] = [];
  if (/@/.test(value)) reasons.push('CONTACT_OR_EMAIL');
  if (/https?:\/\//i.test(value)) reasons.push('URL_REQUIRES_REDACTION');
  if (/\b(?:\d[ .()/-]?){9,19}\b/.test(value)) reasons.push('LONG_NUMERIC_IDENTIFIER');
  if (
    /\b(?:cpf|cnh|passport|passaporte|documento|identidade|date of birth|nascimento|dob)\s*(?:[:#]|n[.oº])/i.test(
      value,
    )
  )
    reasons.push('IDENTITY_LABEL');
  if (
    /\b(?:passageir[oa]|passenger|guest|hospede|titular|nome|name|cliente|driver|payer|endereco|address|chave pix|bank account|senha|password|pin)\s*[:#]/i.test(
      value,
    )
  )
    reasons.push('PERSONAL_OR_SECRET_LABEL');
  if (
    /\b(?:pnr|localizador|booking\s*(?:reference|code)|reservation\s*(?:reference|code)|codigo da reserva|voucher|ticket number)\s*[:#]/i.test(
      value,
    )
  )
    reasons.push('BOOKING_REFERENCE');
  if (
    /\b[A-Z][A-Z'-]{1,29}\/[A-Z][A-Z'-]{1,29}(?: [A-Z][A-Z'-]{1,29}){0,3} (?:MR|MRS|MS|CHD|INF)\b/.test(
      value,
    )
  )
    reasons.push('TICKET_NAME');
  return reasons;
}
