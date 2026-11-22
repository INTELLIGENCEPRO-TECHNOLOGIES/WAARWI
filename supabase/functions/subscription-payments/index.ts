import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  createPayTechCheckout, getPayTechConfiguration, getPayTechStatus, isUuid, PAYTECH_ORDER_TABLE, PayTechCheckoutRefused,
  type PaymentOrder, type PayTechConfig,
} from "../_shared/subscriptionPaytech.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CUSTOMER_FIELDS = "id,plan_code,billing_cycle,billing_months,purpose,amount,environment,state,subscription_id,review_reason,payment_method,paid_at,created_at";
const ADMIN_FIELDS = "id,tenant_id,tenant_name,plan_code,billing_cycle,billing_months,monthly_rate,purpose,amount,environment,state,subscription_id,review_reason,payment_method,paid_at,created_at";
const PAGE_SIZE = 50;

type CheckoutContext = {
  authorized: boolean;
  tenant_id?: string;
  payment_id?: string;
  reserved?: boolean;
  period_conflict?: boolean;
  period_unavailable?: boolean;
  quote?: { plan_name: string; amount: number; billing_cycle: string; purpose: string };
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!accessToken) return json({ error: "Session requise" }, 401);

  try {
    const { data: auth, error: authError } = await db.auth.getUser(accessToken);
    if (authError || !auth.user) return json({ error: "Session expirée" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const { config, missing, invalid } = getPayTechConfiguration();
    const checkoutPaused = !config || Deno.env.get("WAARWI_PAYTECH_CHECKOUT_ENABLED")?.trim() !== "true";

    async function reconcile(order: PaymentOrder, provider: PayTechConfig) {
      const status = await getPayTechStatus(provider, order);
      if (!status) return false;
      const { error } = await db.rpc("record_subscription_payment_status", {
        p_id: order.id, p_token: order.provider_token, p_state: status.state,
        p_amount: order.amount, p_method: status.method,
      });
      if (error) throw error;
      return true;
    }

    if (action === "admin_list" || action === "admin_reconcile") {
      const { data: profile, error } = await db.from("profiles").select("role,is_active")
        .eq("id", auth.user.id).maybeSingle();
      if (error) throw error;
      if (profile?.role !== "super_admin" || profile.is_active === false) {
        return json({ error: "Accès réservé à l’administration Waarwi" }, 403);
      }

      if (action === "admin_reconcile") {
        if (!isUuid(body.payment_id)) return json({ error: "Référence invalide" }, 400);
        const { data, error: lookupError } = await db.from(PAYTECH_ORDER_TABLE).select("*")
          .eq("id", body.payment_id).maybeSingle();
        if (lookupError) throw lookupError;
        const order = data as PaymentOrder | null;
        if (!order) return json({ error: "Paiement introuvable" }, 404);
        if (!config || config.environment !== order.environment) {
          return json({ error: "Le compte PayTech de ce paiement est indisponible" }, 409);
        }
        return json({ verified: await reconcile(order, config) });
      }

      const page = Number.isSafeInteger(body.page) && body.page >= 0 && body.page < 10_000 ? body.page : 0;
      const environment = body.environment === "test" ? "test" : "prod";
      let query = db.from(PAYTECH_ORDER_TABLE).select(ADMIN_FIELDS, { count: "exact" }).eq("environment", environment);
      const search = typeof body.search === "string" ? body.search.trim().slice(0, 80) : "";
      if (isUuid(search)) query = query.eq("id", search);
      else if (search) query = query.ilike("tenant_name", "%" + search.replace(/[%_\\]/g, "\\$&") + "%");

      const state = body.state;
      if (state === "open") query = query.in("state", ["creating", "pending"]);
      else if (state === "review") query = query.not("review_reason", "is", null);
      else if (["paid", "cancelled", "failed", "refunded"].includes(state)) query = query.eq("state", state);

      const from = typeof body.from === "string" ? body.from : "";
      const through = typeof body.through === "string" ? body.through : "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("activity_at", from + "T00:00:00Z");
      if (/^\d{4}-\d{2}-\d{2}$/.test(through)) query = query.lte("activity_at", through + "T23:59:59.999999Z");

      const { data, count, error: listError } = await query.order("activity_at", { ascending: false })
        .order("id", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (listError) throw listError;
      return json({
        payments: data, total: count ?? 0, page_size: PAGE_SIZE,
        environment: config?.environment ?? null, checkout_paused: checkoutPaused, configuration: { missing, invalid },
      });
    }

    if (action !== "context" && action !== "start" && action !== "reconcile") {
      return json({ error: "Action inconnue" }, 400);
    }
    if (action === "start" && checkoutPaused) {
      return json({ error: "Fonctionnalité en cours de développement", checkout_paused: true }, 503);
    }
    if (action === "reconcile" && !config) {
      return json({ error: "Le compte PayTech de ce paiement est indisponible" }, 503);
    }
    const environment = config?.environment ?? "prod";
    const billingMonths = action === "start" ? body.billing_months ?? null : null;
    if (billingMonths !== null && ![1, 3, 6, 12].includes(billingMonths)) {
      return json({ error: "Choisis une durée de paiement proposée par Waarwi." }, 400);
    }

    async function prepare(reserve = false) {
      const { data, error } = await db.rpc("prepare_subscription_payment", {
        p_actor_id: auth.user!.id, p_environment: environment, p_reserve: reserve,
        p_billing_months: billingMonths,
      });
      if (error) throw error;
      return data as CheckoutContext;
    }

    let context = await prepare(action === "start");
    if (!context.authorized || !context.tenant_id) return json({ enabled: false }, 403);
    const requestedId = isUuid(body.payment_id) ? body.payment_id : null;

    if (context.period_unavailable) {
      return json({ error: "Cette durée est indisponible pour ton abonnement." }, 400);
    }
    if (context.period_conflict) {
      return json({ error: "Un paiement est déjà ouvert pour une autre durée. Actualise la page pour reprendre ce paiement." }, 409);
    }

    if (action === "start" && config && context.reserved && context.payment_id && context.quote) {
      const { data, error } = await db.from(PAYTECH_ORDER_TABLE).select("*").eq("id", context.payment_id).single();
      if (error) throw error;
      const order = data as PaymentOrder;

      try {
        const checkout = await createPayTechCheckout(config, order, context.quote.plan_name, supabaseUrl);
        const { data: updated, error: saveError } = await db.from(PAYTECH_ORDER_TABLE)
          .update({ state: "pending", provider_token: checkout.token, checkout_url: checkout.url, updated_at: new Date().toISOString() })
          .eq("id", order.id).eq("state", "creating").select("id").maybeSingle();
        if (saveError || !updated) throw saveError ?? new Error("Réservation expirée");
        return json({ checkout_url: checkout.url });
      } catch (cause) {
        console.error("Création du paiement Waarwi impossible", order.id, cause instanceof Error ? cause.message : "erreur de stockage");
        await db.from(PAYTECH_ORDER_TABLE).update({ state: "failed", updated_at: new Date().toISOString() })
          .eq("id", order.id).eq("state", "creating");
        if (cause instanceof PayTechCheckoutRefused) {
          return json({ error: "PayTech a refusé l’ouverture du paiement. Contacte l’équipe Waarwi." }, 502);
        }
        return json({ error: "Impossible d’ouvrir PayTech. Réessaie dans quelques instants." }, 502);
      }
    }

    if (action === "start") {
      if (!context.payment_id) {
        return json({ error: "Aucun abonnement à payer pour le moment." }, 409);
      }
      const { data: payment, error } = await db.from(PAYTECH_ORDER_TABLE).select("state,checkout_url")
        .eq("id", context.payment_id).eq("tenant_id", context.tenant_id).eq("environment", environment).maybeSingle();
      if (error) throw error;
      if (payment?.state === "pending" && payment.checkout_url) return json({ checkout_url: payment.checkout_url });
      return json({ error: payment?.state === "creating"
        ? "Le paiement est en cours de préparation. Actualise son statut."
        : "Aucun abonnement à payer pour le moment." }, 409);
    }

    if (action === "reconcile" && config && (requestedId || context.payment_id)) {
      const { data, error } = await db.from(PAYTECH_ORDER_TABLE).select("*")
        .eq("id", requestedId ?? context.payment_id!)
        .eq("tenant_id", context.tenant_id).eq("environment", environment).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Paiement introuvable" }, 404);
      if (data.state === "pending" || data.state === "cancelled") {
        await reconcile(data as PaymentOrder, config);
        context = await prepare();
      }
    }

    const targetId = requestedId ?? context.payment_id;
    let lookup = db.from(PAYTECH_ORDER_TABLE).select(CUSTOMER_FIELDS)
      .eq("tenant_id", context.tenant_id!).eq("environment", environment);
    if (targetId) lookup = lookup.eq("id", targetId);
    const { data: payment, error } = await lookup.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;

    return json({ enabled: true, environment, checkout_paused: checkoutPaused, quote: context.quote ?? null, payment });
  } catch (cause) {
    console.error("Paiements d’abonnement Waarwi", cause instanceof Error ? cause.message : "requête impossible");
    return json({ error: "Le statut du paiement est temporairement indisponible." }, 502);
  }
});
