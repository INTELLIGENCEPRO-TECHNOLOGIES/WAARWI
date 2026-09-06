import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CONTAINER_VERSION = 1;
const ALGO = "AES-256-GCM";
const STALE_UPLOADING_MINUTES = 15;

// ---- Crypto helpers ----

function getEncryptionKeyBytes(): Uint8Array {
  const b64 = Deno.env.get("BACKUP_ENCRYPTION_KEY_B64");
  if (!b64) throw new Error("BACKUP_ENCRYPTION_KEY_B64 not configured");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (raw.length !== 32)
    throw new Error("Encryption key must be exactly 32 bytes");
  return raw;
}

function getKeyId(): string {
  const kid = Deno.env.get("BACKUP_ENCRYPTION_KEY_ID");
  if (!kid) throw new Error("BACKUP_ENCRYPTION_KEY_ID not configured");
  return kid;
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptPayload(
  plaintext: Uint8Array,
  key: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return { ciphertext, iv };
}

async function decryptPayload(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
  );
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- Compression helpers ----

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// ---- Container format ----

interface ContainerHeader {
  container_version: number;
  algorithm: string;
  key_id: string;
  iv_hex: string;
}

function buildContainer(
  header: ContainerHeader,
  ciphertext: Uint8Array,
): Uint8Array {
  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);
  const headerLen = new Uint8Array(4);
  new DataView(headerLen.buffer).setUint32(0, headerBytes.length, false);
  const result = new Uint8Array(4 + headerBytes.length + ciphertext.length);
  result.set(headerLen, 0);
  result.set(headerBytes, 4);
  result.set(ciphertext, 4 + headerBytes.length);
  return result;
}

function parseContainer(
  data: Uint8Array,
): { header: ContainerHeader; ciphertext: Uint8Array } {
  const headerLen = new DataView(data.buffer, data.byteOffset).getUint32(
    0,
    false,
  );
  const headerBytes = data.slice(4, 4 + headerLen);
  const header = JSON.parse(
    new TextDecoder().decode(headerBytes),
  ) as ContainerHeader;
  const ciphertext = data.slice(4 + headerLen);
  return { header, ciphertext };
}

// ---- WebDAV helpers ----

function getWebDavCredentials() {
  const url = Deno.env.get("LWS_WEBDAV_URL");
  const username = Deno.env.get("LWS_WEBDAV_USERNAME");
  const password = Deno.env.get("LWS_WEBDAV_PASSWORD");
  if (!url || !username || !password)
    throw new Error("LWS WebDAV credentials not configured");
  return { url, username, password };
}

function mkAuthHeader(username: string, password: string): string {
  return "Basic " + btoa(`${username}:${password}`);
}

async function webdavMkcol(
  baseUrl: string,
  path: string,
  auth: string,
): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  let current = "";
  for (const seg of segments) {
    current += "/" + seg;
    const res = await fetch(`${baseUrl}${current}`, {
      method: "MKCOL",
      headers: { Authorization: auth },
    });
    // 201 = created, 405 = already exists — both are fine
    if (res.ok || res.status === 405) continue;
    const body = await res.text().catch(() => "");
    // 301 redirect or 409 parent-missing are tolerable during recursive creation
    if (res.status === 301 || res.status === 409) continue;
    throw new Error(
      `MKCOL ${current} failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
    );
  }
}

async function webdavPut(
  baseUrl: string,
  path: string,
  data: Uint8Array,
  auth: string,
): Promise<{ ok: boolean; status: number; statusText: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(data.length),
    },
    body: data,
  });
  return { ok: res.ok, status: res.status, statusText: res.statusText };
}

async function webdavGet(
  baseUrl: string,
  path: string,
  auth: string,
): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new Error(`WebDAV GET ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function webdavDelete(
  baseUrl: string,
  path: string,
  auth: string,
): Promise<boolean> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  return res.ok || res.status === 404;
}

async function webdavHead(
  baseUrl: string,
  path: string,
  auth: string,
): Promise<boolean> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "HEAD",
    headers: { Authorization: auth },
  });
  return res.ok;
}

// ---- Build remote path ----

function buildRemotePath(
  rootFolder: string,
  tenantId: string,
  backupId: string,
  createdAt: string,
): { dirPath: string; filePath: string } {
  const d = new Date(createdAt);
  const year = d.getUTCFullYear().toString();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const dirPath = `${rootFolder}/${tenantId}/${year}/${month}`;
  const filePath = `${dirPath}/${day}_${backupId}.waarwi.enc`;
  return { dirPath, filePath };
}

