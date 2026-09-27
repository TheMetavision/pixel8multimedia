// Types for print-spec.mjs (the site and the Studio import it from TypeScript).
export type SizeKey = 'small' | 'medium' | 'large';
export type FormatKey = 'poster' | 'canvasStandard' | 'canvasGallery';

export declare const DPI: number;
export declare const SIZE_KEYS: SizeKey[];
export declare const FORMAT_KEYS: FormatKey[];
export declare const SIZE_INCHES: Record<SizeKey, number>;
export declare const SIZE_LABELS: Record<SizeKey, string>;
export declare const SIZE_DIMENSIONS: Record<SizeKey, string>;
export declare const SIZE_SHORT_LABELS: Record<SizeKey, string>;
export declare const FORMAT_LABELS: Record<FormatKey, string>;
export declare const WRAP_INCHES: Record<FormatKey, Record<SizeKey, number>>;
export declare const MAX_SHEET_INCHES: number;
export declare function isSizeKey(k: unknown): k is SizeKey;
export declare function isFormatKey(k: unknown): k is FormatKey;
export declare function printGeometry(sizeKey: SizeKey, formatKey: FormatKey): {
  faceIn: number; wrapIn: number; sheetIn: number; facePx: number; wrapPx: number; sheetPx: number;
};
export declare const OUTPUT: { format: 'jpeg'; mime: string; ext: string; quality: number; chromaSubsampling: string; icc: string };
