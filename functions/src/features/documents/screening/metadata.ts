// Software that edits or composes images. Camera firmware and phone gallery
// "Software" tags (version strings, HDR+) are deliberately not listed.
export const IMAGE_EDITORS = /photoshop|lightroom|gimp|canva|picsart|snapseed|pixlr|photopea|affinity|paint\.net|fotor|befunky|corel|paintshop|pixelmator|inkscape|illustrator|meitu|facetune|photodirector|polarr|remini|vsco|picmonkey|airbrush|lensa/i;
// PDF producers whose main purpose is editing an existing file.
export const PDF_EDITORS = /acrobat (pro|standard)|ilovepdf|smallpdf|sejda|pdfescape|pdfelement|wondershare|nitro|foxit (phantom|pdf editor)|pdf-xchange editor|pdffiller|dochub|sodapdf|pdf candy|canva|photoshop|libreoffice|microsoft.*word|google docs/i;

export interface ImageMetadata {
  software: string | null;
  creatorTool: string | null;
  make: string | null;
  model: string | null;
  original: Date | null;
  modified: Date | null;
  historyActions: string[];
  photoshop: boolean;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "value" in value) return str((value as { value: unknown }).value);
  return null;
}

function date(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// The raw XMP packet is scanned too: exifr flattens xmpMM:History differently
// between writers, while the stEvt:action strings are always present verbatim.
export function rawXmp(bytes: Buffer): string | null {
  const start = bytes.indexOf("<x:xmpmeta", 0, "latin1");
  if (start < 0) return null;
  const end = bytes.indexOf("</x:xmpmeta>", start, "latin1");
  return bytes.toString("utf8", start, end > start ? Math.min(end + 12, start + 262_144) : Math.min(bytes.length, start + 65_536));
}

export async function readImageMetadata(bytes: Buffer): Promise<ImageMetadata> {
  const exifr = require("exifr") as typeof import("exifr");
  const tags: Record<string, unknown> = await exifr.parse(bytes, { tiff: true, exif: true, gps: false, xmp: true, iptc: false, icc: false, jfif: false, ihdr: true, mergeOutput: true, reviveValues: true })
    .catch(() => null) ?? {};
  const xmp = rawXmp(bytes) ?? "";
  const historyActions = [...xmp.matchAll(/stEvt:action\s*=\s*"([^"]+)"|<stEvt:action>([^<]+)</g)].map(match => (match[1] ?? match[2]).trim());
  const historyAgents = [...xmp.matchAll(/stEvt:softwareAgent\s*=\s*"([^"]+)"|<stEvt:softwareAgent>([^<]+)</g)].map(match => (match[1] ?? match[2]).trim());
  return {
    software: str(tags.Software) ?? historyAgents.find(agent => IMAGE_EDITORS.test(agent)) ?? null,
    creatorTool: str(tags.CreatorTool) ?? (/xmp:CreatorTool\s*=\s*"([^"]+)"|<xmp:CreatorTool>([^<]+)</.exec(xmp)?.slice(1).find(Boolean) ?? null),
    make: str(tags.Make),
    model: str(tags.Model),
    original: date(tags.DateTimeOriginal) ?? date(tags.CreateDate),
    modified: date(tags.ModifyDate) ?? date(tags.MetadataDate),
    historyActions,
    photoshop: /photoshop:|Adobe Photoshop/i.test(xmp),
  };
}

// PDF dates look like D:20240102030405+05'30'.
export function pdfDate(value: string | null): Date | null {
  const match = value ? /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value) : null;
  if (!match) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
