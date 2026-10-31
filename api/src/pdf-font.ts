import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, normalize, resolve } from 'node:path';
import { AppError } from './errors.js';

/** Operator configuration only; never populate these fields from imported travel data. */
export interface PdfFontOptions {
  fontPath?: string;
  /** PostScript face name, required when selecting a face from a font collection. */
  fontFamily?: string;
}

interface CoverageFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
  postscriptName?: string;
}

const fontkit = createRequire(import.meta.url)('fontkit') as {
  create(buffer: Buffer, postscriptName?: string): unknown;
};
const MAX_FONT_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_UNITS = 2_000_000;
// Unicode characters explicitly mapped by PDFKit 0.20.2's standard-font WinAnsi encoder.
const WIN_ANSI_EXTRA = new Set([
  402, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230, 8364, 8240, 8249,
  8250, 710, 8482, 338, 339, 732, 352, 353, 376, 381, 382,
]);

export function validatePdfFontOptions(options: PdfFontOptions = {}): PdfFontOptions {
  const { fontPath, fontFamily } = options;
  if (
    (fontPath !== undefined &&
      (typeof fontPath !== 'string' ||
        fontPath.length > 4096 ||
        !isAbsolute(fontPath) ||
        /^[\\/]{2}/.test(fontPath) ||
        /[\u0000-\u001f\u007f]/.test(fontPath) ||
        /:/.test(fontPath.replace(/^[A-Za-z]:/, '')))) ||
    (fontFamily !== undefined &&
      (typeof fontFamily !== 'string' ||
        !fontPath ||
        fontFamily.length < 1 ||
        fontFamily.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(fontFamily)))
  )
    throw new AppError('PDF_FONT_CONFIGURATION_INVALID', 503);
  return { fontPath, fontFamily };
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : normalize(a) === normalize(b);
}

async function readTrustedFont(fontPath: string): Promise<Buffer> {
  try {
    const before = await lstat(fontPath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size < 1 ||
      before.size > MAX_FONT_BYTES ||
      !samePath(await realpath(fontPath), resolve(fontPath))
    )
      throw new AppError('PDF_FONT_UNAVAILABLE', 503);
    const file = await open(fontPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await file.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        opened.mtimeMs !== before.mtimeMs ||
        opened.ctimeMs !== before.ctimeMs
      )
        throw new AppError('PDF_FONT_UNAVAILABLE', 503);
      // A fixed-size read prevents a concurrently growing file from allocating unbounded memory.
      const bytes = Buffer.alloc(opened.size);
      let position = 0;
      while (position < bytes.length) {
        const { bytesRead } = await file.read(bytes, position, bytes.length - position, position);
        if (bytesRead === 0) throw new AppError('PDF_FONT_UNAVAILABLE', 503);
        position += bytesRead;
      }
      const after = await file.stat();
      const current = await lstat(fontPath);
      if (
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs ||
        current.isSymbolicLink() ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        current.size !== opened.size ||
        current.mtimeMs !== opened.mtimeMs ||
        current.ctimeMs !== opened.ctimeMs ||
        !samePath(await realpath(fontPath), resolve(fontPath))
      )
        throw new AppError('PDF_FONT_UNAVAILABLE', 503);
      return bytes;
    } finally {
      await file.close();
    }
  } catch {
    // Do not propagate filesystem paths, face names or native-parser messages to the API.
    throw new AppError('PDF_FONT_UNAVAILABLE', 503);
  }
}

export interface PreparedPdfFont {
  source: 'Helvetica' | Buffer;
  family?: string;
}

/** Validate every code point before constructing a PDF. The verified bytes are also rendered. */
export async function preparePdfFont(
  texts: readonly string[],
  options: PdfFontOptions = {},
): Promise<PreparedPdfFont> {
  const { fontPath, fontFamily } = validatePdfFontOptions(options);
  let total = 0;
  const codePoints = new Set<number>();
  for (const text of texts) {
    total += text.length;
    if (total > MAX_TEXT_UNITS) throw new AppError('PDF_TEXT_LIMIT', 422);
    for (const character of text) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint !== 10 && codePoint !== 13) codePoints.add(codePoint);
    }
  }
  if (!fontPath) {
    for (const codePoint of codePoints)
      if (!(
        (codePoint >= 32 && codePoint <= 126) ||
        (codePoint >= 160 && codePoint <= 255) ||
        WIN_ANSI_EXTRA.has(codePoint)
      ))
        throw new AppError('PDF_FONT_MISSING_GLYPH', 422);
    return { source: 'Helvetica' };
  }
  const bytes = await readTrustedFont(fontPath);
  let font: unknown;
  let collection = false;
  try {
    font = fontkit.create(bytes);
    collection =
      !font || typeof (font as Partial<CoverageFont>).hasGlyphForCodePoint !== 'function';
    if (collection && fontFamily) font = fontkit.create(bytes, fontFamily);
  } catch {
    throw new AppError('PDF_FONT_INVALID_OR_FACE_NOT_FOUND', 503);
  }
  if (!font || typeof (font as Partial<CoverageFont>).hasGlyphForCodePoint !== 'function')
    throw new AppError('PDF_FONT_FACE_REQUIRED', 503);
  try {
    if (fontFamily && (font as CoverageFont).postscriptName !== fontFamily)
      throw new AppError('PDF_FONT_INVALID_OR_FACE_NOT_FOUND', 503);
    for (const codePoint of codePoints)
      if (!(font as CoverageFont).hasGlyphForCodePoint(codePoint))
        throw new AppError('PDF_FONT_MISSING_GLYPH', 422);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('PDF_FONT_INVALID_OR_FACE_NOT_FOUND', 503);
  }
  // For individual fonts, fontkit's optional second parameter selects a variation, not a face.
  return { source: bytes, family: collection ? fontFamily : undefined };
}
