/** Format/check digits only. Never establishes registration, ownership or reliability.
 * Algorithm: Receita Federal/Serpro manual-dv-cnpj.pdf, checked 2026-10-29.
 */
export function cnpjCheckDigits(base: string): string {
  if (!/^[A-Z0-9]{12}$/.test(base)) throw new Error('INVALID_CNPJ_BASE');
  let result = base;
  for (let round = 0; round < 2; round++) {
    let total = 0,
      weight = 2;
    for (let index = result.length - 1; index >= 0; index--) {
      total += (result.charCodeAt(index) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = total % 11;
    result += remainder < 2 ? '0' : String(11 - remainder);
  }
  return result.slice(12);
}
export function validCnpj(input: string): boolean {
  if (!/^[A-Za-z0-9./ -]+$/.test(input)) return false;
  const value = input.replace(/[./ -]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(value) || new Set(value).size === 1) return false;
  return cnpjCheckDigits(value.slice(0, 12)) === value.slice(12);
}
