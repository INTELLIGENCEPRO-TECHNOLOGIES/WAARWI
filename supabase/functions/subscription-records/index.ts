import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const PAGE_SIZE = 12;
const PERIOD_FIELDS = "id,plan_code,billing_cycle,status,started_at,ends_at";
const PAYMENT_FIELDS = "id,tenant_name,plan_code,billing_cycle,billing_months,purpose,amount,state,paid_at,payment_method,subscription_id,review_reason";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

async function authorizedTenant(db: SupabaseClient, userId: string) {
  const { data: profile, error: profileError } = await db.from("profiles").select("tenant_id")
    .eq("id", userId).eq("role", "admin").not("is_active", "is", false).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.tenant_id) return null;

  const { data: tenant, error: tenantError } = await db.from("tenants").select("id,owner_user_id")
    .eq("id", profile.tenant_id).maybeSingle();
  if (tenantError) throw tenantError;
  return tenant && (tenant.owner_user_id === null || tenant.owner_user_id === userId) ? tenant.id : null;
}

async function planNames(db: SupabaseClient, codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const { data, error } = await db.from("plans").select("code,name").in("code", [...new Set(codes)]);
  if (error) throw error;
  return new Map(data.map(plan => [plan.code, plan.name]));
}

async function linkedPeriods(db: SupabaseClient, tenantId: string, ids: (string | null)[]) {
  const keys = [...new Set(ids.filter((id): id is string => id !== null))];
  if (!keys.length) return new Map<string, { started_at: string; ends_at: string | null }>();
  const { data, error } = await db.from("tenant_subscriptions").select("id,started_at,ends_at")
    .eq("tenant_id", tenantId).in("id", keys);
  if (error) throw error;
  return new Map(data.map(({ id, ...period }) => [id, period]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "Session requise" }, 401);

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Session expirée" }, 401);
    const tenantId = await authorizedTenant(db, auth.user.id);
    if (!tenantId) return json({ error: "Accès réservé au responsable de l’abonnement." }, 403);

    const body = await req.json().catch(() => null);
    if (body?.action === "receipt") {
      const id = body.payment_id;
      if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        return json({ error: "Référence du reçu invalide." }, 400);
      }
      const { data: payment, error } = await db.from("tenant_subscription_payments").select(PAYMENT_FIELDS)
        .eq("tenant_id", tenantId).eq("id", id).eq("environment", "prod")
        .eq("state", "paid").not("paid_at", "is", null).maybeSingle();
      if (error) throw error;
      if (!payment?.paid_at) return json({ error: "Reçu indisponible pour ce paiement." }, 404);

      const [names, periods, { renderReceipt }] = await Promise.all([
        planNames(db, [payment.plan_code]),
        linkedPeriods(db, tenantId, [payment.subscription_id]),
        import("./receipt.ts"),
      ]);
      const pdf = await renderReceipt({
        ...payment,
        paid_at: payment.paid_at,
        plan_name: names.get(payment.plan_code) ?? payment.plan_code,
        period: periods.get(payment.subscription_id ?? "") ?? null,
      });
      return json({ pdf });
    }

    if (body?.action !== "history" || !["periods", "payments"].includes(body.section)
      || !Number.isSafeInteger(body.page) || body.page < 0 || body.page >= 10_000) {
      return json({ error: "Demande d’historique invalide." }, 400);
    }

    const from = body.page * PAGE_SIZE;
    if (body.section === "periods") {
      const { data, error } = await db.from("tenant_subscriptions").select(PERIOD_FIELDS)
        .eq("tenant_id", tenantId).order("started_at", { ascending: false })
        .order("id", { ascending: false }).range(from, from + PAGE_SIZE);
      if (error) throw error;
      const rows = data.slice(0, PAGE_SIZE);
      const names = await planNames(db, rows.map(row => row.plan_code));
      return json({
        periods: rows.map(row => ({ ...row, plan_name: names.get(row.plan_code) ?? row.plan_code })),
        has_more: data.length > PAGE_SIZE,
      });
    }

    const { data, error } = await db.from("tenant_subscription_payments").select(PAYMENT_FIELDS)
      .eq("tenant_id", tenantId).eq("environment", "prod").in("state", ["paid", "refunded"])
      .not("paid_at", "is", null).order("paid_at", { ascending: false })
      .order("id", { ascending: false }).range(from, from + PAGE_SIZE);
    if (error) throw error;
    const rows = data.slice(0, PAGE_SIZE);
    const [names, periods] = await Promise.all([
      planNames(db, rows.map(row => row.plan_code)),
      linkedPeriods(db, tenantId, rows.map(row => row.subscription_id)),
    ]);
    return json({
      payments: rows.map(({ tenant_name: _tenantName, ...row }) => ({
        ...row,
        environment: "prod",
        plan_name: names.get(row.plan_code) ?? row.plan_code,
        period: periods.get(row.subscription_id ?? "") ?? null,
      })),
      has_more: data.length > PAGE_SIZE,
    });
  } catch (cause) {
    console.error("Historique des abonnements Waarwi", cause instanceof Error ? cause.message : "requête impossible");
    return json({ error: "Les documents de votre abonnement sont temporairement indisponibles." }, 502);
  }
});
