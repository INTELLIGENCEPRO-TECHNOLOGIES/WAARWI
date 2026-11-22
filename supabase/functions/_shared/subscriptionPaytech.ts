const API_URL = "https://paytech.sn/api";
const encoder = new TextEncoder();
export const PAYTECH_ORDER_TABLE = "tenant_subscription_payments";

export type PayTechConfig = {
  key: string;
  secret: string;
  environment: "test" | "prod";
  appUrl: URL;
};

export type PaymentOrder = {
  id: string;
  tenant_id: string | null;
  tenant_name: string;
  plan_code: string;
  billing_cycle: "monthly" | "yearly" | "lifetime";
  purpose: "initial" | "renewal";
  amount: number;
  environment: "test" | "prod";
  state: "creating" | "pending" | "paid" | "cancelled" | "failed" | "refunded";
  provider_token: string | null;
  checkout_url: string | null;
  callback_key: string;
  subscription_id: string | null;
  review_reason: string | null;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
};

export type TerminalState = "paid" | "cancelled" | "refunded";

export function getPayTechConfig(): PayTechConfig | null {
  const key = Deno.env.get("PAYTECH_API_KEY");
  const secret = Deno.env.get("PAYTECH_API_SECRET");
  const environment = Deno.env.get("PAYTECH_ENV");
  const appUrl = Deno.env.get("WAARWI_BILLING_APP_URL");
  if (!key || !secret || !appUrl || (environment !== "test" && environment !== "prod")) return null;

  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WAARWI_BILLING_APP_URL doit être une URL HTTPS sans paramètres");
  }
  return { key, secret, environment, appUrl: url };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function exactAmount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value))) {
    return null;
  }
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

async function paytechRequest(config: PayTechConfig, path: string, body?: unknown) {
  const response = await fetch(API_URL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { API_KEY: config.key, API_SECRET: config.secret, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Réponse PayTech HTTP " + response.status);
  return record(await response.json());
}

export async function createPayTechCheckout(
  config: PayTechConfig, order: PaymentOrder, planName: string, supabaseUrl: string,
) {
  const returnUrl = new URL(config.appUrl);
  returnUrl.searchParams.set("subscription_payment", order.id);
  const ipn = new URL("/functions/v1/paytech-subscription-ipn", supabaseUrl);
  ipn.searchParams.set("payment", order.id);
  ipn.searchParams.set("key", order.callback_key);
  const cycle = { monthly: "mensuel", yearly: "annuel", lifetime: "à vie" }[order.billing_cycle];
  const itemName = "Waarwi " + planName + " · " + cycle;

  const result = await paytechRequest(config, "/payment/request-payment", {
    item_name: itemName, item_price: order.amount, currency: "XOF", ref_command: order.id,
    command_name: itemName, env: order.environment,
    ipn_url: ipn.toString(), refund_notif_url: ipn.toString(),
    success_url: returnUrl.toString(), cancel_url: returnUrl.toString(),
  });

  const token = text(result.token);
  const redirect = new URL(text(result.redirect_url) || text(result.redirectUrl));
  if (Number(result.success) !== 1 || !token || redirect.origin !== "https://paytech.sn"
      || !redirect.pathname.startsWith("/payment/checkout/") || redirect.username || redirect.password) {
    throw new Error("Demande de paiement PayTech refusée");
  }
  return { token, url: redirect.toString() };
}

const STATES: Record<string, TerminalState> = {
  sale_complete: "paid", completed: "paid", paid: "paid", payment_completed: "paid",
  sale_canceled: "cancelled", cancelled: "cancelled", canceled: "cancelled", expired: "cancelled",
  refund_complete: "refunded", refunded: "refunded",
};

export function readPayTechStatus(payload: unknown, order: PaymentOrder) {
  const response = record(payload);
  const result = record(response.result);
  const data = record(response.data);
  const payment = record(response.payment ?? data.payment ?? result.payment ?? response.data ?? response.result);
  const transactionStatus = text(payment.type_event ?? payment.payment_status ?? payment.status ?? payment.state
    ?? response.type_event ?? response.payment_status ?? response.status ?? response.state).toLowerCase();
  // The API's top-level success flag describes the API request itself.
  if (response.success === false || response.success === 0 || response.success === "0") return null;

  const ref = text(payment.ref_command ?? response.ref_command);
  const token = text(payment.token ?? payment.token_payment ?? response.token ?? response.token_payment);
  const currency = text(payment.currency ?? response.currency).toUpperCase();
  const rawAmount = payment.final_item_price_xof ?? payment.final_item_price ?? payment.item_price_xof
    ?? payment.item_price ?? payment.amount ?? response.final_item_price_xof
    ?? response.final_item_price ?? response.item_price ?? response.amount;

  // Some payment lookups use "success" for the transaction as well as for the request.
  // Accept it only when the response itself identifies this exact transaction and amount.
  const matchesOrder = ref === order.id || (!!token && token === order.provider_token);
  const state = Object.hasOwn(STATES, transactionStatus) ? STATES[transactionStatus]
    : transactionStatus === "success" && matchesOrder && exactAmount(rawAmount) === order.amount ? "paid" : null;
  if (!state) return null;

  if ((ref && ref !== order.id) || (token && token !== order.provider_token)
    || (currency && currency !== "XOF" && currency !== "FCFA")
    || (state === "paid" && rawAmount != null && exactAmount(rawAmount) !== order.amount)) {
    throw new Error("Réponse PayTech incohérente avec le paiement Waarwi");
  }

  return { state, method: text(payment.payment_method ?? response.payment_method) || null };
}

export async function getPayTechStatus(config: PayTechConfig, order: PaymentOrder) {
  if (!order.provider_token) return null;
  const query = new URLSearchParams({ token_payment: order.provider_token });
  const result = await paytechRequest(config, "/payment/get-status?" + query.toString());
  return readPayTechStatus(result, order);
}

export function equalSecret(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readPayTechNotification(
  config: PayTechConfig, order: PaymentOrder, body: Record<string, unknown>,
) {
  const event = text(body.type_event);
  if (event !== "sale_complete" && event !== "sale_canceled" && event !== "refund_complete") return null;
  if (body.ref_command !== order.id || !order.provider_token || body.token !== order.provider_token) return null;
  const currency = text(body.currency).toUpperCase();
  const amount = body.final_item_price ?? body.item_price;
  const settledAmount = body.final_item_price_xof ?? body.item_price_xof ?? amount;
  if ((currency && currency !== "XOF" && currency !== "FCFA")
    || (event === "sale_complete" && (exactAmount(amount) !== order.amount || exactAmount(settledAmount) !== order.amount))) return null;

  const signature = text(body.hmac_compute).toLowerCase();
  if (signature) {
    const signingKey = await crypto.subtle.importKey(
      "raw", encoder.encode(config.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const message = String(amount) + "|" + order.id + "|" + config.key;
    const expected = hex(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(message)));
    if (!equalSecret(expected, signature)) return null;
  } else {
    // Legacy PayTech IPNs also require the unshared, checkout-specific callback key.
    const [keyDigest, secretDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(config.key)),
      crypto.subtle.digest("SHA-256", encoder.encode(config.secret)),
    ]);
    if (!equalSecret(hex(keyDigest), text(body.api_key_sha256).toLowerCase())
      || !equalSecret(hex(secretDigest), text(body.api_secret_sha256).toLowerCase())) return null;
  }

  return { state: STATES[event], method: text(body.payment_method) || null };
}
