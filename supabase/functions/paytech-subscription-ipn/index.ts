import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  equalSecret, getPayTechConfig, isUuid, PAYTECH_ORDER_TABLE, readPayTechNotification, type PaymentOrder,
} from "../_shared/subscriptionPaytech.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment");
  const callbackKey = url.searchParams.get("key");
  if (!isUuid(paymentId) || !isUuid(callbackKey)) return new Response(null, { status: 401 });

  try {
    const config = getPayTechConfig();
    if (!config) return new Response(null, { status: 503 });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.from(PAYTECH_ORDER_TABLE).select("*").eq("id", paymentId).maybeSingle();
    if (error) throw error;
    const order = data as PaymentOrder | null;
    if (!order || !equalSecret(order.callback_key, callbackKey) || order.environment !== config.environment) {
      return new Response(null, { status: 401 });
    }
    const contentType = req.headers.get("Content-Type") ?? "";
    const body = await (contentType.includes("application/json")
      ? req.json()
      : req.formData().then(form => Object.fromEntries(form.entries()))).catch(() => null);
    if (!body || typeof body !== "object") return new Response(null, { status: 400 });

    const status = await readPayTechNotification(config, order, body);
    if (!status) return new Response(null, { status: 401 });

    const { error: recordError } = await db.rpc("record_subscription_payment_status", {
      p_id: order.id, p_token: order.provider_token, p_state: status.state,
      p_amount: order.amount, p_method: status.method,
    });
    if (recordError) throw recordError;
    return Response.json({ success: 1 });
  } catch (cause) {
    console.error("Notification PayTech Waarwi", paymentId, cause instanceof Error ? cause.message : "mise à jour indisponible");
    return new Response(null, { status: 503 });
  }
});
