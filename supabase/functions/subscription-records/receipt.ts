import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { receiptFont } from "./receiptFont.ts";

export type ReceiptDetails = {
  id: string;
  tenant_name: string;
  plan_code: string;
  plan_name: string;
  billing_cycle: string;
  billing_months: number | null;
  purpose: string;
  amount: number;
  paid_at: string;
  payment_method: string | null;
  period: { started_at: string; ends_at: string | null } | null;
};

const date = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long", timeStyle: "short", timeZone: "Africa/Dakar",
});
const money = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const dark = rgb(0.09, 0.09, 0.09);
const muted = rgb(0.36, 0.36, 0.36);

export async function renderReceipt(details: ReceiptDetails) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Reçu Waarwi – ${details.id}`);
  pdf.setAuthor("Waarwi");
  pdf.setCreationDate(new Date(details.paid_at));
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(receiptFont, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const left = 48;
  const width = 499;
  const makePage = () => pdf.addPage([595, 842]);
  let page = makePage();
  let y = 784;

  function drawLine(text: string, size: number, color = dark) {
    if (y < 85) {
      page = makePage();
      y = 784;
    }
    page.drawText(text, { x: left, y, size, font, color });
    y -= size + 7;
  }

  function drawText(value: string, size: number, color = dark) {
    const text = [...value.normalize("NFC").replace(/\s+/g, " ").trim()]
      .map(char => supported.has(char.codePointAt(0)!) ? char : "?").join("");
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) drawLine(line, size, color);
      line = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width) {
          drawLine(line, size, color);
          line = "";
        }
        line += char;
      }
    }
    if (line) drawLine(line, size, color);
  }

  function field(label: string, value: string) {
    drawText(label, 10, muted);
    drawText(value, 13);
    y -= 10;
  }

  drawText("Waarwi", 24);
  drawText("Reçu de paiement", 29);
  drawText("Abonnement Waarwi", 11, muted);
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, color: rgb(0.84, 0.84, 0.84), thickness: 0.8 });
  y -= 30;

  const duration = details.billing_cycle === "lifetime" ? "À vie"
    : `${details.billing_months ?? (details.billing_cycle === "yearly" ? 12 : 1)} mois`;
  const plan = details.plan_name === details.plan_code ? details.plan_name
    : `${details.plan_name} (${details.plan_code})`;

  field("Référence du paiement", details.id);
  field("Entreprise", details.tenant_name);
  field("Abonnement", `${plan} · ${duration} · ${details.purpose === "renewal" ? "Renouvellement" : "Premier paiement"}`);
  field("Période d’abonnement", details.period
    ? `Du ${date.format(new Date(details.period.started_at))}${details.period.ends_at ? ` au ${date.format(new Date(details.period.ends_at))}` : " · Sans échéance"}`
    : "En attente de rattachement à une période d’abonnement");
  field("Paiement confirmé le", date.format(new Date(details.paid_at)));
  field("Mode de paiement", details.payment_method ? `${details.payment_method} via PayTech` : "PayTech");
  drawText("Montant payé", 10, muted);
  drawText(`${money.format(details.amount)} FCFA`, 23);

  for (const item of pdf.getPages()) {
    item.drawText("Waarwi  ·  app.waarwi.com", { x: left, y: 44, size: 9, font, color: muted });
  }
  return pdf.saveAsBase64();
}
