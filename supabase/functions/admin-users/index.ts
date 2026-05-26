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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const caller = userData.user;

    const { data: callerProfile } = await admin.from("profiles").select("*").eq("id", caller.id).maybeSingle();
    if (!callerProfile) return json({ error: "Profile not found" }, 403);

    const isSuperAdmin = callerProfile.role === "super_admin";
    const isAdmin = callerProfile.role === "admin" || isSuperAdmin;

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

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
        admin.from("tenant_subscriptions").select("amount,billing_cycle").eq("status", "active"),
        admin.from("platform_events").select("*").order("created_at", { ascending: false }).limit(10),
      ]);

      const tenants = tenantsRes.data || [];
      const byPlan: Record<string, number> = {};
      for (const t of tenants) byPlan[t.plan] = (byPlan[t.plan] || 0) + 1;
      const mrr = (mrrRes.data || []).reduce((s: number, r: any) => s + Number(r.amount || 0) / (r.billing_cycle === "yearly" ? 12 : 1), 0);

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
      const allowed = ["status", "plan", "plan_expires_at", "is_active", "name", "legal_name", "email", "phone", "business_type", "business_activity_type_id", "enabled_modules", "custom_domain", "subdomain"];
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
      const { error } = await admin.from("tenants").update({
        approval_status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: caller.id,
        is_active: true,
        status: "active",
      }).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await logEvent("tenant.approve", tenant_id, {});

      // Send approval notification email (fire-and-forget)
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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
      const { tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at, auto_renew, notes } = body;
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
      }).select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await admin.from("tenants").update({ plan: plan_code, plan_expires_at: ends_at || null, status: "active", is_active: true }).eq("id", tenant_id);
      await logEvent("subscription.create", tenant_id, { plan_code, amount });
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

    // ============ LOGIN CONFIG ============
    if (action === "get_login_config") {
      const { data } = await admin.from("platform_login_config").select("*").eq("id", "default").maybeSingle();
      return json(data || {});
    }

    if (action === "update_login_config") {
      const { headline, headline_accent, subtitle, modules } = body;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.id };
      if (headline !== undefined) patch.headline = headline;
      if (headline_accent !== undefined) patch.headline_accent = headline_accent;
      if (subtitle !== undefined) patch.subtitle = subtitle;
      if (modules !== undefined) patch.modules = modules;
      const { data, error } = await admin.from("platform_login_config").update(patch).eq("id", "default").select().maybeSingle();
      if (error) return json({ error: error.message }, 400);
      await logEvent("login_config.update", null, patch);
      return json({ success: true, config: data });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
