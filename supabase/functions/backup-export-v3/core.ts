// Cœur du worker v3 (Lot C) : sans dépendance externe, exécutable sous Deno et Node (tests).
// Les lignes capturées restent des chaînes opaques produites par PostgreSQL : jamais de JSON.parse sur une ligne.

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;

export interface ObjectStore {
  // Doit refuser d'écraser un objet existant.
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
}

export interface RemoteStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
}

export interface KeyRing {
  currentId: string;
  keys: Map<string, CryptoKey>;
}

export interface ExportDeps {
  rpc: Rpc;
  store: ObjectStore;
  keyring: KeyRing;
  checkpoint?: (point: string, info?: Record<string, unknown>) => Promise<void> | void;
  now?: () => number;
}

export const CONTAINER_MAGIC = "WBR3";
export const CONTAINER_VERSION = 1;
export const ALGORITHM = "AES-256-GCM";
const HEADER_MAX = 4096;
// manifest_bytes is the stored (compressed) size; the plain manifest is bound by its verified sha256.
const MANIFEST_PLAIN_MAX = 32 * 1024 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export class IntegrityError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256hex(data: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("Encryption key must be exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBounded(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IntegrityError("BRV-032", "decompressed block exceeds the declared limit");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export interface Binding {
  kind: "block" | "manifest";
  tenant_id: string;
  archive_id: string;
  generation_id: string;
  block_no: number;
  key_id: string;
}

export function aadFor(b: Binding): Uint8Array {
  return enc.encode(
    `waarwi-br3|${b.kind}|${b.tenant_id}|${b.archive_id}|${b.generation_id}|${b.block_no}|${b.key_id}`,
  );
}

export interface ContainerHeader extends Binding {
  container: string;
  container_version: number;
  algorithm: string;
  nonce_hex: string;
}

// Conteneur : "WBR3" | uint32 BE longueur d'en-tête | en-tête JSON | AES-GCM(gzip(clair)) avec AAD liée.
export async function seal(
  plain: Uint8Array,
  binding: Binding,
  key: CryptoKey,
): Promise<{ bytes: Uint8Array; nonce_hex: string; stored_sha256: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const nonce_hex = hex(nonce);
  const compressed = await gzip(plain);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aadFor(binding) }, key, compressed),
  );
  const header: ContainerHeader = {
    container: CONTAINER_MAGIC,
    container_version: CONTAINER_VERSION,
    algorithm: ALGORITHM,
    nonce_hex,
    ...binding,
  };
  const hb = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + hb.length + ct.length);
  out.set(enc.encode(CONTAINER_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, hb.length, false);
  out.set(hb, 8);
  out.set(ct, 8 + hb.length);
  return { bytes: out, nonce_hex, stored_sha256: await sha256hex(out) };
}

export function parseContainer(data: Uint8Array): { header: ContainerHeader; ciphertext: Uint8Array } {
  if (data.length < 8 || dec.decode(data.subarray(0, 4)) !== CONTAINER_MAGIC) {
    throw new IntegrityError("BRV-032", "not a WBR3 container");
  }
  const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
  if (len <= 0 || len > HEADER_MAX || 8 + len > data.length) {
    throw new IntegrityError("BRV-032", "invalid container header length");
  }
  let header: ContainerHeader;
  try {
    header = JSON.parse(dec.decode(data.subarray(8, 8 + len)));
  } catch {
    throw new IntegrityError("BRV-032", "unreadable container header");
  }
  if (header.container !== CONTAINER_MAGIC || header.container_version !== CONTAINER_VERSION ||
      header.algorithm !== ALGORITHM || !/^[0-9a-f]{24}$/.test(header.nonce_hex ?? "")) {
    throw new IntegrityError("BRV-032", "unsupported container header");
  }
  return { header, ciphertext: data.subarray(8 + len) };
}

