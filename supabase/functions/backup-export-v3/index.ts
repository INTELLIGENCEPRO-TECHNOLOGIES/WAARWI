import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  importAesKey,
  type KeyRing,
  type ObjectStore,
  type Rpc,
  RESTORE_ACTIONS,
  runExportInvocation,
  runOffsiteInvocation,
  runRestoreAction,
  webdavStore,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "tenant-backups-v3";
// BR020 : routage restauration/réinitialisation/import fermé côté Edge tant que le lot E n'est pas activé.
const RESTORE_ROUTING_ENABLED = false;

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Clé courante + clés historiques (BACKUP_ENCRYPTION_KEYRING_JSON = {"key_id":"base64",...}).
async function loadKeyRing(): Promise<KeyRing> {
  const kid = Deno.env.get("BACKUP_ENCRYPTION_KEY_ID");
  const b64 = Deno.env.get("BACKUP_ENCRYPTION_KEY_B64");
  if (!kid || !b64) throw new Error("Encryption key not configured");
  const keys = new Map<string, CryptoKey>();
  const extra = Deno.env.get("BACKUP_ENCRYPTION_KEYRING_JSON");
  if (extra) {
    for (const [id, v] of Object.entries(JSON.parse(extra) as Record<string, string>)) {
      keys.set(id, await importAesKey(b64ToBytes(v)));
    }
  }
  keys.set(kid, await importAesKey(b64ToBytes(b64)));
  return { currentId: kid, keys };
}

function rpcOf(client: ReturnType<typeof createClient>) {
  return async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
}