// ---- Main ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    const authHeaderVal = req.headers.get("Authorization") || "";
    const authToken = authHeaderVal.replace("Bearer ", "");

    async function requireSuperAdmin(): Promise<string> {
      if (!authToken) throw new Error("Unauthorized");
      const { data: u, error } = await admin.auth.getUser(authToken);
      if (error || !u.user) throw new Error("Unauthorized");
      const { data: p } = await admin
        .from("profiles")
        .select("role")
        .eq("id", u.user.id)
        .maybeSingle();
      if (!p || p.role !== "super_admin") throw new Error("Forbidden");
      return u.user.id;
    }

    function requireCronAuth(): boolean {
      const secret = Deno.env.get("OFFSITE_CRON_SECRET");
      const provided = req.headers.get("X-Cron-Secret");
      return !!(secret && provided && secret === provided);
    }

    // ============ GET CONFIG ============
    if (action === "get_config") {
      await requireSuperAdmin();
      const { data, error } = await admin
        .from("_br_offsite_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);

      let cronStatus: unknown = { exists: false, active: false, error: null };
      try {
        const { data: cs, error: csErr } = await admin.rpc("_br_manage_offsite_cron", {
          p_action: "status",
        });
        if (csErr) {
          cronStatus = { exists: false, active: false, error: csErr.message };
        } else if (cs) {
          cronStatus = cs;
        }
      } catch (e: unknown) {
        cronStatus = { exists: false, active: false, error: e instanceof Error ? e.message : "pg_cron unavailable" };
      }

      const secretsConfigured = {
        LWS_WEBDAV_URL: !!Deno.env.get("LWS_WEBDAV_URL"),
        LWS_WEBDAV_USERNAME: !!Deno.env.get("LWS_WEBDAV_USERNAME"),
        LWS_WEBDAV_PASSWORD: !!Deno.env.get("LWS_WEBDAV_PASSWORD"),
        BACKUP_ENCRYPTION_KEY_B64: !!Deno.env.get("BACKUP_ENCRYPTION_KEY_B64"),
        BACKUP_ENCRYPTION_KEY_ID: !!Deno.env.get("BACKUP_ENCRYPTION_KEY_ID"),
        OFFSITE_CRON_SECRET: !!Deno.env.get("OFFSITE_CRON_SECRET"),
      };

      return json({
        config: data,
        cron_status: cronStatus,
        secrets_configured: secretsConfigured,
      });
    }

    // ============ UPDATE CONFIG ============
    if (action === "update_config") {
      const userId = await requireSuperAdmin();
      const { enabled, auto_transfer, root_folder } = body;
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: userId,
      };
      if (enabled !== undefined) patch.enabled = enabled;
      if (auto_transfer !== undefined) patch.auto_transfer = auto_transfer;
      if (root_folder !== undefined) patch.root_folder = root_folder;

      if (enabled === true) {
        const requiredSecrets = [
          "LWS_WEBDAV_URL", "LWS_WEBDAV_USERNAME", "LWS_WEBDAV_PASSWORD",
          "BACKUP_ENCRYPTION_KEY_B64", "BACKUP_ENCRYPTION_KEY_ID", "OFFSITE_CRON_SECRET",
        ];
        const missing = requiredSecrets.filter((s) => !Deno.env.get(s));
        if (missing.length > 0)
          return json({ error: `Cannot enable: missing secrets: ${missing.join(", ")}` }, 400);
        try {
          const keyBytes = getEncryptionKeyBytes();
          if (keyBytes.length !== 32)
            return json({ error: `Encryption key must be 32 bytes, got ${keyBytes.length}` }, 400);
          getKeyId();
        } catch (e: unknown) {
          return json({ error: `Encryption key validation failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
        }
      }

      const { error } = await admin
        .from("_br_offsite_config")
        .update(patch)
        .eq("id", 1);
      if (error) return json({ error: error.message }, 400);

      if (enabled !== undefined) {
        const offsiteCronSecret = Deno.env.get("OFFSITE_CRON_SECRET");
        if (enabled && offsiteCronSecret) {
          const fnUrl = `${SUPABASE_URL}/functions/v1/backup-offsite`;
          const { data: cronRes, error: cronErr } = await admin.rpc("_br_manage_offsite_cron", {
            p_action: "upsert",
            p_function_url: fnUrl,
            p_cron_secret: offsiteCronSecret,
          });
          if (cronErr || cronRes?.success !== true) {
            await admin.from("_br_offsite_config").update({ enabled: false }).eq("id", 1);
            return json({ error: `Cron upsert failed: ${cronErr?.message || "RPC returned success=false"}` }, 500);
          }
        } else if (!enabled) {
          const { data: cronRes, error: cronErr } = await admin.rpc("_br_manage_offsite_cron", { p_action: "remove" });
          if (cronErr || (cronRes && cronRes.success !== true)) {
            return json({ error: `Cron remove failed: ${cronErr?.message || "RPC returned success=false"}` }, 500);
          }
        }
      }

      return json({ success: true });
    }

    // ============ TEST CONNECTION ============
    if (action === "test_connection") {
      await requireSuperAdmin();
      try {
        const webdavUrl = Deno.env.get("LWS_WEBDAV_URL");
        const webdavUser = Deno.env.get("LWS_WEBDAV_USERNAME");
        const webdavPass = Deno.env.get("LWS_WEBDAV_PASSWORD");
        if (!webdavUrl || !webdavUser || !webdavPass)
          return json({ error: "Les 3 secrets WebDAV (URL, Username, Password) doivent être configurés" }, 400);
        const creds = getWebDavCredentials();
        const auth = mkAuthHeader(creds.username, creds.password);
        const probePath = "/Waarwi/.health";
        const probeFile = `${probePath}/.probe_${Date.now()}`;
        const probeData = new TextEncoder().encode(`probe-${Date.now()}`);

        await webdavMkcol(creds.url, probePath, auth);
        const putRes = await webdavPut(creds.url, probeFile, probeData, auth);
        if (!putRes.ok) {
          return json({
            success: false,
            error: `PUT failed: ${putRes.status} ${putRes.statusText}`,
          });
        }

        const downloaded = await webdavGet(creds.url, probeFile, auth);
        const match =
          new TextDecoder().decode(downloaded) ===
          new TextDecoder().decode(probeData);

        await webdavDelete(creds.url, probeFile, auth);

        return json({
          success: match,
          error: match ? null : "Downloaded probe content does not match",
        });
      } catch (e: unknown) {
        return json({
          success: false,
          error: e instanceof Error ? e.message : "Connection test failed",
        });
      }
    }

    // ============ QUEUE TRANSFER (idempotent) ============
    if (action === "queue_transfer") {
      const userId = await requireSuperAdmin();
      const { backup_id } = body;
      if (!backup_id) return json({ error: "backup_id required" }, 400);

      // Check if already queued by source_backup_id
      const { data: existing, error: exErr } = await admin
        .from("_br_offsite_transfers")
        .select("id, status")
        .eq("source_backup_id", backup_id)
        .maybeSingle();
      if (exErr) return json({ error: exErr.message }, 500);
      if (existing) {
        return json({
          success: true,
          already_exists: true,
          transfer_id: existing.id,
          status: existing.status,
        });
      }

      const { data: backup, error: bErr } = await admin
        .from("tenant_backups")
        .select("id, tenant_id, status, created_at")
        .eq("id", backup_id)
        .maybeSingle();
      if (bErr) return json({ error: bErr.message }, 500);
      if (!backup) return json({ error: "Backup not found" }, 404);
      if (backup.status !== "verified")
        return json({ error: "Only verified backups can be transferred" }, 400);

      const { data: cfg } = await admin
        .from("_br_offsite_config")
        .select("root_folder")
        .eq("id", 1)
        .maybeSingle();

      const rootFolder = cfg?.root_folder || "/Waarwi";
      const { filePath } = buildRemotePath(
        rootFolder,
        backup.tenant_id,
        backup.id,
        backup.created_at,
      );

      const { data: inserted, error: insertErr } = await admin
        .from("_br_offsite_transfers")
        .insert({
          source_backup_id: backup.id,
          backup_id: backup.id,
          tenant_id: backup.tenant_id,
          remote_path: filePath,
          status: "queued",
          created_by: userId,
        })
        .select("id")
        .maybeSingle();

      if (insertErr) {
        if (
          insertErr.message.includes("duplicate") ||
          insertErr.message.includes("unique")
        )
          return json({
            success: true,
            already_exists: true,
            message: "Transfer already queued",
          });
        return json({ error: insertErr.message }, 500);
      }

      return json({
        success: true,
        transfer_id: inserted?.id,
        remote_path: filePath,
      });
    }

    // ============ PROCESS QUEUE ============
    if (action === "process_queue") {
      const isCron = requireCronAuth();
      if (!isCron) await requireSuperAdmin();

      const { data: cfg } = await admin
        .from("_br_offsite_config")
        .select("enabled, root_folder")
        .eq("id", 1)
        .maybeSingle();

      if (!cfg?.enabled)
        return json({ skipped: true, reason: "Offsite disabled" });

      // Release stale uploading transfers
      const staleThreshold = new Date(
        Date.now() - STALE_UPLOADING_MINUTES * 60_000,
      ).toISOString();
      const { error: staleErr } = await admin
        .from("_br_offsite_transfers")
        .update({
          status: "failed",
          error_message: "Timeout: upload interrupted",
        })
        .eq("status", "uploading")
        .lt("started_at", staleThreshold);
      if (staleErr)
        return json({ error: `Stale release: ${staleErr.message}` }, 500);

      // Fetch candidates
      const { data: pending, error: pErr } = await admin
        .from("_br_offsite_transfers")
        .select("id, source_backup_id, backup_id, tenant_id, remote_path, attempts, status")
        .in("status", ["queued", "failed"])
        .lt("attempts", 3)
        .order("queued_at", { ascending: true })
        .limit(5);

      if (pErr) return json({ error: pErr.message }, 500);
      if (!pending || pending.length === 0)
        return json({ processed: 0, message: "No pending transfers" });

      let creds: { url: string; username: string; password: string };
      let encKey: CryptoKey;
      try {
        creds = getWebDavCredentials();
        encKey = await importKey(getEncryptionKeyBytes());
      } catch (e: unknown) {
        return json(
          { error: e instanceof Error ? e.message : "Config error" },
          500,
        );
      }
      const auth = mkAuthHeader(creds.username, creds.password);
      const keyId = getKeyId();

      const results: { id: string; status: string; error?: string }[] = [];

      for (const transfer of pending) {
        // Atomic claim: only update if still queued
        const { data: claimed, error: claimErr } = await admin
          .from("_br_offsite_transfers")
          .update({
            status: "uploading",
            started_at: new Date().toISOString(),
            attempts: transfer.attempts + 1,
          })
          .eq("id", transfer.id)
          .eq("status", transfer.status)
          .select("id")
          .maybeSingle();

        if (claimErr || !claimed) {
          results.push({
            id: transfer.id,
            status: "skipped",
            error: "Claimed by another worker",
          });
          continue;
        }

        try {
          // Use source_backup_id to find the backup (backup_id may be null after retention)
          const lookupId = transfer.backup_id || transfer.source_backup_id;

          // Export the document entirely in PostgreSQL to avoid JS numeric drift
          const { data: exportResult, error: exportErr } = await admin.rpc(
            "_br_export_offsite_document_text",
            { p_backup_id: lookupId },
          );

          if (exportErr) throw new Error(`Export backup: ${exportErr.message}`);
          if (!exportResult) throw new Error("Export returned empty document");

          // exportResult is the document as a plain string — use it directly
          const documentText: string = exportResult as string;
          const documentBytes = new TextEncoder().encode(documentText);
          const compressed = await gzipCompress(documentBytes);
          const { ciphertext, iv } = await encryptPayload(compressed, encKey);

          const containerHeader: ContainerHeader = {
            container_version: CONTAINER_VERSION,
            algorithm: ALGO,
            key_id: keyId,
            iv_hex: Array.from(iv)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          };

          const container = buildContainer(containerHeader, ciphertext);
          const localChecksum = await sha256hex(container);

          const remotePath = transfer.remote_path!;
          const dirPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
          await webdavMkcol(creds.url, dirPath, auth);

          const putRes = await webdavPut(creds.url, remotePath, container, auth);
          if (!putRes.ok)
            throw new Error(
              `PUT failed: ${putRes.status} ${putRes.statusText}`,
            );

          // Download and verify
          const downloaded = await webdavGet(creds.url, remotePath, auth);
          const remoteChecksum = await sha256hex(downloaded);

          if (remoteChecksum !== localChecksum)
            throw new Error(
              `Checksum mismatch: local=${localChecksum} remote=${remoteChecksum}`,
            );

          const { error: verifyErr } = await admin
            .from("_br_offsite_transfers")
            .update({
              status: "verified",
              finished_at: new Date().toISOString(),
              verified_at: new Date().toISOString(),
              size_bytes: container.length,
              local_checksum: localChecksum,
              remote_checksum: remoteChecksum,
              error_message: null,
            })
            .eq("id", transfer.id);
          if (verifyErr)
            throw new Error(`Update verified: ${verifyErr.message}`);

          results.push({ id: transfer.id, status: "verified" });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          await admin
            .from("_br_offsite_transfers")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              error_message: msg,
            })
            .eq("id", transfer.id);
          results.push({ id: transfer.id, status: "failed", error: msg });
        }
      }

      return json({ processed: results.length, results });
    }

    // ============ RETRY TRANSFER ============
    if (action === "retry_transfer") {
      await requireSuperAdmin();
      const { transfer_id } = body;
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: updated, error } = await admin
        .from("_br_offsite_transfers")
        .update({
          status: "queued",
          attempts: 0,
          error_message: null,
          started_at: null,
          finished_at: null,
        })
        .eq("id", transfer_id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();

      if (error) return json({ error: error.message }, 500);
      if (!updated) return json({ error: "Transfer not found or not failed" }, 404);
      return json({ success: true });
    }

    // ============ VERIFY REMOTE ============
    if (action === "verify_remote") {
      await requireSuperAdmin();
      const { transfer_id } = body;
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: transfer, error: tErr } = await admin
        .from("_br_offsite_transfers")
        .select("id, remote_path, local_checksum, status")
        .eq("id", transfer_id)
        .maybeSingle();
      if (tErr) return json({ error: tErr.message }, 500);
      if (!transfer) return json({ error: "Transfer not found" }, 404);
      if (transfer.status !== "verified")
        return json({ error: "Transfer must be verified first" }, 400);

      try {
        const creds = getWebDavCredentials();
        const auth = mkAuthHeader(creds.username, creds.password);

        // Check file exists first
        const exists = await webdavHead(creds.url, transfer.remote_path, auth);
        if (!exists) {
          const { error: failErr } = await admin
            .from("_br_offsite_transfers")
            .update({
              status: "failed",
              error_message: "Remote file not found",
            })
            .eq("id", transfer.id);
          if (failErr)
            return json({ error: failErr.message }, 500);
          return json({
            verified: false,
            error: "Remote file not found",
          });
        }

        const downloaded = await webdavGet(creds.url, transfer.remote_path, auth);
        const remoteChecksum = await sha256hex(downloaded);
        const match = remoteChecksum === transfer.local_checksum;

        if (!match) {
          const { error: failErr } = await admin
            .from("_br_offsite_transfers")
            .update({
              status: "failed",
              error_message: `Checksum mismatch: expected=${transfer.local_checksum} got=${remoteChecksum}`,
            })
            .eq("id", transfer.id);
          if (failErr)
            return json({ error: failErr.message }, 500);
          return json({
            verified: false,
            remote_checksum: remoteChecksum,
            expected_checksum: transfer.local_checksum,
          });
        }

        // Checksum matches — refresh verified_at
        const { error: updErr } = await admin
          .from("_br_offsite_transfers")
          .update({
            remote_checksum: remoteChecksum,
            verified_at: new Date().toISOString(),
          })
          .eq("id", transfer.id);
        if (updErr) return json({ error: updErr.message }, 500);

        return json({
          verified: true,
          remote_checksum: remoteChecksum,
          expected_checksum: transfer.local_checksum,
        });
      } catch (e: unknown) {
        return json({
          verified: false,
          error: e instanceof Error ? e.message : "Verification failed",
        });
      }
    }

    // ============ RETRIEVE ============
    if (action === "retrieve") {
      await requireSuperAdmin();
      const { transfer_id } = body;
      if (!transfer_id) return json({ error: "transfer_id required" }, 400);

      const { data: transfer, error: tErr } = await admin
        .from("_br_offsite_transfers")
        .select("id, source_backup_id, backup_id, tenant_id, remote_path, local_checksum, status")
        .eq("id", transfer_id)
        .maybeSingle();
      if (tErr) return json({ error: tErr.message }, 500);
      if (!transfer) return json({ error: "Transfer not found" }, 404);
      if (transfer.status !== "verified")
        return json({ error: "Can only retrieve verified transfers" }, 400);

      try {
        const creds = getWebDavCredentials();
        const auth = mkAuthHeader(creds.username, creds.password);
        const encKey = await importKey(getEncryptionKeyBytes());

        const downloaded = await webdavGet(creds.url, transfer.remote_path, auth);

        const dlChecksum = await sha256hex(downloaded);
        if (transfer.local_checksum && dlChecksum !== transfer.local_checksum)
          throw new Error(
            `Checksum mismatch: expected=${transfer.local_checksum} got=${dlChecksum}`,
          );

        const { header, ciphertext } = parseContainer(downloaded);
        if (header.algorithm !== ALGO)
          throw new Error(`Unsupported algorithm: ${header.algorithm}`);

        const iv = new Uint8Array(
          (header.iv_hex.match(/.{2}/g) || []).map((h: string) =>
            parseInt(h, 16),
          ),
        );

        const compressed = await decryptPayload(ciphertext, iv, encKey);
        const documentBytes = await gzipDecompress(compressed);

        // Keep the exact text — never parse to JS object and re-stringify
        const documentText = new TextDecoder().decode(documentBytes);

        // Minimal validation before sending to PostgreSQL (without parsing payload)
        const docPeek = JSON.parse(documentText);
        if (docPeek.tenant_id !== transfer.tenant_id)
          throw new Error("Document tenant ID mismatch");
        if (docPeek.backup_id !== transfer.source_backup_id)
          throw new Error("Document backup_id does not match transfer source_backup_id");

        // Delegate all insertion/repair/checksum recalculation to PostgreSQL
        const { data: rehydrateResult, error: rehydrateErr } = await admin.rpc(
          "_br_rehydrate_offsite_backup",
          {
            p_transfer_id: transfer.id,
            p_document_text: documentText,
          },
        );

        if (rehydrateErr)
          throw new Error(`Rehydrate backup: ${rehydrateErr.message}`);

        const result = rehydrateResult as Record<string, unknown>;

        return json({
          success: true,
          message: result.action_taken === "recreated"
            ? "Backup retrieved and recreated locally"
            : result.action_taken === "repaired"
              ? "Existing backup repaired from remote"
              : "Local backup relinked",
          backup_id: result.backup_id,
          action_taken: result.action_taken,
          legacy_normalized: result.legacy_normalized || false,
          global_checksum: result.global_checksum,
        });
      } catch (e: unknown) {
        return json(
          {
            success: false,
            error: e instanceof Error ? e.message : "Retrieve failed",
          },
          500,
        );
      }
    }

    // ============ SUMMARY ============
    if (action === "summary") {
      await requireSuperAdmin();

      const { data: cfg } = await admin
        .from("_br_offsite_config")
        .select("enabled, auto_transfer, root_folder")
        .eq("id", 1)
        .maybeSingle();

      const { count: totalQueued } = await admin
        .from("_br_offsite_transfers")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");

      const { count: totalFailed } = await admin
        .from("_br_offsite_transfers")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed");

      const { count: totalVerified } = await admin
        .from("_br_offsite_transfers")
        .select("id", { count: "exact", head: true })
        .eq("status", "verified");

      // Sum size_bytes for verified
      const { data: sizeRows } = await admin
        .from("_br_offsite_transfers")
        .select("size_bytes")
        .eq("status", "verified");

      let totalSizeBytes = 0;
      if (sizeRows) {
        for (const r of sizeRows) totalSizeBytes += r.size_bytes || 0;
      }

      const secretsOk =
        !!Deno.env.get("LWS_WEBDAV_URL") &&
        !!Deno.env.get("LWS_WEBDAV_USERNAME") &&
        !!Deno.env.get("LWS_WEBDAV_PASSWORD") &&
        !!Deno.env.get("BACKUP_ENCRYPTION_KEY_B64") &&
        !!Deno.env.get("BACKUP_ENCRYPTION_KEY_ID") &&
        !!Deno.env.get("OFFSITE_CRON_SECRET");

      return json({
        config: cfg,
        secrets_configured: secretsOk,
        total_verified: totalVerified || 0,
        total_queued: totalQueued || 0,
        total_failed: totalFailed || 0,
        total_size_bytes: totalSizeBytes,
      });
    }

    // ============ LIST TRANSFERS ============
    if (action === "list_transfers") {
      await requireSuperAdmin();
      const { tenant_id, status: filterStatus, limit: lim } = body;
      let query = admin
        .from("_br_offsite_transfers")
        .select("*, tenants(name)")
        .order("queued_at", { ascending: false })
        .limit(lim || 30);

      if (tenant_id) query = query.eq("tenant_id", tenant_id);
      if (filterStatus) query = query.eq("status", filterStatus);

      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ transfers: data || [] });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    if (message === "Unauthorized")
      return json({ error: "Unauthorized" }, 401);
    if (message === "Forbidden") return json({ error: "Forbidden" }, 403);
    return json({ error: message }, 500);
  }
});