// L'AAD est reconstruite depuis les valeurs attendues (référence serveur), jamais depuis l'en-tête lu.
export async function open(
  data: Uint8Array,
  expected: Binding,
  keyring: KeyRing,
  maxPlainBytes: number,
): Promise<{ plain: Uint8Array; header: ContainerHeader }> {
  const { header, ciphertext } = parseContainer(data);
  for (const f of ["kind", "tenant_id", "archive_id", "generation_id", "block_no", "key_id"] as const) {
    if (String(header[f]) !== String(expected[f])) {
      throw new IntegrityError("BRV-032", `container ${f} does not match the expected archive`);
    }
  }
  const key = keyring.keys.get(expected.key_id);
  if (!key) throw new Error(`BRV-044: key ${expected.key_id} is not available`);
  let compressed: Uint8Array;
  try {
    compressed = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unhex(header.nonce_hex), additionalData: aadFor(expected) },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw new IntegrityError("BRV-032", "authentication failed (altered, foreign or wrong key)");
  }
  let plain: Uint8Array;
  try {
    plain = await gunzipBounded(compressed, maxPlainBytes);
  } catch (e) {
    if (e instanceof IntegrityError) throw e;
    throw new IntegrityError("BRV-032", "invalid compressed payload");
  }
  return { plain, header };
}

// Bloc clair : ligne d'en-tête JSON puis une ligne jsonb::text par ligne capturée, chaque ligne terminée par \n.
export function splitBlock(plain: Uint8Array): { header: Record<string, unknown>; rows: number } {
  const nl = plain.indexOf(0x0a);
  if (nl <= 0 || plain[plain.length - 1] !== 0x0a) throw new IntegrityError("BRV-032", "malformed block body");
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(dec.decode(plain.subarray(0, nl)));
  } catch {
    throw new IntegrityError("BRV-032", "unreadable block header");
  }
  if (header.format !== "waarwi-br-block") throw new IntegrityError("BRV-032", "unexpected block format");
  let rows = 0;
  for (let i = nl + 1; i < plain.length; i++) if (plain[i] === 0x0a) rows++;
  return { header, rows };
}

export function rowLines(plain: Uint8Array): string[] {
  const text = dec.decode(plain);
  const lines = text.split("\n");
  lines.pop();
  return lines.slice(1);
}

function errCode(e: unknown): string {
  const m = /\b(BR[VR]?-\d{3})\b/.exec(String((e as Error)?.message ?? e));
  return m ? m[1] : ((e as IntegrityError)?.code ?? "WORKER_ERROR");
}

function isLeaseLoss(code: string): boolean {
  return code === "BRV-010" || code === "BRV-011" || code === "BRV-012";
}

export interface InvocationResult {
  outcome: "idle" | "progress" | "verified" | "failed" | "lease_lost" | "error";
  archive_id?: string;
  status?: string;
  blocks_written: number;
  blocks_verified: number;
  error_code?: string;
  timings_ms: Record<string, number>;
}

