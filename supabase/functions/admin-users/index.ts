import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlPage(title: string, message: string, success: boolean) {
  const color = success ? "#059669" : "#dc2626";
  const bgColor = success ? "#ecfdf5" : "#fef2f2";
  const iconChar = success ? "\u2713" : "\u2717";
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - WAARWI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border-radius:24px;padding:56px 44px;max-width:480px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.icon-wrap{width:80px;height:80px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:36px;color:#fff;margin-bottom:24px;background:${color};box-shadow:0 8px 24px ${color}40}
h1{font-size:24px;color:#0f172a;margin-bottom:16px;font-weight:700;letter-spacing:-0.5px}
p{font-size:16px;color:#64748b;line-height:1.7}
.btn{display:inline-block;margin-top:32px;padding:14px 36px;background:#0f172a;color:#fff;text-decoration:none;border-radius:12px;font-size:15px;font-weight:600;transition:transform .2s,box-shadow .2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(15,23,42,.3)}
.brand{margin-top:36px;font-size:14px;color:#94a3b8;font-weight:700;letter-spacing:3px}
</style></head><body>
<div class="card">
<div class="icon-wrap">${iconChar}</div>
<h1>${title}</h1>
<p>${message}</p>
<a class="btn" href="https://app.waarwi.com">Aller \u00e0 l'application</a>
<div class="brand">WAARWI</div>
</div></body></html>`;
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Access-Control-Allow-Origin", "*");
  return new Response(new TextEncoder().encode(html).buffer, { status: 200, headers: h });
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Handle GET requests with action_token (email button clicks)
    const url = new URL(req.url);
    const actionToken = url.searchParams.get("action_token");
    if (actionToken) {
      const { data: result, error: rpcErr } = await admin.rpc("execute_subscription_action_token", { p_token: actionToken });
      if (rpcErr) return htmlPage("Erreur", rpcErr.message, false);
      if (!result?.success) return htmlPage("Erreur", result?.error || "Action impossible", false);

      if (result.already_used) {
        const currentStatus = result.tenant_active ? "actif" : "suspendu";
        return htmlPage(
          "Action d\u00e9j\u00e0 effectu\u00e9e",
          `Ce lien a d\u00e9j\u00e0 \u00e9t\u00e9 utilis\u00e9. Le compte de ${result.tenant_name} est actuellement ${currentStatus}.`,
          true
        );
      }

      if (result.action === "suspend") {
        const msg = result.already_done
          ? `Le compte de ${result.tenant_name} \u00e9tait d\u00e9j\u00e0 suspendu.`
          : `Le compte de ${result.tenant_name} a \u00e9t\u00e9 suspendu avec succ\u00e8s. L'acc\u00e8s est imm\u00e9diatement bloqu\u00e9.`;
        return htmlPage("Client suspendu", msg, true);
      } else {
        const msg = result.already_done
          ? `Le compte de ${result.tenant_name} \u00e9tait d\u00e9j\u00e0 actif.`
          : `Le compte de ${result.tenant_name} a \u00e9t\u00e9 r\u00e9activ\u00e9 avec succ\u00e8s. L'acc\u00e8s est de nouveau fonctionnel.`;
        return htmlPage("Client r\u00e9activ\u00e9", msg, true);
      }
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // Public action: auto-approve by token (no auth required, token is the secret)
    if (action === "auto_approve_by_token") {
      const { token } = body;
      if (!token) return json({ error: "token requis" }, 400);
      const { data: result, error: rpcErr } = await admin.rpc("auto_approve_tenant_by_token", { p_token: token });
      if (rpcErr) return json({ error: rpcErr.message }, 400);
      if (!result?.success) return json({ error: result?.error || "Echec" }, 400);
      const { data: approvedTenant } = await admin.from("tenants").select("id").eq("name", result.tenant_name).eq("email", result.tenant_email).maybeSingle();
      if (approvedTenant) {
        fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "approval", tenant_id: approvedTenant.id }),
        }).catch(() => {});
      }
      return json({ success: true, tenant_name: result.tenant_name });
    }

    // All other actions require authentication
    const authHeader = req.headers.get("Authorization") || "";
    const authToken = authHeader.replace("Bearer ", "");
    if (!authToken) return json({ error: "Unauthorized" }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(authToken);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const caller = userData.user;

    const { data: callerProfile } = await admin.from("profiles").select("*").eq("id", caller.id).maybeSingle();
    if (!callerProfile) return json({ error: "Profile not found" }, 403);

    const isSuperAdmin = callerProfile.role === "super_admin";
    const isAdmin = callerProfile.role === "admin" || isSuperAdmin;

    const logEvent = async (a: string, tenantId: string | null, payload: Record<string, unknown> = {}) => {
      await admin.from("platform_events").insert({
        actor_id: caller.id,
        actor_email: caller.email || "",
        tenant_id: tenantId,
        action: a,
        payload,
      });
    };

    // ============ USERS ============
    if (action === "list") {
      const tenantId = isSuperAdmin && body.tenant_id ? body.tenant_id : callerProfile.tenant_id;
      if (!tenantId) return json({ users: [] });
      const { data } = await admin.from("profiles").select("*").eq("tenant_id", tenantId).order("created_at");
      return json({ users: data || [] });
    }

    if (action === "create") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const { email, password, full_name, role, tenant_id } = body;
      if (!email || !password) return json({ error: "email et mot de passe requis" }, 400);
      const targetTenant = isSuperAdmin && tenant_id ? tenant_id : callerProfile.tenant_id;
      if (!targetTenant) return json({ error: "Tenant introuvable" }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });
      if (createErr || !created.user) return json({ error: createErr?.message || "Création échouée" }, 400);

      const { error: profErr } = await admin.from("profiles").upsert({
        id: created.user.id,
        tenant_id: targetTenant,
        full_name: full_name || "",
        email,
        role: role || "cashier",
        is_active: true,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: profErr.message }, 400);
      }
      return json({ success: true, user_id: created.user.id });
    }

    if (action === "reset_password") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const { user_id, new_password } = body;
      if (!user_id || !new_password) return json({ error: "Paramètres manquants" }, 400);
      const { data: target } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
      if (!target) return json({ error: "Utilisateur introuvable" }, 404);
      if (!isSuperAdmin && target.tenant_id !== callerProfile.tenant_id) return json({ error: "Forbidden" }, 403);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "update") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const { user_id, full_name, role, is_active } = body;
      const { data: target } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
      if (!target) return json({ error: "Utilisateur introuvable" }, 404);
      if (!isSuperAdmin && target.tenant_id !== callerProfile.tenant_id) return json({ error: "Forbidden" }, 403);
      const patch: Record<string, unknown> = {};
      if (full_name !== undefined) patch.full_name = full_name;
      if (role !== undefined) patch.role = role;
      if (is_active !== undefined) patch.is_active = is_active;
      const { error } = await admin.from("profiles").update(patch).eq("id", user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "delete") {
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
      const { user_id } = body;
      if (user_id === caller.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte" }, 400);
      const { data: target } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
      if (!target) return json({ error: "Utilisateur introuvable" }, 404);
      if (!isSuperAdmin && target.tenant_id !== callerProfile.tenant_id) return json({ error: "Forbidden" }, 403);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    // ============ SUPER ADMIN ONLY ============
    if (!isSuperAdmin) return json({ error: "Forbidden" }, 403);

    if (action === "platform_overview") {
      const now = new Date();
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
      const [
        tenantsRes,
        usersRes,
        subsActive,
        expiringRes,
        suspendedRes,
        mrrRes,
        recentEvents,
      ] = await Promise.all([
        admin.from("tenants").select("id,plan,is_active,status,plan_expires_at,created_at"),
        admin.from("profiles").select("id", { count: "exact", head: true }),
        admin.from("tenant_subscriptions").select("id,plan_code,amount,billing_cycle", { count: "exact" }).eq("status", "active"),
        admin.from("tenants").select("id,name,plan_expires_at").lte("plan_expires_at", in7).gte("plan_expires_at", now.toISOString()),
        admin.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", false),
        admin.from("tenant_subscriptions").select("amount,billing_cycle,tenants(name)").eq("status", "active").neq("billing_cycle", "lifetime"),
        admin.from("platform_events").select("*").order("created_at", { ascending: false }).limit(10),
      ]);

      const tenants = tenantsRes.data || [];
      const byPlan: Record<string, number> = {};
      for (const t of tenants) byPlan[t.plan] = (byPlan[t.plan] || 0) + 1;
      const EXCLUDED_MRR_TENANTS = ["INTELLIGENCEPRO TECHNOLOGIES", "SAD PIECES AUTO"];
      const mrr = (mrrRes.data || [])
        .filter((r: any) => {
          const name = r.tenants?.name as string | undefined;
          return !name || !EXCLUDED_MRR_TENANTS.includes(name.toUpperCase());
        })
        .reduce((s: number, r: any) => s + Number(r.amount || 0) / (r.billing_cycle === "yearly" ? 12 : 1), 0);

      return json({
        tenants_total: tenants.length,
        tenants_active: tenants.filter((t: any) => t.is_active).length,
        tenants_suspended: suspendedRes.count || 0,
        users_total: usersRes.count || 0,
        subscriptions_active: subsActive.count || 0,
        by_plan: byPlan,
        mrr: Math.round(mrr),
        expiring_soon: expiringRes.data || [],
        recent_events: recentEvents.data || [],
      });
    }

    if (action === "list_tenants") {
      const { data } = await admin
        .from("tenants")
        .select("*, profiles(id,email,full_name,role,is_active), tenant_subscriptions(id,plan_code,status,amount,billing_cycle,started_at,ends_at,auto_renew)")
        .order("created_at", { ascending: false });
      return json({ tenants: data || [] });
    }

    if (action === "tenant_detail") {
      const { tenant_id } = body;
      const [{ data: tenant }, { data: users }, { data: subs }, { data: events }, { data: usageRows }] = await Promise.all([
        admin.from("tenants").select("*").eq("id", tenant_id).maybeSingle(),
        admin.from("profiles").select("*").eq("tenant_id", tenant_id).order("created_at"),
        admin.from("tenant_subscriptions").select("*").eq("tenant_id", tenant_id).order("started_at", { ascending: false }),
        admin.from("platform_events").select("*").eq("tenant_id", tenant_id).order("created_at", { ascending: false }).limit(20),
        admin.rpc("tenant_usage", { p_tenant_id: tenant_id }),
      ]);
      const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
      return json({ tenant, users: users || [], subscriptions: subs || [], events: events || [], usage: usage || null });
    }

    if (action === "update_tenant") {
      const { tenant_id, patch } = body;
      if (!tenant_id || !patch) return json({ error: "Paramètres manquants" }, 400);
      const allowed = ["status", "plan", "plan_expires_at", "is_active", "name", "legal_name", "email", "phone", "whatsapp_phone", "business_type", "business_activity_type_id", "enabled_modules", "custom_domain", "subdomain", "billing_cycle", "auto_renew", "subscription_status", "subscription_start_date", "trial_start_date", "trial_end_date", "auto_suspend_enabled", "auto_suspend_grace_days"];
      const clean: Record<string, unknown> = {};
      for (const k of allowed) if (k in patch) clean[k] = patch[k];
      const { error } = await admin.from("tenants").update(clean).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("tenant.update", tenant_id, clean);
      return json({ success: true });
    }

    if (action === "suspend_tenant") {
      const { tenant_id, reason } = body;
      const { error } = await admin.from("tenants").update({ is_active: false, status: "suspended" }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("tenant.suspend", tenant_id, { reason: reason || "" });
      return json({ success: true });
    }

    if (action === "reactivate_tenant") {
      const { tenant_id } = body;
      const { error } = await admin.from("tenants").update({ is_active: true, status: "active" }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("tenant.reactivate", tenant_id, {});
      return json({ success: true });
    }

    if (action === "approve_tenant") {
      const { tenant_id } = body;
      if (!tenant_id) return json({ error: "tenant_id requis" }, 400);

      // Get tenant's selected plan and billing cycle
      const { data: tenantData } = await admin.from("tenants").select("selected_plan_code, plan, billing_cycle").eq("id", tenant_id).maybeSingle();
      const planCode = tenantData?.selected_plan_code || tenantData?.plan || "trial";
      const billingCycle = tenantData?.billing_cycle || "monthly";
      const { data: planData } = await admin.from("plans").select("trial_days, price_monthly, price_yearly, price_lifetime").eq("code", planCode).maybeSingle();
      const trialDays = planData?.trial_days || 14;
      const isLifetime = billingCycle === "lifetime";

      const now = new Date();
      const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

      // Calculate subscription end date (after trial) - lifetime has no end
      let subscriptionEndDate: Date | null = null;
      if (!isLifetime) {
        if (billingCycle === "yearly") {
          subscriptionEndDate = new Date(trialEnd.getTime() + 365 * 24 * 60 * 60 * 1000);
        } else {
          subscriptionEndDate = new Date(trialEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
        }
      }

      const updatePayload: Record<string, unknown> = {
        approval_status: "approved",
        approved_at: now.toISOString(),
        approved_by: caller.id,
        is_active: true,
        status: "active",
        plan: planCode,
        subscription_status: isLifetime ? "active" : "trial_active",
        trial_start_date: isLifetime ? null : now.toISOString(),
        trial_end_date: isLifetime ? null : trialEnd.toISOString(),
        subscription_start_date: isLifetime ? now.toISOString() : trialEnd.toISOString(),
        plan_expires_at: subscriptionEndDate ? subscriptionEndDate.toISOString() : null,
        auto_renew: !isLifetime,
      };

      const { error } = await admin.from("tenants").update(updatePayload).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);

      // Create subscription record
      const amount = isLifetime ? (planData?.price_lifetime || 0) : billingCycle === "yearly" ? (planData?.price_yearly || 0) : (planData?.price_monthly || 0);
      await admin.from("tenant_subscriptions").insert({
        tenant_id,
        plan_code: planCode,
        billing_cycle: billingCycle,
        amount,
        currency: "FCFA",
        started_at: isLifetime ? now.toISOString() : trialEnd.toISOString(),
        ends_at: subscriptionEndDate ? subscriptionEndDate.toISOString() : null,
        auto_renew: !isLifetime,
        status: "pending",
        notes: `Abonnement ${billingCycle === "yearly" ? "annuel" : "mensuel"} - commence après essai de ${trialDays}j`,
        created_by: caller.id,
      });

      await logEvent("tenant.approve", tenant_id, { trial_days: trialDays, plan: planCode, billing_cycle: billingCycle });

      // Send approval notification email (fire-and-forget)
      fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "approval", tenant_id }),
      }).catch(() => {});

      return json({ success: true });
    }

    if (action === "reject_tenant") {
      const { tenant_id, reason } = body;
      if (!tenant_id) return json({ error: "tenant_id requis" }, 400);
      const { error } = await admin.from("tenants").update({
        approval_status: "rejected",
        rejection_reason: reason || "",
        is_active: false,
        status: "suspended",
      }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("tenant.reject", tenant_id, { reason: reason || "" });

      // Send rejection notification email (fire-and-forget)
      const SUPABASE_URL2 = Deno.env.get("SUPABASE_URL")!;
      fetch(`${SUPABASE_URL2}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "rejection", tenant_id, reason: reason || "" }),
      }).catch(() => {});

      return json({ success: true });
    }

    if (action === "delete_tenant") {
      const { tenant_id, reason } = body;
      if (!tenant_id) return json({ error: "tenant_id requis" }, 400);

      const { data: result, error: rpcErr } = await admin.rpc("delete_tenant_permanently", {
        p_tenant_id: tenant_id,
        p_actor_id: caller.id,
        p_actor_email: caller.email || "",
        p_reason: reason || "",
      });

      if (rpcErr) return json({ error: rpcErr.message }, 400);
      if (!result?.success) return json({ error: result?.error || "Échec de la suppression" }, 400);

      // Delete auth users that belonged to this tenant
      const userIds: string[] = result.user_ids || [];
      const deleteErrors: string[] = [];
      for (const uid of userIds) {
        if (uid === caller.id) continue; // never delete the super admin
        const { error: delErr } = await admin.auth.admin.deleteUser(uid);
        if (delErr) deleteErrors.push(`${uid}: ${delErr.message}`);
      }

      return json({
        success: true,
        tenant_name: result.tenant_name,
        users_deleted: userIds.length - deleteErrors.length,
        data_summary: result.data_summary,
        delete_errors: deleteErrors.length > 0 ? deleteErrors : undefined,
      });
    }

    // ============ PLANS ============
    if (action === "list_plans") {
      const { data } = await admin.from("plans").select("*").order("sort_order");
      return json({ plans: data || [] });
    }

    if (action === "upsert_plan") {
      const { plan } = body;
      const { error } = await admin.from("plans").upsert({ ...plan, updated_at: new Date().toISOString() });
      if (error) return json({ error: error.message }, 400);
      await logEvent("plan.upsert", null, { code: plan.code });
      return json({ success: true });
    }

    if (action === "delete_plan") {
      const { code } = body;
      const { error } = await admin.from("plans").delete().eq("code", code);
      if (error) return json({ error: error.message }, 400);
      await logEvent("plan.delete", null, { code });
      return json({ success: true });
    }

    // ============ SUBSCRIPTIONS ============
    if (action === "create_subscription") {
      const { tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at, auto_renew, notes, custom_limits } = body;
      if (!tenant_id || !plan_code) return json({ error: "Paramètres manquants" }, 400);
      await admin.from("tenant_subscriptions").update({ status: "superseded" }).eq("tenant_id", tenant_id).eq("status", "active");
      const { data, error } = await admin.from("tenant_subscriptions").insert({
        tenant_id, plan_code, billing_cycle: billing_cycle || "monthly",
        amount: amount || 0, currency: currency || "FCFA",
        started_at: started_at || new Date().toISOString(),
        ends_at: ends_at || null,
        auto_renew: auto_renew !== false,
        notes: notes || "",
        status: "active",
        created_by: caller.id,
        custom_limits: custom_limits || null,
      }).select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await admin.from("tenants").update({
        plan: plan_code,
        plan_expires_at: ends_at || null,
        status: "active",
        is_active: true,
        subscription_status: "active",
        billing_cycle: billing_cycle || "monthly",
        auto_renew: auto_renew !== false,
        subscription_start_date: started_at || new Date().toISOString(),
      }).eq("id", tenant_id);
      await logEvent("subscription.create", tenant_id, { plan_code, amount, custom_limits });
      return json({ success: true, subscription: data });
    }

    if (action === "cancel_subscription") {
      const { subscription_id, reason } = body;
      const { data: sub } = await admin.from("tenant_subscriptions").select("tenant_id").eq("id", subscription_id).maybeSingle();
      const { error } = await admin.from("tenant_subscriptions")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason || "", auto_renew: false })
        .eq("id", subscription_id);
      if (error) return json({ error: error.message }, 400);
      if (sub) await logEvent("subscription.cancel", sub.tenant_id, { subscription_id, reason });
      return json({ success: true });
    }

    if (action === "send_payment_reminder") {
      const { tenant_id, custom_message } = body;
      if (!tenant_id) return json({ error: "tenant_id requis" }, 400);

      const { data: tenantData } = await admin.from("tenants").select("name, email, plan, plan_expires_at, billing_cycle, whatsapp_phone").eq("id", tenant_id).maybeSingle();
      if (!tenantData) return json({ error: "Tenant introuvable" }, 404);

      const { data: planData } = await admin.from("plans").select("name, price_monthly, price_yearly, price_lifetime").eq("code", tenantData.plan).maybeSingle();

      const expiresAt = tenantData.plan_expires_at ? new Date(tenantData.plan_expires_at) : null;
      const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null;
      const amount = tenantData.billing_cycle === "lifetime" ? (planData?.price_lifetime || 0) : tenantData.billing_cycle === "yearly" ? (planData?.price_yearly || 0) : (planData?.price_monthly || 0);
      const cycleLabel = tenantData.billing_cycle === "yearly" ? "annuel" : "mensuel";

      // Create in-app message directly (no email since most clients have fictitious emails)
      const messageBody = custom_message
        ? custom_message
        : `Votre abonnement ${planData?.name || tenantData.plan} (${cycleLabel}) ${
            daysLeft !== null && daysLeft > 0
              ? `expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`
              : `est expir\u00e9`
          }. Montant : ${new Intl.NumberFormat("fr-FR").format(amount)} FCFA. Veuillez contacter l'administrateur pour le renouvellement.`;

      await admin.from("tenant_messages").insert({
        title: daysLeft !== null && daysLeft > 0 ? "Rappel : Renouvellement d'abonnement" : "URGENT : Abonnement expir\u00e9",
        body: messageBody,
        severity: daysLeft !== null && daysLeft > 0 ? "warning" : "critical",
        target: "tenant",
        tenant_id,
        requires_ack: true,
        expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      });

      await logEvent("subscription.reminder_sent", tenant_id, { days_left: daysLeft, amount, method: "in_app" });
      return json({ success: true, tenant_name: tenantData.name, days_left: daysLeft });
    }

    if (action === "list_expiring_tenants") {
      const { days } = body;
      const daysAhead = days || 5;
      const now = new Date();
      const futureLimit = new Date(now.getTime() + daysAhead * 86400000);
      const pastLimit = new Date(now.getTime() - 30 * 86400000);
      const { data } = await admin.from("tenants")
        .select("id, name, email, plan, plan_expires_at, billing_cycle, whatsapp_phone, auto_renew")
        .eq("approval_status", "approved")
        .eq("is_active", true)
        .neq("billing_cycle", "lifetime")
        .not("plan_expires_at", "is", null)
        .lte("plan_expires_at", futureLimit.toISOString())
        .gte("plan_expires_at", pastLimit.toISOString())
        .order("plan_expires_at");
      return json({ tenants: data || [] });
    }

    // ============ MESSAGES ============
    if (action === "list_messages") {
      const { data } = await admin
        .from("tenant_messages")
        .select("*, tenants(name)")
        .order("created_at", { ascending: false });
      return json({ messages: data || [] });
    }

    if (action === "create_message") {
      const { title, body: b, severity, target, tenant_id, plan_code, requires_ack, cta_label, cta_url, expires_at } = body;
      if (!title) return json({ error: "Titre requis" }, 400);
      const { data, error } = await admin.from("tenant_messages").insert({
        title, body: b || "", severity: severity || "info",
        target: target || "all",
        tenant_id: target === "tenant" ? tenant_id : null,
        plan_code: target === "plan" ? plan_code : null,
        requires_ack: requires_ack !== false,
        cta_label: cta_label || "", cta_url: cta_url || "",
        expires_at: expires_at || null,
        created_by: caller.id,
      }).select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("message.create", target === "tenant" ? tenant_id : null, { title, target });
      return json({ success: true, message: data });
    }

    if (action === "delete_message") {
      const { id } = body;
      const { error } = await admin.from("tenant_messages").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("message.delete", null, { id });
      return json({ success: true });
    }

    // ============ ACTIVITY ============
    if (action === "list_events") {
      const { limit } = body;
      const { data } = await admin.from("platform_events").select("*, tenants(name)")
        .order("created_at", { ascending: false })
        .limit(limit || 100);
      return json({ events: data || [] });
    }

    if (action === "tenant_activity_overview") {
      const { data: tenants } = await admin.from("tenants")
        .select("id, name, plan, created_at, last_active_at")
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });

      const activity = [];
      for (const t of (tenants || [])) {
        const [salesRes, articlesRes, usersRes] = await Promise.all([
          admin.from("sales").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
          admin.from("articles").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
          admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
        ]);
        activity.push({
          tenant_id: t.id,
          tenant_name: t.name,
          plan: t.plan || "starter",
          last_active_at: t.last_active_at || null,
          total_sales: salesRes.count || 0,
          total_articles: articlesRes.count || 0,
          total_users: usersRes.count || 0,
          created_at: t.created_at,
        });
      }
      return json({ activity });
    }

    // ============ LOGIN CONFIG ============
    if (action === "get_login_config") {
      const { data } = await admin.from("platform_login_config").select("*").eq("id", "default").maybeSingle();
      return json(data || {});
    }

    if (action === "update_login_config") {
      const { headline, headline_accent, subtitle, modules, login_bg_url, eyebrow, text_accents, carousel_interval_ms, login_title, login_subtitle } = body;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.id };
      if (headline !== undefined) patch.headline = headline;
      if (headline_accent !== undefined) patch.headline_accent = headline_accent;
      if (subtitle !== undefined) patch.subtitle = subtitle;
      if (modules !== undefined) patch.modules = modules;
      if (login_bg_url !== undefined) patch.login_bg_url = login_bg_url;
      if (eyebrow !== undefined) patch.eyebrow = eyebrow;
      if (text_accents !== undefined) patch.text_accents = text_accents;
      if (carousel_interval_ms !== undefined) patch.carousel_interval_ms = carousel_interval_ms;
      if (login_title !== undefined) patch.login_title = login_title;
      if (login_subtitle !== undefined) patch.login_subtitle = login_subtitle;
      const { data, error } = await admin.from("platform_login_config").update(patch).eq("id", "default").select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("login_config.update", null, patch);
      return json({ success: true, config: data });
    }

    // ============ LANDING CONFIG ============
    if (action === "get_landing_config") {
      const { data } = await admin.from("landing_config").select("*").eq("id", "default").maybeSingle();
      return json(data || {});
    }

    if (action === "update_landing_config") {
      const {
        hero_headline, hero_accent, hero_subtitle, hero_cta_label, hero_cta_url,
        hero_image_url, hero_mobile_image_url, hero_mobile_visible,
        stats_label_tenants, stats_label_sectors, stats_label_uptime,
        pricing_visible, features, footer_tagline,
        demo_desktop, demo_mobile, why_waarwi, faq_items, section_titles,
        whatsapp_url, phone_display, phone_tel,
        contact_email, contact_hours, testimonials, client_logos,
        legal_mentions, privacy_policy, terms_of_service,
      } = body;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.id };
      if (hero_headline !== undefined) patch.hero_headline = hero_headline;
      if (hero_accent !== undefined) patch.hero_accent = hero_accent;
      if (hero_subtitle !== undefined) patch.hero_subtitle = hero_subtitle;
      if (hero_cta_label !== undefined) patch.hero_cta_label = hero_cta_label;
      if (hero_cta_url !== undefined) patch.hero_cta_url = hero_cta_url;
      if (hero_image_url !== undefined) patch.hero_image_url = hero_image_url;
      if (hero_mobile_image_url !== undefined) patch.hero_mobile_image_url = hero_mobile_image_url;
      if (hero_mobile_visible !== undefined) patch.hero_mobile_visible = !!hero_mobile_visible;
      if (stats_label_tenants !== undefined) patch.stats_label_tenants = stats_label_tenants;
      if (stats_label_sectors !== undefined) patch.stats_label_sectors = stats_label_sectors;
      if (stats_label_uptime !== undefined) patch.stats_label_uptime = stats_label_uptime;
      if (pricing_visible !== undefined) patch.pricing_visible = pricing_visible;
      if (features !== undefined) patch.features = features;
      if (footer_tagline !== undefined) patch.footer_tagline = footer_tagline;
      if (demo_desktop !== undefined) patch.demo_desktop = demo_desktop;
      if (demo_mobile !== undefined) patch.demo_mobile = demo_mobile;
      if (why_waarwi !== undefined) patch.why_waarwi = why_waarwi;
      if (faq_items !== undefined) patch.faq_items = faq_items;
      if (section_titles !== undefined) patch.section_titles = section_titles;
      if (whatsapp_url !== undefined) patch.whatsapp_url = whatsapp_url;
      if (phone_display !== undefined) patch.phone_display = phone_display;
      if (phone_tel !== undefined) patch.phone_tel = phone_tel;
      if (contact_email !== undefined) patch.contact_email = contact_email;
      if (contact_hours !== undefined) patch.contact_hours = contact_hours;
      if (testimonials !== undefined) patch.testimonials = testimonials;
      if (client_logos !== undefined) patch.client_logos = client_logos;
      if (legal_mentions !== undefined) patch.legal_mentions = legal_mentions;
      if (privacy_policy !== undefined) patch.privacy_policy = privacy_policy;
      if (terms_of_service !== undefined) patch.terms_of_service = terms_of_service;
      const { data, error } = await admin.from("landing_config").update(patch).eq("id", "default").select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("landing_config.update", null, patch);
      return json({ success: true, config: data });
    }

    // ============ SECTOR IMAGES (landing "Secteurs" cards) ============
    if (action === "get_sectors_admin") {
      const { data, error } = await admin
        .from("business_activity_types")
        .select("id, name, slug, description, is_active, image_url, image_alt, image_position")
        .order("name");
      if (error) return json({ error: error.message }, 400);
      return json({ sectors: data || [] });
    }

    if (action === "update_sector_image") {
      const { sector_id, image_url, image_alt, image_position } = body;
      if (!sector_id) return json({ error: "sector_id requis" }, 400);
      const patch: Record<string, unknown> = {};
      if (image_url !== undefined) patch.image_url = image_url || null;
      if (image_alt !== undefined) patch.image_alt = image_alt || null;
      if (image_position !== undefined) patch.image_position = (image_position === "left" || image_position === "right") ? image_position : "center";
      const { data, error } = await admin
        .from("business_activity_types")
        .update(patch)
        .eq("id", sector_id)
        .select("id, name, slug, description, is_active, image_url, image_alt, image_position")
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("sector_image.update", sector_id, patch);
      return json({ success: true, sector: data });
    }

    if (action === "delete_sector_image") {
      const { sector_id } = body;
      if (!sector_id) return json({ error: "sector_id requis" }, 400);
      const { data, error } = await admin
        .from("business_activity_types")
        .update({ image_url: null, image_alt: null, image_position: "center" })
        .eq("id", sector_id)
        .select("id, image_url")
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("sector_image.delete", sector_id, null);
      return json({ success: true, sector: data });
    }

    // ============ SUBSCRIPTION LIFECYCLE ============
    if (action === "run_subscription_lifecycle") {
      const { data, error } = await admin.rpc("process_subscription_lifecycle");
      if (error) return json({ error: error.message }, 500);

      // Send admin alerts for newly expired tenants
      const result = data as { renewed?: number; expired?: number; suspended?: number; reminders_sent?: number };
      if ((result?.expired || 0) > 0) {
        const { data: expiredTenants } = await admin.from("tenants")
          .select("id, name, email, plan, plan_expires_at")
          .eq("subscription_status", "expired")
          .eq("is_active", true);

        for (const t of (expiredTenants || [])) {
          fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "subscription_expired_admin", tenant_id: t.id }),
          }).catch(() => {});
        }
      }

      await logEvent("subscription.lifecycle_run", null, result);
      return json({ success: true, ...result });
    }

    if (action === "update_auto_suspend_settings") {
      const { auto_suspend_enabled, auto_suspend_grace_days } = body;
      const patch: Record<string, unknown> = {};
      if (auto_suspend_enabled !== undefined) patch.auto_suspend_enabled = !!auto_suspend_enabled;
      if (auto_suspend_grace_days !== undefined) patch.auto_suspend_grace_days = Math.max(1, Math.min(90, Number(auto_suspend_grace_days) || 7));

      const { error } = await admin.from("tenants").update(patch).neq("billing_cycle", "lifetime");
      if (error) return json({ error: error.message }, 400);
      await logEvent("subscription.auto_suspend_config", null, patch);
      return json({ success: true, ...patch });
    }

    if (action === "get_auto_suspend_settings") {
      const { data } = await admin.from("tenants")
        .select("auto_suspend_enabled, auto_suspend_grace_days")
        .limit(1)
        .maybeSingle();
      return json({ auto_suspend_enabled: data?.auto_suspend_enabled || false, auto_suspend_grace_days: data?.auto_suspend_grace_days || 7 });
    }

    if (action === "send_expiration_alert") {
      const { tenant_id } = body;
      if (!tenant_id) return json({ error: "tenant_id requis" }, 400);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subscription_expired_admin", tenant_id }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: resData?.error || "Erreur envoi" }, res.status);
      await logEvent("subscription.expiration_alert_sent", tenant_id, {});
      return json({ success: true });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
