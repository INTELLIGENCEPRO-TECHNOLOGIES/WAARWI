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

const MAX_RETRIES = 3;
const CENTRALIZED_KINDS = ["auto", "platform_manual"];

async function backupTenantWithRetry(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  label: string,
  kind: string,
): Promise<{ backup_id?: string; size_bytes?: number; total_rows?: number }> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { data, error } = await admin.rpc("_br_create_backup_for_tenant", {
      p_tenant_id: tenantId,
      p_label: label,
      p_kind: kind,
    });
    if (!error) {
      return data as {
        backup_id?: string;
        size_bytes?: number;
        total_rows?: number;
      };
    }
    lastError = new Error(error.message);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError!;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    const authHeader = req.headers.get("Authorization") || "";
    const authToken = authHeader.replace("Bearer ", "");

    async function requireSuperAdmin() {
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

    // ============ GET POLICY ============
    if (action === "get_policy") {
      await requireSuperAdmin();
      const { data, error } = await admin
        .from("_br_schedule_policy")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ policy: data });
    }

    // ============ UPDATE POLICY ============
    if (action === "update_policy") {
      const userId = await requireSuperAdmin();
      const {
        enabled,
        cron_expression,
        timezone,
        retention_daily,
        retention_weekly,
        retention_monthly,
        max_concurrent,
      } = body;
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: userId,
      };
      if (enabled !== undefined) patch.enabled = enabled;
      if (cron_expression !== undefined)
        patch.cron_expression = cron_expression;
      if (timezone !== undefined) patch.timezone = timezone;
      if (retention_daily !== undefined)
        patch.retention_daily = retention_daily;
      if (retention_weekly !== undefined)
        patch.retention_weekly = retention_weekly;
      if (retention_monthly !== undefined)
        patch.retention_monthly = retention_monthly;
      if (max_concurrent !== undefined) patch.max_concurrent = max_concurrent;

      const { error } = await admin
        .from("_br_schedule_policy")
        .update(patch)
        .eq("id", 1);
      if (error) return json({ error: error.message }, 400);

      // Sync pg_cron job when enabling/disabling or changing cron_expression
      if (enabled !== undefined || cron_expression !== undefined) {
        const { data: pol } = await admin
          .from("_br_schedule_policy")
          .select("enabled, cron_expression, timezone")
          .eq("id", 1)
          .maybeSingle();

        if (pol) {
          const cronSecret = Deno.env.get("BACKUP_CRON_SECRET");
          if (pol.enabled) {
            if (!cronSecret) {
              await admin.from("_br_schedule_policy").update({ enabled: false }).eq("id", 1);
              return json({ error: "Cannot enable scheduler: BACKUP_CRON_SECRET is missing" }, 400);
            }
            const fnUrl = `${SUPABASE_URL}/functions/v1/backup-scheduler`;
            const { data: cronRes, error: cronErr } = await admin.rpc("_br_manage_backup_cron", {
              p_action: "upsert",
              p_cron_expression: pol.cron_expression,
              p_timezone: pol.timezone || "Africa/Dakar",
              p_function_url: fnUrl,
              p_cron_secret: cronSecret,
            });
            if (cronErr || cronRes?.success !== true) {
              await admin.from("_br_schedule_policy").update({ enabled: false }).eq("id", 1);
              return json({ error: `Cron upsert failed: ${cronErr?.message || "RPC returned success=false"}` }, 500);
            }
          } else {
            const { data: cronRes, error: cronErr } = await admin.rpc("_br_manage_backup_cron", {
              p_action: "remove",
            });
            if (cronErr || (cronRes && cronRes.success !== true)) {
              return json({ error: `Cron remove failed: ${cronErr?.message || "RPC returned success=false"}` }, 500);
            }
          }
        }
      }

      return json({ success: true });
    }

    // ============ LIST TENANTS WITH BACKUP STATUS ============
    if (action === "list_tenants_backup_status") {
      await requireSuperAdmin();
      const { data: tenants, error: tErr } = await admin
        .from("tenants")
        .select("id, name, is_active")
        .order("name");

      if (tErr) return json({ error: tErr.message }, 500);
      if (!tenants || tenants.length === 0) return json({ tenants: [] });

      const tenantIds = tenants.map((t: { id: string }) => t.id);

      const { data: allBackups, error: bErr } = await admin
        .from("tenant_backups")
        .select(
          "tenant_id, id, created_at, size_bytes, row_counts, status, global_checksum, kind, is_auto",
        )
        .in("tenant_id", tenantIds)
        .order("created_at", { ascending: false });

      if (bErr) return json({ error: bErr.message }, 500);

      const { data: overrides, error: oErr } = await admin
        .from("_br_tenant_schedule_override")
        .select("*")
        .in("tenant_id", tenantIds);

      if (oErr) return json({ error: oErr.message }, 500);

      const overrideMap = new Map(
        (overrides || []).map((o: { tenant_id: string }) => [o.tenant_id, o]),
      );

      const lastBackupMap = new Map<string, unknown>();
      const countMap = new Map<string, number>();
      for (const b of allBackups || []) {
        const bt = b as {
          tenant_id: string;
          status: string;
          kind: string;
        };
        countMap.set(bt.tenant_id, (countMap.get(bt.tenant_id) || 0) + 1);
        // Only auto/platform_manual verified backups count as "centralized last backup"
        if (
          bt.status === "verified" &&
          CENTRALIZED_KINDS.includes(bt.kind) &&
          !lastBackupMap.has(bt.tenant_id)
        ) {
          lastBackupMap.set(bt.tenant_id, b);
        }
      }

      const result = tenants.map(
        (t: { id: string; name: string; is_active: boolean }) => ({
          ...t,
          last_backup: lastBackupMap.get(t.id) || null,
          override: overrideMap.get(t.id) || null,
          backup_count: countMap.get(t.id) || 0,
        }),
      );

      return json({ tenants: result });
    }

    // ============ GET TENANT BACKUP HISTORY ============
    if (action === "tenant_backup_history") {
      await requireSuperAdmin();
      const { tenant_id, limit: lim } = body;
      if (!tenant_id) return json({ error: "tenant_id required" }, 400);
      const { data, error } = await admin
        .from("tenant_backups")
        .select(
          "id, created_at, label, kind, is_auto, status, size_bytes, row_counts, global_checksum, error_message, verified_at, created_by, format_version",
        )
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false })
        .limit(lim || 20);
      if (error) return json({ error: error.message }, 500);
      return json({ backups: data || [] });
    }

    // ============ SET TENANT OVERRIDE ============
    if (action === "set_tenant_override") {
      const userId = await requireSuperAdmin();
      const { tenant_id, suspended, custom_retention_daily, notes } = body;
      if (!tenant_id) return json({ error: "tenant_id required" }, 400);

      const { error } = await admin
        .from("_br_tenant_schedule_override")
        .upsert(
          {
            tenant_id,
            suspended: suspended ?? false,
            custom_retention_daily: custom_retention_daily || null,
            notes: notes || null,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          },
          { onConflict: "tenant_id" },
        );
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ============ BACKUP NOW (single tenant — platform_manual) ============
    if (action === "backup_now") {
      await requireSuperAdmin();
      const { tenant_id } = body;
      if (!tenant_id) return json({ error: "tenant_id required" }, 400);

      const { data: existing, error: exErr } = await admin
        .from("_br_schedule_run_items")
        .select("id")
        .eq("tenant_id", tenant_id)
        .in("status", ["pending", "running"])
        .limit(1);

      if (exErr) return json({ error: exErr.message }, 500);

      if (existing && existing.length > 0) {
        return json(
          { error: "Une sauvegarde est déjà en cours pour ce tenant" },
          409,
        );
      }

      const { data: run, error: runErr } = await admin
        .from("_br_schedule_runs")
        .insert({
          status: "running",
          tenants_total: 1,
          triggered_by: "manual",
        })
        .select("id")
        .single();
      if (runErr) return json({ error: runErr.message }, 500);

      const { error: itemErr } = await admin
        .from("_br_schedule_run_items")
        .insert({
          run_id: run.id,
          tenant_id,
          status: "running",
          started_at: new Date().toISOString(),
        });
      if (itemErr) {
        await admin
          .from("_br_schedule_runs")
          .update({ status: "failed", finished_at: new Date().toISOString() })
          .eq("id", run.id);
        return json({ error: itemErr.message }, 409);
      }

      try {
        const result = await backupTenantWithRetry(
          admin,
          tenant_id,
          "Sauvegarde manuelle (admin)",
          "platform_manual",
        );

        await admin
          .from("_br_schedule_run_items")
          .update({
            status: "succeeded",
            backup_id: result.backup_id,
            finished_at: new Date().toISOString(),
            size_bytes: result.size_bytes || null,
            row_count: result.total_rows || null,
          })
          .eq("run_id", run.id)
          .eq("tenant_id", tenant_id);

        await admin
          .from("_br_schedule_runs")
          .update({
            status: "completed",
            finished_at: new Date().toISOString(),
            tenants_succeeded: 1,
          })
          .eq("id", run.id);

        return json({
          success: true,
          backup_id: result.backup_id,
          run_id: run.id,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        await admin
          .from("_br_schedule_run_items")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_message: message,
            retry_count: MAX_RETRIES,
          })
          .eq("run_id", run.id)
          .eq("tenant_id", tenant_id);

        await admin
          .from("_br_schedule_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            tenants_failed: 1,
            error_summary: [{ tenant_id, error: message }],
          })
          .eq("id", run.id);

        return json({ error: message }, 500);
      }
    }

    // ============ RUN SCHEDULED BACKUPS (all eligible tenants) ============
    if (action === "run_scheduled") {
      const cronSecret = Deno.env.get("BACKUP_CRON_SECRET");
      const reqCronSecret = req.headers.get("X-Cron-Secret");
      const isCron = !!(
        cronSecret &&
        reqCronSecret &&
        cronSecret === reqCronSecret
      );

      if (!isCron) {
        await requireSuperAdmin();
      }

      const { data: policy, error: pErr } = await admin
        .from("_br_schedule_policy")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (pErr) return json({ error: pErr.message }, 500);

      if (!policy || !policy.enabled) {
        return json({ skipped: true, reason: "Scheduler is disabled" });
      }

      const { data: tenants, error: tErr } = await admin
        .from("tenants")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (tErr) return json({ error: tErr.message }, 500);
      if (!tenants || tenants.length === 0) {
        return json({ skipped: true, reason: "No active tenants" });
      }

      const { data: overrides, error: oErr } = await admin
        .from("_br_tenant_schedule_override")
        .select("tenant_id, suspended, custom_retention_daily");

      if (oErr) return json({ error: oErr.message }, 500);

      const overrideMap = new Map(
        (overrides || []).map(
          (o: { tenant_id: string }) => [o.tenant_id, o] as const,
        ),
      );

      const suspendedSet = new Set(
        (overrides || [])
          .filter((o: { suspended: boolean }) => o.suspended)
          .map((o: { tenant_id: string }) => o.tenant_id),
      );

      const eligible = tenants.filter(
        (t: { id: string }) => !suspendedSet.has(t.id),
      );
      const skipped = tenants.length - eligible.length;

      const { data: run, error: runErr } = await admin
        .from("_br_schedule_runs")
        .insert({
          status: "running",
          tenants_total: tenants.length,
          tenants_skipped: skipped,
          triggered_by: isCron ? "cron" : "manual",
        })
        .select("id")
        .single();

      if (runErr) return json({ error: runErr.message }, 500);

      const items = eligible.map((t: { id: string }) => ({
        run_id: run.id,
        tenant_id: t.id,
        status: "pending",
      }));
      const skippedItems = tenants
        .filter((t: { id: string }) => suspendedSet.has(t.id))
        .map((t: { id: string }) => ({
          run_id: run.id,
          tenant_id: t.id,
          status: "skipped",
          finished_at: new Date().toISOString(),
        }));

      if (items.length > 0) {
        const { error: iErr } = await admin
          .from("_br_schedule_run_items")
          .insert(items);
        if (iErr) return json({ error: iErr.message }, 500);
      }
      if (skippedItems.length > 0) {
        const { error: sErr } = await admin
          .from("_br_schedule_run_items")
          .insert(skippedItems);
        if (sErr) return json({ error: sErr.message }, 500);
      }

      const maxConcurrent = policy.max_concurrent || 2;
      let succeeded = 0;
      let failed = 0;
      const succeededTenantIds: string[] = [];
      const offsiteQueue: { tenant_id: string; backup_id: string }[] = [];
      const errors: {
        tenant_id: string;
        tenant_name: string;
        error: string;
      }[] = [];

      for (let i = 0; i < eligible.length; i += maxConcurrent) {
        const batch = eligible.slice(i, i + maxConcurrent);
        const results = await Promise.allSettled(
          batch.map(async (t: { id: string; name: string }) => {
            await admin
              .from("_br_schedule_run_items")
              .update({
                status: "running",
                started_at: new Date().toISOString(),
              })
              .eq("run_id", run.id)
              .eq("tenant_id", t.id);

            const result = await backupTenantWithRetry(
              admin,
              t.id,
              "Sauvegarde planifiée",
              "auto",
            );

            await admin
              .from("_br_schedule_run_items")
              .update({
                status: "succeeded",
                backup_id: result.backup_id,
                finished_at: new Date().toISOString(),
                size_bytes: result.size_bytes || null,
                row_count: result.total_rows || null,
              })
              .eq("run_id", run.id)
              .eq("tenant_id", t.id);

            return { tenant_id: t.id, backup_id: result.backup_id };
          }),
        );

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === "fulfilled") {
            succeeded++;
            succeededTenantIds.push(
              (batch[j] as { id: string }).id,
            );
            // Auto-queue offsite transfer for successful auto backups
            if (r.value.backup_id) {
              offsiteQueue.push({ tenant_id: r.value.tenant_id, backup_id: r.value.backup_id })
            }
          } else {
            failed++;
            const t = batch[j] as { id: string; name: string };
            const errMsg =
              r.reason instanceof Error ? r.reason.message : "Unknown";
            errors.push({
              tenant_id: t.id,
              tenant_name: t.name,
              error: errMsg,
            });
            await admin
              .from("_br_schedule_run_items")
              .update({
                status: "failed",
                finished_at: new Date().toISOString(),
                error_message: errMsg,
                retry_count: MAX_RETRIES,
              })
              .eq("run_id", run.id)
              .eq("tenant_id", t.id);
          }
        }
      }

      const finalStatus =
        failed === 0
          ? "completed"
          : succeeded === 0
            ? "failed"
            : "partial_failure";
      await admin
        .from("_br_schedule_runs")
        .update({
          status: finalStatus,
          finished_at: new Date().toISOString(),
          tenants_succeeded: succeeded,
          tenants_failed: failed,
          error_summary: errors.length > 0 ? errors : null,
        })
        .eq("id", run.id);

      // ---------- Retention cleanup ----------
      // ONLY process tenants whose backup succeeded this run.
      // ONLY delete kind='auto' with is_auto=true. Never touch platform_manual/manual/safety/import.
      const retentionErrors: { tenant_id: string; error: string }[] = [];
      if (succeededTenantIds.length > 0) {
        const retentionDaily = policy.retention_daily || 7;
        const retentionWeekly = policy.retention_weekly || 4;
        const retentionMonthly = policy.retention_monthly || 6;

        for (const tid of succeededTenantIds) {
          try {
            const override = overrideMap.get(tid) as
              | { custom_retention_daily: number | null }
              | undefined;
            const effectiveDaily =
              override?.custom_retention_daily || retentionDaily;

            const { data: autoBackups, error: abErr } = await admin
              .from("tenant_backups")
              .select("id, created_at")
              .eq("tenant_id", tid)
              .eq("status", "verified")
              .eq("kind", "auto")
              .eq("is_auto", true)
              .order("created_at", { ascending: false });

            if (abErr) {
              retentionErrors.push({
                tenant_id: tid,
                error: `fetch: ${abErr.message}`,
              });
              continue;
            }
            if (!autoBackups || autoBackups.length === 0) continue;

            const now = new Date();
            const keepIds = new Set<string>();

            for (
              let d = 0;
              d < Math.min(effectiveDaily, autoBackups.length);
              d++
            ) {
              keepIds.add(autoBackups[d].id);
            }

            if (retentionWeekly > 0) {
              for (let w = 1; w <= retentionWeekly; w++) {
                const weekStart = new Date(now);
                weekStart.setDate(weekStart.getDate() - w * 7);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                const candidate = autoBackups.find(
                  (b: { id: string; created_at: string }) => {
                    const d = new Date(b.created_at);
                    return d >= weekStart && d < weekEnd;
                  },
                );
                if (candidate) keepIds.add(candidate.id);
              }
            }

            if (retentionMonthly > 0) {
              for (let m = 1; m <= retentionMonthly; m++) {
                const monthStart = new Date(
                  now.getFullYear(),
                  now.getMonth() - m,
                  1,
                );
                const monthEnd = new Date(
                  now.getFullYear(),
                  now.getMonth() - m + 1,
                  1,
                );
                const candidate = autoBackups.find(
                  (b: { id: string; created_at: string }) => {
                    const d = new Date(b.created_at);
                    return d >= monthStart && d < monthEnd;
                  },
                );
                if (candidate) keepIds.add(candidate.id);
              }
            }

            const toDelete = autoBackups
              .filter((b: { id: string }) => !keepIds.has(b.id))
              .map((b: { id: string }) => b.id);

            if (toDelete.length > 0) {
              const { error: delErr } = await admin
                .from("tenant_backups")
                .delete()
                .in("id", toDelete);
              if (delErr) {
                retentionErrors.push({
                  tenant_id: tid,
                  error: `delete: ${delErr.message}`,
                });
              }
            }
          } catch (retErr: unknown) {
            retentionErrors.push({
              tenant_id: tid,
              error:
                retErr instanceof Error ? retErr.message : "retention error",
            });
          }
        }
      }

      // ---------- Auto-queue offsite transfers ----------
      if (offsiteQueue.length > 0) {
        try {
          const { data: offCfg } = await admin
            .from("_br_offsite_config")
            .select("enabled, auto_transfer, root_folder")
            .eq("id", 1)
            .maybeSingle();

          if (offCfg?.enabled && offCfg?.auto_transfer) {
            const rootFolder = offCfg.root_folder || "/Waarwi";
            for (const item of offsiteQueue) {
              const { data: bk } = await admin
                .from("tenant_backups")
                .select("created_at")
                .eq("id", item.backup_id)
                .maybeSingle();
              if (!bk) continue;
              const d = new Date(bk.created_at);
              const yr = d.getUTCFullYear().toString();
              const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
              const dy = String(d.getUTCDate()).padStart(2, "0");
              const filePath = `${rootFolder}/${item.tenant_id}/${yr}/${mo}/${dy}_${item.backup_id}.waarwi.enc`;
              const { error: ofsErr } = await admin.from("_br_offsite_transfers").insert({
                source_backup_id: item.backup_id,
                backup_id: item.backup_id,
                tenant_id: item.tenant_id,
                remote_path: filePath,
                status: "queued",
              });
              if (ofsErr && !ofsErr.message.includes("duplicate")) {
                // log but don't block
              }
            }
          }
        } catch { /* offsite queue is best-effort, never block the run */ }
      }

      return json({
        success: true,
        run_id: run.id,
        tenants_total: tenants.length,
        tenants_succeeded: succeeded,
        tenants_failed: failed,
        tenants_skipped: skipped,
        errors,
        retention_errors:
          retentionErrors.length > 0 ? retentionErrors : undefined,
      });
    }

    // ============ GET RUNS HISTORY ============
    if (action === "list_runs") {
      await requireSuperAdmin();
      const { limit: lim } = body;
      const { data, error } = await admin
        .from("_br_schedule_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(lim || 20);
      if (error) return json({ error: error.message }, 500);
      return json({ runs: data || [] });
    }

    // ============ GET RUN DETAIL ============
    if (action === "get_run_detail") {
      await requireSuperAdmin();
      const { run_id } = body;
      if (!run_id) return json({ error: "run_id required" }, 400);

      const { data: runData, error: rErr } = await admin
        .from("_br_schedule_runs")
        .select("*")
        .eq("id", run_id)
        .maybeSingle();

      if (rErr) return json({ error: rErr.message }, 500);

      const { data: items, error: iErr } = await admin
        .from("_br_schedule_run_items")
        .select("*, tenants(name)")
        .eq("run_id", run_id)
        .order("started_at", { ascending: true });

      if (iErr) return json({ error: iErr.message }, 500);

      return json({ run: runData, items: items || [] });
    }

    // ============ CRON STATUS ============
    if (action === "cron_status") {
      await requireSuperAdmin();
      const { data, error } = await admin.rpc("_br_manage_backup_cron", {
        p_action: "status",
      });
      if (error) return json({ error: error.message }, 500);
      const cronSecretSet = !!Deno.env.get("BACKUP_CRON_SECRET");
      return json({ cron: data, cron_secret_configured: cronSecretSet });
    }

    // ============ DASHBOARD SUMMARY ============
    if (action === "dashboard_summary") {
      await requireSuperAdmin();

      const { data: policy, error: pErr } = await admin
        .from("_br_schedule_policy")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (pErr) return json({ error: pErr.message }, 500);

      const { count: totalTenants, error: tcErr } = await admin
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      if (tcErr) return json({ error: tcErr.message }, 500);

      const { count: suspendedCount, error: scErr } = await admin
        .from("_br_tenant_schedule_override")
        .select("tenant_id", { count: "exact", head: true })
        .eq("suspended", true);

      if (scErr) return json({ error: scErr.message }, 500);

      const { data: lastRun, error: lrErr } = await admin
        .from("_br_schedule_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lrErr) return json({ error: lrErr.message }, 500);

      // Protected = tenants with at least one verified auto/platform_manual backup
      const { data: protectedRaw, error: prErr } = await admin
        .from("tenant_backups")
        .select("tenant_id")
        .eq("status", "verified")
        .in("kind", CENTRALIZED_KINDS)
        .order("tenant_id");

      if (prErr) return json({ error: prErr.message }, 500);

      const protectedSet = new Set(
        (protectedRaw || []).map((r: { tenant_id: string }) => r.tenant_id),
      );

      // Real cron status from pg_cron
      let cronStatus: unknown = { exists: false, active: false, error: null };
      try {
        const { data: cs, error: csErr } = await admin.rpc("_br_manage_backup_cron", {
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

      const cronSecretSet = !!Deno.env.get("BACKUP_CRON_SECRET");

      return json({
        policy,
        total_tenants: totalTenants || 0,
        suspended_tenants: suspendedCount || 0,
        protected_tenants: protectedSet.size,
        last_run: lastRun,
        cron_status: cronStatus,
        cron_secret_configured: cronSecretSet,
      });
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