// Une invocation = travail borné (max_blocks_per_invocation blocs exportés ou vérifiés), puis libération du bail.
export async function runExportInvocation(deps: ExportDeps, workerId: string): Promise<InvocationResult> {
  const now = deps.now ?? (() => performance.now());
  const cp = deps.checkpoint ?? (() => {});
  const res: InvocationResult = { outcome: "idle", blocks_written: 0, blocks_verified: 0, timings_ms: {} };
  const tick = (k: string, t0: number) => (res.timings_ms[k] = (res.timings_ms[k] ?? 0) + (now() - t0));

  const claim = await deps.rpc("_br_v3_export_claim", { p_worker_id: workerId });
  if (!claim) return res;
  const id: string = claim.archive_id;
  const token: string = claim.lease_token;
  const budget: number = claim.max_blocks_per_invocation;
  const rowMax: number = claim.row_max_bytes;
  const plainMax = rowMax + 8192;
  res.archive_id = id;
  res.outcome = "progress";
  let status: string = claim.status;
  const base = { tenant_id: claim.tenant_id, archive_id: id, generation_id: claim.generation_id };

  try {
    let work = 0;
    let renewedAt = now();
    while (work < budget) {
      if (now() - renewedAt > 60_000) {
        await deps.rpc("_br_v3_export_renew", { p_archive_id: id, p_token: token, p_seconds: 300 });
        renewedAt = now();
      }
      if (status === "exporting") {
        let t0 = now();
        const rb = await deps.rpc("_br_v3_read_block", { p_archive_id: id, p_token: token });
        tick("read", t0);
        if (rb.done) {
          await cp("after_blocks_before_finish");
          const fin = await deps.rpc("_br_v3_finish_blocks", { p_archive_id: id, p_token: token });
          status = fin.status;
          continue;
        }
        const keyId = claim.key_id ?? deps.keyring.currentId;
        const key = deps.keyring.keys.get(keyId);
        if (!key) throw new Error(`BRV-044: key ${keyId} is not available`);
        const body = enc.encode(rb.body as string);
        t0 = now();
        const sealed = await seal(body, { ...base, kind: "block", block_no: rb.block_no, key_id: keyId }, key);
        tick("encrypt", t0);
        await cp("after_encrypt_before_upload", { block_no: rb.block_no });
        const attempt = crypto.randomUUID();
        const path = `${claim.storage_prefix}blocks/${String(rb.block_no).padStart(6, "0")}-${attempt}.wbr3`;
        t0 = now();
        await deps.store.put(path, sealed.bytes);
        tick("upload", t0);
        await cp("after_upload_before_commit", { block_no: rb.block_no, path });
        await deps.rpc("_br_v3_commit_block", {
          p_archive_id: id,
          p_token: token,
          p_block: {
            block_no: rb.block_no, attempt_id: attempt, table: rb.table, ord_from: rb.ord_from, ord_to: rb.ord_to,
            rows: rb.rows, plain_sha256: rb.plain_sha256, stored_sha256: sealed.stored_sha256,
            stored_bytes: sealed.bytes.length, object_path: path, key_id: keyId, nonce_hex: sealed.nonce_hex,
          },
        });
        claim.key_id = keyId;
        res.blocks_written++;
        work++;
      } else if (status === "verifying") {
        const tgt = await deps.rpc("_br_v3_verify_target", {
          p_archive_id: id, p_token: token, p_limit: budget - work,
        });
        if (!tgt.blocks.length) throw new IntegrityError("BRV-031", "no block left to verify");
        for (const k of tgt.blocks) {
          await cp("before_verify_block", { block_no: k.block_no, object_path: k.object_path });
          const t0 = now();
          const stored = await deps.store.get(k.object_path).catch(() => {
            throw new IntegrityError("BRV-030", `block ${k.block_no} is missing from storage`);
          });
          const storedSha = await sha256hex(stored);
          if (storedSha !== k.stored_sha256 || stored.length !== Number(k.stored_bytes)) {
            throw new IntegrityError("BRV-032", `block ${k.block_no} stored bytes differ`);
          }
          const { plain, header: ch } = await open(
            stored, { ...base, kind: "block", block_no: k.block_no, key_id: k.key_id }, deps.keyring, plainMax,
          );
          const { header, rows } = splitBlock(plain);
          const r = await deps.rpc("_br_v3_mark_block_verified", {
            p_archive_id: id,
            p_token: token,
            p_check: {
              block_no: k.block_no, stored_sha256: storedSha, stored_bytes: stored.length,
              plain_sha256: await sha256hex(plain), plain_bytes: plain.length, rows, key_id: k.key_id,
              nonce_hex: ch.nonce_hex, header,
            },
          });
          tick("verify", t0);
          res.blocks_verified++;
          work++;
          status = r.status ?? status;
        }
      } else if (status === "publishing") {
        const t0 = now();
        const m = await deps.rpc("_br_v3_get_manifest", { p_archive_id: id, p_token: token });
        const keyId = m.key_id ?? deps.keyring.currentId;
        const key = deps.keyring.keys.get(keyId);
        if (!key) throw new Error(`BRV-044: key ${keyId} is not available`);
        const plain = enc.encode(m.manifest_text as string);
        if ((await sha256hex(plain)) !== m.plain_sha256) throw new IntegrityError("BRV-040", "manifest transport mismatch");
        const binding: Binding = { ...base, kind: "manifest", block_no: 0, key_id: keyId };
        const sealed = await seal(plain, binding, key);
        const attempt = crypto.randomUUID();
        const path = `${claim.storage_prefix}manifest-${attempt}.wbr3m`;
        await deps.store.put(path, sealed.bytes);
        await cp("after_manifest_upload_before_publish", { path });
        const back = await deps.store.get(path);
        const reopened = await open(back, binding, deps.keyring, plain.length + 1);
        if ((await sha256hex(reopened.plain)) !== m.plain_sha256) {
          throw new IntegrityError("BRV-040", "published manifest differs from the server reference");
        }
        const pub = await deps.rpc("_br_v3_publish", {
          p_archive_id: id,
          p_token: token,
          p_manifest: {
            path, attempt_id: attempt, key_id: keyId, nonce_hex: sealed.nonce_hex,
            stored_sha256: sealed.stored_sha256, stored_bytes: sealed.bytes.length, plain_sha256: m.plain_sha256,
          },
        });
        tick("publish", t0);
        await cp("after_publish_before_close", { path });
        res.outcome = "verified";
        res.status = pub.status;
        return res;
      } else {
        break;
      }
    }
    await deps.rpc("_br_v3_export_release", { p_archive_id: id, p_token: token });
    res.status = status;
    return res;
  } catch (e) {
    if ((e as Error)?.name === "SimulatedCrash") throw e;
    const code = errCode(e);
    res.error_code = code;
    if (isLeaseLoss(code)) {
      res.outcome = "lease_lost";
      return res;
    }
    const permanent = e instanceof IntegrityError;
    try {
      const f = await deps.rpc("_br_v3_export_fail", {
        p_archive_id: id, p_token: token, p_code: code,
        p_message: String((e as Error)?.message ?? e).slice(0, 500), p_permanent: permanent,
      });
      res.outcome = f.status === "failed" ? "failed" : "error";
      res.status = f.status;
    } catch {
      res.outcome = "lease_lost";
    }
    return res;
  }
}

