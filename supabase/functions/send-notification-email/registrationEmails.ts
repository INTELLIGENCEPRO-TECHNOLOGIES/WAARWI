type Detail = readonly [label: string, value?: string | null];
type Link = { label: string; url: string };

const logo = "https://app.waarwi.com/newlogo.png";
const titleStyle = "margin:0 0 12px;color:#171717;font-size:32px;font-weight:700;line-height:1.15;";
const linkStyle = "color:#171717;font-weight:600;text-decoration:underline;";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function registrationEmail({
  title,
  description,
  details,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  details: Detail[];
  primary: Link;
  secondary?: Link;
}): string {
  const rows = details.filter(([, value]) => value?.trim()).map(([label, value]) => `
    <tr>
      <th class="waarwi-field-label" scope="row" width="30%" align="left" valign="top" style="border-bottom:1px solid #dededb;padding:11px 12px 11px 0;color:#575757;font-size:14px;font-weight:500;line-height:1.4;">${escapeHtml(label)}</th>
      <td class="waarwi-field-value" valign="top" style="border-bottom:1px solid #dededb;padding:11px 0;color:#171717;font-size:15px;font-weight:600;line-height:1.4;word-wrap:break-word;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(value ?? "")}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} | Waarwi</title>
  <style>
    @media only screen and (max-width: 600px) {
      .waarwi-padding { padding-left: 16px !important; padding-right: 16px !important; }
      .waarwi-title { font-size: 26px !important; }
    }
    @media only screen and (max-width: 480px) {
      .waarwi-field-label, .waarwi-field-value { display: block; width: auto !important; }
      .waarwi-field-label { border-bottom: 0 !important; padding: 9px 0 2px !important; }
      .waarwi-field-value { padding: 0 0 9px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;color:#171717;font-family:Arial,'Segoe UI',sans-serif;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;mso-table-lspace:0pt;mso-table-rspace:0pt;">
    <tr><td class="waarwi-padding" bgcolor="#ffffff" style="padding:19px 24px;border-bottom:1px solid #dededb;background-color:#ffffff;">
      <img src="${logo}" width="155" height="28" alt="Waarwi" style="display:block;width:155px;height:28px;border:0;color:#171717;font-size:20px;font-weight:700;">
    </td></tr>
    <tr><td class="waarwi-padding" style="padding:24px 24px 20px;">
      <h1 class="waarwi-title" style="${titleStyle}">${escapeHtml(title)}</h1>
      <p style="margin:0;color:#575757;font-size:15px;line-height:1.55;">${escapeHtml(description)}</p>
    </td></tr>
    <tr><td class="waarwi-padding" style="padding:0 24px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" aria-label="Informations de l’inscription" style="width:100%;table-layout:fixed;border-top:1px solid #dededb;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        ${rows}
      </table>
    </td></tr>
    <tr><td class="waarwi-padding" style="padding:24px 24px;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <tr><td bgcolor="#171717" style="background-color:#171717;mso-padding-alt:12px 18px;">
          <a href="${escapeHtml(primary.url)}" style="display:inline-block;border:1px solid #171717;padding:11px 17px;color:#ffffff;font-size:14px;font-weight:700;line-height:20px;text-decoration:none;mso-padding-alt:0;">${escapeHtml(primary.label)}</a>
        </td></tr>
      </table>
      ${secondary ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.45;"><a href="${escapeHtml(secondary.url)}" style="${linkStyle}">${escapeHtml(secondary.label)}</a></p>` : ""}
    </td></tr>
    <tr><td class="waarwi-padding" style="border-top:1px solid #dededb;padding:15px 24px;color:#575757;font-size:13px;line-height:1.5;">
      <a href="https://waarwi.com" style="${linkStyle}">waarwi.com</a>
    </td></tr>
  </table>
</body>
</html>`;
}

export function newSignupAdminEmail(
  details: { company: string; email?: string | null; activity?: string | null; contact?: string | null; phone?: string | null },
  approveUrl: string,
  platformUrl: string,
): string {
  return registrationEmail({
    title: "Nouvelle inscription",
    description: "Cette entreprise attend votre validation pour accéder à son espace Waarwi.",
    details: [
      ["Entreprise", details.company],
      ["Activité", details.activity],
      ["Responsable", details.contact],
      ["E-mail", details.email],
      ["WhatsApp", details.phone],
    ],
    primary: { label: "Valider l’inscription", url: approveUrl },
    secondary: { label: "Ouvrir la console Waarwi", url: platformUrl },
  });
}

export function approvalEmail(company: string, email: string, loginUrl: string): string {
  return registrationEmail({
    title: "Inscription validée",
    description: "Votre espace Waarwi est prêt. Connectez-vous avec l’identifiant ci-dessous et le mot de passe choisi lors de l’inscription.",
    details: [["Entreprise", company], ["Identifiant", email]],
    primary: { label: "Se connecter à Waarwi", url: loginUrl },
  });
}
