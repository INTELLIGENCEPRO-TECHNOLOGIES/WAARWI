const END = 0x06054b50;
const DIRECTORY = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRY_BYTES = 36 * 1024 * 1024;
const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;
const ZIP32_MAX = 0xffffffff;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const archiveIdPattern = new RegExp('^' + uuid + '$', 'i');
const rootPattern = new RegExp('^waarwi-v3-(?:lws-)?(' + uuid + ')/', 'i');

type ZipEntry = {
  name: string;
  offset: number;
  flags: number;
  method: number;
  packedSize: number;
  size: number;
};

function invalidZip(): never {
  throw new Error('Choisissez un ZIP V3 Waarwi complet contenant le manifeste et tous les blocs.');
}

async function readBytes(file: Blob, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > file.size) invalidZip();
  return new DataView(await file.slice(offset, offset + length).arrayBuffer());
}

function nameAt(data: DataView, offset: number, length: number) {
  try {
    return utf8.decode(new Uint8Array(data.buffer, data.byteOffset + offset, length));
  } catch {
    return invalidZip();
  }
}

function directoryEnd(tail: DataView) {
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) return i;
  }
  return invalidZip();
}

async function unpack(file: Blob, entry: ZipEntry, directoryOffset: number): Promise<Blob> {
  const header = await readBytes(file, entry.offset, 30);
  if (header.getUint32(0, true) !== LOCAL || header.getUint16(6, true) !== entry.flags ||
      header.getUint16(8, true) !== entry.method) invalidZip();
  const nameLength = header.getUint16(26, true);
  const offset = entry.offset + 30 + nameLength + header.getUint16(28, true);
  if (offset + entry.packedSize > directoryOffset) invalidZip();
  const localName = await readBytes(file, entry.offset + 30, nameLength);
  if (nameAt(localName, 0, nameLength) !== entry.name) invalidZip();

  const packed = file.slice(offset, offset + entry.packedSize);
  if (entry.method === 0) return packed;
  const reader = packed.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const output = new Uint8Array(entry.size);
  let offsetOut = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offsetOut + value.byteLength > output.byteLength) {
        await reader.cancel();
        invalidZip();
      }
      output.set(value, offsetOut);
      offsetOut += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offsetOut !== output.byteLength) invalidZip();
  return new Blob([output]);
}

export async function readBackupV3Zip(file: Blob) {
  if (file.size < 22 || file.size >= ZIP32_MAX) invalidZip();
  const tailOffset = Math.max(0, file.size - 65_557);
  const tail = await readBytes(file, tailOffset, file.size - tailOffset);
  const end = directoryEnd(tail);
  const records = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 6, true) !== 0 ||
      tail.getUint16(end + 8, true) !== records || records === 0 || records === 0xffff ||
      directorySize > MAX_DIRECTORY_BYTES || directoryOffset + directorySize !== tailOffset + end) invalidZip();

  const directory = await readBytes(file, directoryOffset, directorySize);
  const entries = new Map<number, ZipEntry>();
  let cursor = 0;
  let folder: string | undefined;
  for (let count = 0; count < records; count++) {
    if (cursor + 46 > directorySize || directory.getUint32(cursor, true) !== DIRECTORY) invalidZip();
    const flags = directory.getUint16(cursor + 8, true);
    const method = directory.getUint16(cursor + 10, true);
    const packedSize = directory.getUint32(cursor + 20, true);
    const size = directory.getUint32(cursor + 24, true);
    const nameLength = directory.getUint16(cursor + 28, true);
    const entryOffset = directory.getUint32(cursor + 42, true);
    const endName = cursor + 46 + nameLength;
    const next = endName + directory.getUint16(cursor + 30, true) + directory.getUint16(cursor + 32, true);
    if (next > directorySize || directory.getUint16(cursor + 34, true) !== 0 ||
        (flags & 0x41) !== 0 || (method !== 0 && method !== 8) ||
        packedSize > MAX_ENTRY_BYTES || size > MAX_ENTRY_BYTES ||
        (method === 0 && packedSize !== size) || entryOffset + 30 > directoryOffset) invalidZip();

    const name = nameAt(directory, cursor + 46, nameLength);
    const prefix = name.match(rootPattern)?.[0] ?? '';
    const relative = name.slice(prefix.length);
    cursor = next;
    if ((relative === 'blocks/' || (prefix && relative === '')) && size === 0) continue;
    if (folder !== undefined && prefix !== folder) invalidZip();
    folder = prefix;
    const match = /^blocks\/([0-9]{6})\.wbr3$/.exec(relative);
    const number = relative === 'manifest.wbr3m' ? 0 : match ? Number(match[1]) : -1;
    if (number < 0 || (number === 0 && relative !== 'manifest.wbr3m') || size < 8 || entries.has(number)) invalidZip();
    entries.set(number, { name, offset: entryOffset, flags, method, packedSize, size });
  }

  const manifestEntry = entries.get(0);
  if (!manifestEntry || cursor !== directorySize) invalidZip();
  for (let i = 0; i < entries.size; i++) if (!entries.has(i)) invalidZip();

  const manifest = await unpack(file, manifestEntry, directoryOffset);
  const header = await readBytes(manifest, 0, Math.min(4104, manifest.size));
  if (header.getUint32(0) !== 0x57425233) invalidZip();
  const length = header.getUint32(4);
  if (length < 1 || length > header.byteLength - 8 || manifest.size < 8 + length + 16) invalidZip();
  let archiveId: string;
  try {
    const envelope = JSON.parse(nameAt(header, 8, length));
    if (envelope.kind !== 'manifest' || envelope.block_no !== 0 || envelope.container_version !== 1 ||
        typeof envelope.archive_id !== 'string' || !archiveIdPattern.test(envelope.archive_id)) invalidZip();
    archiveId = envelope.archive_id.toLowerCase();
  } catch {
    return invalidZip();
  }
  if (folder && folder.match(rootPattern)?.[1].toLowerCase() !== archiveId) invalidZip();

  return {
    archiveId,
    blockCount: entries.size - 1,
    async part(number: number): Promise<Blob> {
      const entry = entries.get(number);
      if (!entry) return invalidZip();
      return number === 0 ? manifest : unpack(file, entry, directoryOffset);
    },
  };
}