export function webdavStore(baseUrl: string, username: string, password: string): RemoteStore {
  const base = baseUrl.replace(/\/+$/, "");
  const auth = "Basic " + btoa(`${username}:${password}`);
  return {
    async put(path, bytes) {
      let cur = "";
      for (const s of path.split("/").filter(Boolean).slice(0, -1)) {
        cur += "/" + s;
        const r = await fetch(`${base}${cur}`, { method: "MKCOL", headers: { Authorization: auth } });
        await r.body?.cancel();
        if (!(r.ok || [301, 405, 409].includes(r.status))) throw new Error(`offsite MKCOL failed: ${r.status}`);
      }
      const r = await fetch(`${base}/${path}`, {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(`offsite PUT failed: ${r.status}`);
    },
    async get(path) {
      const r = await fetch(`${base}/${path}`, { headers: { Authorization: auth } });
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error(`offsite GET failed: ${r.status}`);
      }
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export interface OffsiteDeps {
  rpc: Rpc;
  store: ObjectStore;
  remote: RemoteStore;
  checkpoint?: (point: string, info?: Record<string, unknown>) => Promise<void> | void;
}

export interface OffsiteResult {
  outcome: "idle" | "progress" | "confirmed" | "failed" | "error" | "lease_lost";
  transfer_id?: string;
  items: number;
  error_code?: string;
}

// Copie hors site : un objet à la fois, relu à distance et comparé avant validation ; manifeste en dernier.
export async function runOffsiteInvocation(
  deps: OffsiteDeps, workerId: string, maxItems: number,
): Promise<OffsiteResult> {
  const cp = deps.checkpoint ?? (() => {});
  const res: OffsiteResult = { outcome: "idle", items: 0 };
  const c = await deps.rpc("_br_v3_offsite_claim", { p_worker_id: workerId, p_lease_seconds: 300 });
  if (!c) return res;
  res.transfer_id = c.transfer_id;
  if (c.status === "failed") {
    res.outcome = "failed";
    return res;
  }
  res.outcome = "progress";
  const tid = c.transfer_id;
  const token = c.lease_token;
  try {
    for (let i = 0; i < maxItems; i++) {
      const it = await deps.rpc("_br_v3_offsite_next", { p_transfer_id: tid, p_token: token });
      if (it.kind === "done") break;
      const bytes = await deps.store.get(it.object_path);
      if ((await sha256hex(bytes)) !== it.stored_sha256) {
        throw new IntegrityError("BRV-053", "primary object differs from its record");
      }
      await deps.remote.put(it.remote_path, bytes);
      await cp("offsite_after_put", { kind: it.kind, block_no: it.block_no });
      const back = await deps.remote.get(it.remote_path);
      const r = await deps.rpc("_br_v3_offsite_commit", {
        p_transfer_id: tid, p_token: token,
        p_item: { kind: it.kind, block_no: it.block_no, remote_sha256: await sha256hex(back), remote_bytes: back.length },
      });
      res.items++;
      if (r.status === "confirmed") {
        res.outcome = "confirmed";
        return res;
      }
    }
    await deps.rpc("_br_v3_offsite_fail", {
      p_transfer_id: tid, p_token: token, p_code: "YIELD", p_message: "invocation budget reached", p_permanent: false,
    });
    return res;
  } catch (e) {
    if ((e as Error)?.name === "SimulatedCrash") throw e;
    const code = errCode(e);
    res.error_code = code;
    if (isLeaseLoss(code)) {
      res.outcome = "lease_lost";
      return res;
    }
    try {
      const f = await deps.rpc("_br_v3_offsite_fail", {
        p_transfer_id: tid, p_token: token, p_code: code,
        p_message: String((e as Error)?.message ?? e).slice(0, 500), p_permanent: e instanceof IntegrityError,
      });
      res.outcome = f.status === "failed" ? "failed" : "error";
    } catch {
      res.outcome = "lease_lost";
    }
    return res;
  }
}

// ===== Lot D : lecture v3 pour restauration (inactive tant que _br_restore_config.enabled = false) =====
export interface RestoreLoadDeps {
  rpc: Rpc;
  store: ObjectStore;
  keyring: KeyRing;
  checkpoint?: (point: string, info?: Record<string, unknown>) => Promise<void> | void;
}

export interface RestoreLoadResult {
  outcome: "progress" | "prepared" | "failed" | "lease_lost" | "error";
  job_id: string;
  blocks_loaded: number;
  remaining?: number;
  error_code?: string;
}

// Un bloc à la fois en mémoire ; les lignes restent des chaînes produites par PostgreSQL (jamais JSON.parse).
export async function runRestoreLoadInvocation(
  deps: RestoreLoadDeps,
  jobId: string,
  workerId: string,
  maxBlocks = 20,
): Promise<RestoreLoadResult> {
  const { rpc, store, keyring } = deps;
  const cp = async (p: string, i?: Record<string, unknown>) => {
    if (deps.checkpoint) await deps.checkpoint(p, i);
  };
  const res: RestoreLoadResult = { outcome: "progress", job_id: jobId, blocks_loaded: 0 };
  const claim = await rpc("_br_rs_claim", { p_job: jobId, p_worker: workerId });
  const token = String(claim.token);
  let released = false;
  const fail = async (code: string, message: string) => {
    released = true;
    await rpc("_br_rs_fail_job", { p_job: jobId, p_token: token, p_code: code, p_message: message });
    res.outcome = "failed";
    res.error_code = code;
  };
  try {
    let plan = await rpc("_br_rs_v3_plan", { p_job: jobId, p_token: token, p_limit: maxBlocks });
    if (plan.status === "failed") {
      released = true;
      return { ...res, outcome: "failed", error_code: plan.error_code };
    }
    const a = plan.archive;
    if (!plan.manifest_ok) {
      const stored = await store.get(String(a.manifest_path));
      const binding: Binding = {
        kind: "manifest", tenant_id: a.tenant_id, archive_id: a.id, generation_id: a.generation_id, block_no: 0,
        key_id: a.key_id,
      };
      let plainSha: string;
      try {
        const { plain } = await open(stored, binding, keyring, MANIFEST_PLAIN_MAX);
        plainSha = await sha256hex(plain);
      } catch (e) {
        if (e instanceof IntegrityError) {
          await fail("BRR-041", e.message);
          return res;
        }
        throw e;
      }
      const m = await rpc("_br_rs_v3_manifest", {
        p_job: jobId, p_token: token, p_stored_sha256: await sha256hex(stored), p_plain_sha256: plainSha,
      });
      if (m.status === "failed") {
        released = true;
        return { ...res, outcome: "failed", error_code: m.error_code };
      }
      await cp("manifest_ok");
    }
    while (true) {
      const blocks = plan.blocks as Array<Record<string, any>>;
      for (const b of blocks) {
        if (res.blocks_loaded >= maxBlocks) break;
        const stored = await store.get(String(b.object_path));
        const binding: Binding = {
          kind: "block", tenant_id: a.tenant_id, archive_id: a.id, generation_id: a.generation_id,
          block_no: Number(b.block_no), key_id: String(b.key_id),
        };
        let lines: string[];
        try {
          const { plain } = await open(stored, binding, keyring, Number(b.plain_bytes) + 1);
          const { header, rows } = splitBlock(plain);
          if (header.table !== b.table || rows !== Number(b.rows)) throw new IntegrityError("BRR-045", "block header mismatch");
          lines = rowLines(plain);
        } catch (e) {
          if (e instanceof IntegrityError) {
            await fail("BRR-045", `block ${b.block_no}: ${e.message}`);
            return res;
          }
          throw e;
        }
        const r = await rpc("_br_rs_v3_load_block", {
          p_job: jobId, p_token: token, p_block_no: Number(b.block_no), p_stored_sha256: await sha256hex(stored),
          p_lines: lines,
        });
        if (r.status === "failed") {
          released = true;
          return { ...res, outcome: "failed", error_code: r.error_code };
        }
        res.blocks_loaded++;
        await cp("block_loaded", { block_no: Number(b.block_no) });
      }
      if (res.blocks_loaded >= maxBlocks) break;
      plan = await rpc("_br_rs_v3_plan", { p_job: jobId, p_token: token, p_limit: maxBlocks });
      if (Number(plan.remaining) === 0) break;
    }
    if (Number(plan.remaining) === 0) {
      const v = await rpc("_br_rs_verify", { p_job: jobId, p_token: token });
      released = v.status !== "prepared";
      res.outcome = v.status === "prepared" ? "prepared" : "failed";
      if (v.status !== "prepared") res.error_code = v.error_code;
    } else {
      res.remaining = Number(plan.remaining);
    }
    return res;
  } catch (e) {
    const code = errCode(e);
    if (code === "BRR-061" || code === "BRR-003") {
      released = true;
      res.outcome = "lease_lost";
    } else {
      res.outcome = "error";
    }
    res.error_code = code;
    return res;
  } finally {
    if (!released) await rpc("_br_rs_unlease", { p_job: jobId, p_token: token }).catch(() => {});
  }
}

// ===== Lot E : actions serveur de restauration v3 et de réinitialisation globales (tous les magasins) =====
export interface RestoreActionCaller {
  actor: string | null;
  cron: boolean;
}

export interface RestoreActionResult {
  status: number;
  body: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RESTORE_ACTIONS = [
  "restore_request", "restore_load", "restore_safety", "restore_execute", "restore_status", "restore_abandon",
] as const;

function apiCode(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if ((e as { code?: string })?.code === "BR020" || msg.includes("temporairement indisponible")) return "BR-020";
  return errCode(e);
}

function apiError(code: string): RestoreActionResult {
  const status = code === "BRR-403" ? 403 : code === "BRR-404" ? 404 : code === "WORKER_ERROR" ? 500 : 409;
  const error = code === "BR-020"
    ? "Cette opération est temporairement indisponible pendant la sécurisation du système de sauvegarde."
    : status === 403 ? "Accès refusé" : status === 404 ? "Introuvable" : status === 500 ? "Erreur interne"
    : "Opération refusée";
  return { status, body: { error, code } };
}

// Le tenant n'est jamais lu dans la requête : il est déduit côté base du profil de l'acteur authentifié.
export async function runRestoreAction(
  deps: RestoreLoadDeps,
  caller: RestoreActionCaller,
  action: string,
  body: Record<string, unknown>,
  workerId: string,
  maxBlocks = 20,
): Promise<RestoreActionResult> {
  const { rpc } = deps;
  const jobArg = body.job_id == null ? null : String(body.job_id);
  if (jobArg !== null && !UUID_RE.test(jobArg)) return apiError("BRR-404");
  try {
    if (action === "restore_load" && caller.cron && !caller.actor) {
      const next = await rpc("_br_rs_api_next_v3_load", {});
      if (!next) return { status: 200, body: { outcome: "idle" } };
      const r = await runRestoreLoadInvocation(deps, String(next), workerId, maxBlocks);
      return { status: 200, body: { ...r } };
    }
    if (!caller.actor) return apiError("BRR-403");
    const actor = caller.actor;

    if (action === "restore_request") {
      const op = String(body.operation ?? "");
      if (op !== "reset" && op !== "restore_v3") return apiError("BRR-010");
      const archive = body.archive_id == null ? null : String(body.archive_id);
      if (op === "restore_v3" && (!archive || !UUID_RE.test(archive))) return apiError("BRR-404");
      const r = await rpc("_br_rs_api_request", { p_actor: actor, p_operation: op, p_archive: archive });
      return { status: 200, body: { ...r, scope: "all_sites" } };
    }
    if (action === "restore_status") {
      const r = await rpc("_br_rs_api_status", { p_actor: actor, p_job: jobArg });
      return { status: 200, body: r };
    }
    if (!jobArg) return apiError("BRR-404");
    if (action === "restore_load") {
      const s = await rpc("_br_rs_api_status", { p_actor: actor, p_job: jobArg });
      if (s?.job?.id !== jobArg) return apiError("BRR-404");
      const r = await runRestoreLoadInvocation(deps, jobArg, workerId, maxBlocks);
      return { status: 200, body: { ...r } };
    }
    if (action === "restore_safety") {
      const r = await rpc("_br_rs_api_request_safety", { p_actor: actor, p_job: jobArg });
      return { status: 200, body: { job_id: jobArg, capture: r } };
    }
    if (action === "restore_execute") {
      const r = await rpc("_br_rs_api_execute", { p_actor: actor, p_job: jobArg });
      return { status: 202, body: { ...r, scope: "all_sites", awaiting: "server_executor" } };
    }
    if (action === "restore_abandon") {
      const r = await rpc("_br_rs_api_abandon", { p_actor: actor, p_job: jobArg });
      return { status: 200, body: r };
    }
    return { status: 400, body: { error: "Unknown action" } };
  } catch (e) {
    return apiError(apiCode(e));
  }
}