function storeOf(client: ReturnType<typeof createClient>): ObjectStore {
  return {
    async put(path, bytes) {
      const { error } = await client.storage.from(BUCKET).upload(path, bytes, {
        upsert: false,
        contentType: "application/octet-stream",
      });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async get(path) {
      const { data, error } = await client.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error("storage object not found");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

function webdavOf() {
  const url = Deno.env.get("LWS_WEBDAV_URL");
  const user = Deno.env.get("LWS_WEBDAV_USERNAME");
  const pass = Deno.env.get("LWS_WEBDAV_PASSWORD");
  if (!url || !user || !pass) throw new Error("Offsite storage not configured");
  return webdavStore(url, user, pass);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    async function isSuperAdmin(): Promise<boolean> {
      if (!token) return false;
      const { data: u, error } = await admin.auth.getUser(token);
      if (error || !u.user) return false;
      const { data: p } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      return p?.role === "super_admin";
    }

    function isCron(): boolean {
      const secret = Deno.env.get("BACKUP_V3_CRON_SECRET");
      const provided = req.headers.get("X-Cron-Secret");
      return !!(secret && provided && secret === provided);
    }

    // Autorisation propriétaire/super_admin évaluée en base avec l'identité de l'appelant.
    async function authorizeDownload(archiveId: string) {
      if (!token) return null;
      const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data, error } = await user.rpc("br_v3_download_authorize", { p_archive_id: archiveId });
      if (error || !data) return null;
      return data;
    }

    if (action === "run_export" || action === "run_offsite") {
      if (!isCron() && !(await isSuperAdmin())) return json({ error: "Forbidden" }, 403);
      const { data: cfg } = await admin.from("_br_v3_export_config").select("enabled, offsite_enabled").eq("id", 1)
        .maybeSingle();
      const enabled = action === "run_export" ? cfg?.enabled : cfg?.offsite_enabled;
      if (!enabled) return json({ error: "v3 export is disabled", code: "BRV-045" }, 409);
      const workerId = `edge-${crypto.randomUUID()}`;
      if (action === "run_export") {
        const r = await runExportInvocation({ rpc: rpcOf(admin), store: storeOf(admin), keyring: await loadKeyRing() },
          workerId);
        return json({ outcome: r.outcome, archive_id: r.archive_id, status: r.status, error_code: r.error_code,
          blocks_written: r.blocks_written, blocks_verified: r.blocks_verified });
      }
      const r = await runOffsiteInvocation({ rpc: rpcOf(admin), store: storeOf(admin), remote: webdavOf() }, workerId,
        64);
      return json({ outcome: r.outcome, transfer_id: r.transfer_id, items: r.items, error_code: r.error_code });
    }

    // Essai manuel ciblé : seul le travail d'essai autorisé en base peut être réclamé.
    if (action === "run_trial_export") {
      const provided = req.headers.get("X-Trial-Token") ?? "";
      if (!/^[0-9a-f]{64}$/.test(provided)) return json({ error: "Forbidden" }, 403);
      const { data: ok, error: okErr } = await admin.rpc("_br_v3_mt_runner_ok", { p_token: provided });
      if (okErr || ok !== true) return json({ error: "Forbidden" }, 403);
      const base = rpcOf(admin);
      const rpc: Rpc = (fn, args) => base(fn === "_br_v3_export_claim" ? "_br_v3_mt_export_claim" : fn, args);
      const deps = { rpc, store: storeOf(admin), keyring: await loadKeyRing() };
      const t0 = Date.now();
      let runs = 0;
      let r: Awaited<ReturnType<typeof runExportInvocation>>;
      do {
        r = await runExportInvocation(deps, `edge-trial-${crypto.randomUUID()}`);
        runs++;
      } while (r.outcome === "progress" && runs < 6 && Date.now() - t0 < 60_000);
      return json({ outcome: r.outcome, status: r.status, error_code: r.error_code, runs });
    }

    if (action === "download_list" || action === "download_entry") {
      const archiveId = String(body.archive_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(archiveId)) return json({ error: "Sauvegarde introuvable" }, 404);
      const auth = await authorizeDownload(archiveId);
      if (!auth) return json({ error: "Sauvegarde introuvable" }, 404);

      if (action === "download_list") {
        const offset = Math.max(0, Number.parseInt(String(body.offset ?? 0), 10) || 0);
        const { data, error } = await admin.rpc("_br_v3_download_entries", {
          p_archive_id: archiveId, p_offset: offset, p_limit: 500,
        });
        if (error || !data) return json({ error: "Sauvegarde introuvable" }, 404);
        return json({
          archive_id: archiveId,
          format_version: 3,
          restorable: false,
          packaging: "folder: waarwi-v3-<archive_id>/{manifest.wbr3m, blocks/NNNNNN.wbr3}",
          total: data.total,
          entries: (data.entries as Array<Record<string, unknown>>).map((e, i) => ({
            n: offset + i, kind: e.kind, name: e.name, stored_bytes: e.stored_bytes, stored_sha256: e.stored_sha256,
          })),
        });
      }

      const n = Number.parseInt(String(body.n ?? ""), 10);
      if (!Number.isInteger(n) || n < 0) return json({ error: "Entrée invalide" }, 400);
      const { data, error } = await admin.rpc("_br_v3_download_entries", {
        p_archive_id: archiveId, p_offset: n, p_limit: 1,
      });
      const entry = data?.entries?.[0];
      if (error || !entry) return json({ error: "Entrée introuvable" }, 404);
      const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(entry.object_path);
      if (dlErr || !blob) return json({ error: "Objet indisponible" }, 502);
      return new Response(blob.stream(), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/octet-stream",
          "X-Entry-Name": String(entry.name),
          "X-Entry-Sha256": String(entry.stored_sha256),
        },
      });
    }

    if ((RESTORE_ACTIONS as readonly string[]).includes(action)) {
      if (!RESTORE_ROUTING_ENABLED) {
        return json({ error: "Cette opération est temporairement indisponible", code: "BR-020" }, 423);
      }
      let actor: string | null = null;
      if (token) {
        const { data: u, error } = await admin.auth.getUser(token);
        if (!error && u.user) actor = u.user.id;
      }
      const cron = isCron();
      if (!actor && !(cron && action === "restore_load")) return json({ error: "Forbidden" }, 403);
      const r = await runRestoreAction(
        { rpc: rpcOf(admin), store: storeOf(admin), keyring: await loadKeyRing() },
        { actor, cron },
        action,
        body,
        `edge-${crypto.randomUUID()}`,
      );
      return json(r.body, r.status);
    }

    if (action === "status") {
      if (!(await isSuperAdmin())) return json({ error: "Forbidden" }, 403);
      const { data: cfg } = await admin.from("_br_v3_export_config").select("enabled, offsite_enabled").eq("id", 1)
        .maybeSingle();
      return json({
        export_enabled: !!cfg?.enabled,
        offsite_enabled: !!cfg?.offsite_enabled,
        key_configured: !!Deno.env.get("BACKUP_ENCRYPTION_KEY_B64") && !!Deno.env.get("BACKUP_ENCRYPTION_KEY_ID"),
        cron_secret_configured: !!Deno.env.get("BACKUP_V3_CRON_SECRET"),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("backup-export-v3 error:", e instanceof Error ? e.message.slice(0, 300) : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});
