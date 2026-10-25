/** Mirrors the server's normalisation: letters and digits only, upper-cased. */
export function normalizeAccessCode(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** Display form used while typing, e.g. "abcd efgh" → "ABCD-EFGH". */
export function formatAccessCodeInput(raw: string): string {
  const clean = normalizeAccessCode(raw).slice(0, 16);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}

export const MIN_ACCESS_CODE_LENGTH = 8;
