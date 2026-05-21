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

function emailLayout(content: string, year: number) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAARWI</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Logo bar -->
        <tr><td style="text-align:center;padding-bottom:24px;">
          <span style="font-size:26px;font-weight:800;letter-spacing:3px;color:#0f766e;">WAARWI</span>
        </td></tr>

        <!-- Main card -->
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
            <!-- Accent bar -->
            <tr><td style="height:4px;background:linear-gradient(90deg,#0f766e 0%,#0d9488 50%,#14b8a6 100%);"></td></tr>

            <!-- Content -->
            <tr><td style="padding:44px 40px 32px;">
              ${content}
            </td></tr>

            <!-- Signature -->
            <tr><td style="padding:0 40px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:24px;">
                <tr><td>
                  <p style="margin:0 0 2px;color:#0f172a;font-size:15px;font-weight:700;">Papa D Sall</p>
                  <p style="margin:0 0 12px;color:#0f766e;font-size:13px;font-weight:600;">CEO, Waarwi</p>
                  <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                    Plateforme Business 2.0 made in S\u00e9n\u00e9gal<br>
                    <a href="https://waarwi.com" style="color:#0f766e;text-decoration:none;">waarwi.com</a>
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="text-align:center;padding-top:24px;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">
            &copy; ${year} WAARWI. Tous droits r\u00e9serv\u00e9s.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function approvalEmail(
  tenantName: string,
  tenantEmail: string,
  loginUrl: string,
  year: number
) {
  const content = `
    <h1 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:800;">
      Bienvenue sur WAARWI !
    </h1>
    <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">
      Bonjour,
    </p>
    <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">
      J'ai le plaisir de vous informer que votre compte <strong style="color:#0f172a;">${tenantName}</strong> a \u00e9t\u00e9 valid\u00e9 avec succ\u00e8s. Vous pouvez d\u00e8s maintenant acc\u00e9der \u00e0 l'ensemble des fonctionnalit\u00e9s de la plateforme.
    </p>

    <!-- Credentials box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdfa;border-radius:12px;border:1px solid #99f6e4;margin:24px 0;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 10px;color:#0f766e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
          Vos identifiants de connexion
        </p>
        <p style="margin:0 0 6px;color:#334155;font-size:14px;">
          <strong>Email :</strong> ${tenantEmail}
        </p>
        <p style="margin:0;color:#334155;font-size:14px;">
          <strong>Mot de passe :</strong> celui choisi lors de votre inscription
        </p>
      </td></tr>
    </table>

    <!-- CTA button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 24px;">
      <tr><td align="center">
        <a href="${loginUrl}" style="display:inline-block;padding:14px 40px;background-color:#0f766e;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
          Se connecter \u00e0 WAARWI
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-align:center;">
      Ou copiez ce lien : <a href="${loginUrl}" style="color:#0f766e;word-break:break-all;">${loginUrl}</a>
    </p>

    <p style="margin:24px 0 0;color:#475569;font-size:15px;line-height:1.7;">
      N'h\u00e9sitez pas \u00e0 nous contacter si vous avez la moindre question. Nous sommes l\u00e0 pour vous accompagner.
    </p>
    <p style="margin:16px 0 0;color:#475569;font-size:15px;line-height:1.7;">
      Cordialement,
    </p>`;
  return emailLayout(content, year);
}

function rejectionEmail(
  tenantName: string,
  reason: string,
  year: number
) {
  const content = `
    <h1 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:800;">
      Information sur votre inscription
    </h1>
    <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">
      Bonjour,
    </p>
    <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.7;">
      Nous avons soigneusement examin\u00e9 votre demande d'inscription pour <strong style="color:#0f172a;">${tenantName}</strong>.
    </p>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.7;">
      Apr\u00e8s \u00e9tude de votre dossier, nous ne sommes malheureusement pas en mesure de valider votre compte pour le moment.
    </p>
    ${
      reason
        ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border-radius:12px;border:1px solid #fecaca;margin:20px 0;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0 0 6px;color:#991b1b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Motif</p>
        <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6;">${reason}</p>
      </td></tr>
    </table>`
        : ""
    }
    <p style="margin:20px 0 0;color:#475569;font-size:15px;line-height:1.7;">
      Si vous pensez qu'il s'agit d'une erreur ou si vous souhaitez obtenir des pr\u00e9cisions, n'h\u00e9sitez pas \u00e0 nous contacter. Nous restons \u00e0 votre enti\u00e8re disposition.
    </p>
    <p style="margin:16px 0 0;color:#475569;font-size:15px;line-height:1.7;">
      Cordialement,
    </p>`;
  return emailLayout(content, year);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY non configur\u00e9e" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await admin.auth.getUser(
      token
    );
    if (userErr || !userData.user)
      return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!profile || profile.role !== "super_admin")
      return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const { type, tenant_id } = body;

    if (!type || !tenant_id) {
      return json({ error: "type et tenant_id requis" }, 400);
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select("name, email")
      .eq("id", tenant_id)
      .maybeSingle();

    if (!tenant || !tenant.email) {
      return json({ error: "Tenant ou email introuvable" }, 404);
    }

    const APP_URL = Deno.env.get("APP_URL") || "https://waarwi.com";
    const fromEmail =
      Deno.env.get("NOTIFICATION_FROM_EMAIL") ||
      "Papa D Sall - WAARWI <noreply@waarwi.com>";
    const year = new Date().getFullYear();

    let subject = "";
    let htmlBody = "";

    if (type === "approval") {
      subject = `${tenant.name}, votre compte WAARWI est actif !`;
      htmlBody = approvalEmail(tenant.name, tenant.email, APP_URL, year);
    } else if (type === "rejection") {
      const reason = body.reason || "";
      subject = "Information concernant votre inscription WAARWI";
      htmlBody = rejectionEmail(tenant.name, reason, year);
    } else {
      return json(
        {
          error:
            "Type de notification inconnu. Utilisez 'approval' ou 'rejection'.",
        },
        400
      );
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [tenant.email],
        subject,
        html: htmlBody,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return json(
        { error: "Erreur envoi email", details: resendData },
        resendRes.status
      );
    }

    return json({ success: true, email_id: resendData.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
