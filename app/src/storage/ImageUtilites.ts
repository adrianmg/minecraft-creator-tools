import * as exifrModule from "exifr";
// Handle CJS/ESM interop: esbuild wraps CJS default export, while ts-node uses named exports directly
const Exifr = (exifrModule as any).Exifr || (exifrModule as any).default?.Exifr;
import IFile from "./IFile";
import StorageUtilities from "./StorageUtilities";
import Log from "../core/Log";

/*
  Parses an image file, returning an any object with various metadata such as width and height

  available data is based on image format, see Exifr docs for info
*/
export async function parseImageMetadata(file: IFile): Promise<any | null> {
  let fileData: Uint8Array | null = null;

  try {
    if (!file.isContentLoaded) {
      await file.loadContent();
    }

    fileData = StorageUtilities.getContentsAsBinary(file);
  } catch (error) {
    Log.verbose("Error loading image content: " + error);
    return null;
  }

  if (!fileData) {
    return null;
  }

  try {
    const imageReader = new Exifr();
    const metadata = await imageReader.read(fileData).then(() => imageReader.parse());

    if (metadata && metadata.ImageWidth !== undefined && metadata.ImageHeight !== undefined) {
      return metadata;
    }
  } catch (error) {
    Log.verbose("Error parsing image metadata: " + error);
  }

  // Exifr only reads metadata segments, so a plain JFIF JPEG with no EXIF
  // block (the common case for exported world icons) parses as nothing;
  // recover the dimensions from the JPEG frame header instead.
  return parseJpegDimensions(fileData);
}

/**
 * Reads ImageWidth/ImageHeight from a JPEG's start-of-frame segment by
 * walking the marker segments from SOI. Returns null when the bytes are not
 * a JPEG, a segment is malformed or truncated, or no frame header appears
 * before the entropy-coded data.
 */
function parseJpegDimensions(bytes: Uint8Array): { ImageWidth: number; ImageHeight: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let index = 2;

  while (index < bytes.length) {
    // Every segment starts with 0xFF; anything else here is a malformed stream.
    if (bytes[index] !== 0xff) {
      return null;
    }

    // Consume optional fill bytes: markers may be padded with repeated 0xFF.
    while (index < bytes.length && bytes[index] === 0xff) {
      index++;
    }

    if (index >= bytes.length) {
      return null;
    }

    const marker = bytes[index];
    index++;

    // Standalone markers carry no length: TEM (0x01), RST0–RST7 (0xD0–0xD7),
    // and a stray SOI (0xD8). EOI (0xD9) before any frame header means the
    // stream has no dimensions to read.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }

    if (marker === 0xd9) {
      return null;
    }

    // SOS (0xDA) starts the entropy-coded data; every frame header sits
    // before it, so reaching here without one means the JPEG is malformed.
    if (marker === 0xda) {
      return null;
    }

    // Remaining markers carry a two-byte big-endian length that includes the
    // length field itself; the whole declared payload must be present.
    if (index + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = (bytes[index] << 8) | bytes[index + 1];

    if (segmentLength < 2 || index + segmentLength > bytes.length) {
      return null;
    }

    // SOF0–SOF15 carry the frame dimensions; 0xC4 (DHT), 0xC8 (JPG), and
    // 0xCC (DAC) share the range but are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Length(2) + precision(1) + height(2) + width(2) + component count(1).
      if (segmentLength < 8) {
        return null;
      }

      return {
        ImageHeight: (bytes[index + 3] << 8) | bytes[index + 4],
        ImageWidth: (bytes[index + 5] << 8) | bytes[index + 6],
      };
    }

    index += segmentLength;
  }

  return null;
}

export function isPackIcon(file?: IFile | null): boolean {
  return !!file && file.name.includes("pack_icon") && file.name.endsWith(".png");
}

export function isWorldIcon(file?: IFile): boolean {
  return !!file && file.name.includes("world_icon") && file.name.endsWith(".jpeg");
}
