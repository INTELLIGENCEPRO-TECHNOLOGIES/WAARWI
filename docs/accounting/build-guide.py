"""Build the two accounting guides (Python + reportlab + Noto Sans)."""

from dataclasses import dataclass
from html import escape
import os
from pathlib import Path
import re
from textwrap import dedent
import unicodedata

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public" / "guides"
TITLE = "Guide utilisateur de la comptabilité"
REVISION = "Édition du 27 novembre 2026"
DESCRIPTION = (
    "Saisir et contrôler les écritures, rapprocher la banque, "
    "réviser les comptes et préparer les clôtures et les états financiers."
)
FONT_DIR = Path("/usr/share/fonts/truetype/noto")
INK = colors.HexColor("#141414")
SUB = colors.HexColor("#505050")
LINE = colors.HexColor("#cecece")
SOFT = colors.HexColor("#f4f4f4")
DARK_BAND = colors.HexColor("#222222")
SLUGS = {
    "Créer et maintenir les modèles de saisie": "modeles-de-saisie",
    "Appeler un modèle et traiter une échéance": "appeler-un-modele",
    "Rapprocher une banque │ préparer le relevé": "rapprochement-releves",
    "Rapprocher une banque │ pointer les opérations": "rapprochement-pointage",
    "Rapprocher une banque │ contrôler et valider": "rapprochement-controle",
}


@dataclass
class Chapter:
    title: str
    route: str
    blocks: list

    @property
    def key(self):
        plain = unicodedata.normalize("NFKD", self.title).encode("ascii", "ignore").decode()
        return SLUGS.get(self.title, re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-"))


def parse_chapters(source):
    chapters = []
    for section in re.split(r"(?m)^# ", source.replace("—", "-").strip())[1:]:
        title, route_line, body = section.strip().split("\n", 2)
        if not route_line.startswith("@ "):
            raise ValueError(f"Missing route for {title}")
        blocks = []
        lines = iter(body.strip().splitlines())
        pending = next(lines, None)
        while pending is not None:
            line, pending = pending, next(lines, None)
            if not line:
                continue
            if line.startswith("## "):
                blocks.append(("heading", line[3:]))
            elif line.startswith("> "):
                blocks.append(("notice", line[2:].split(" | ", 1)))
            elif line.startswith("| "):
                table = [line.strip("|").split("|")]
                while pending and pending.startswith("| "):
                    table.append(pending.strip("|").split("|"))
                    pending = next(lines, None)
                blocks.append(("table", [[cell.strip() for cell in row] for row in table]))
            elif re.match(r"^\d+\. ", line):
                steps = [line.split(". ", 1)[1]]
                while pending and re.match(r"^\d+\. ", pending):
                    steps.append(pending.split(". ", 1)[1])
                    pending = next(lines, None)
                blocks.append(("steps", steps))
            else:
                blocks.append(("paragraph", line))
        chapters.append(Chapter(title, route_line[2:], blocks))
    if len({item.key for item in chapters}) != len(chapters):
        raise ValueError("Duplicate chapter anchor")
    return chapters


def inline(text, *, pdf=False):
    safe = escape(text, quote=False)
    element = "b" if pdf else "strong"
    marked = re.sub(r"\*\*(.+?)\*\*", rf"<{element}>\1</{element}>", safe)
    return marked.replace("│", '<font name="NotoSeparator">│</font>') if pdf else marked


def style(name, size, leading, *, font="Noto", color=INK):
    return ParagraphStyle(name, fontName=font, fontSize=size, leading=leading,
                          textColor=color, alignment=TA_LEFT, splitLongWords=True)


def make_pdf(chapters, target):
    pdfmetrics.registerFont(TTFont("Noto", FONT_DIR / "NotoSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("NotoBold", FONT_DIR / "NotoSans-Bold.ttf"))
    pdfmetrics.registerFontFamily("Noto", normal="Noto", bold="NotoBold")
    pdfmetrics.registerFont(TTFont("NotoSeparator", FONT_DIR / "NotoSansMono-Regular.ttf"))
    width, height = A4
    margin = 55
    avail = width - 2 * margin
    os.environ.setdefault("SOURCE_DATE_EPOCH", "1795737600")
    rendered = Canvas(str(target), pagesize=A4, invariant=True, lang="fr-SN")
    rendered.setTitle(TITLE + " │ Waarwi")
    rendered.setCreator("Waarwi │ IntelligencePro Technologies")
    rendered.setAuthor("IntelligencePro Technologies")
    rendered.setSubject("Procédures et écrans du module Comptabilité de Waarwi")
    rendered.showOutline()
    styles = {
        "headline": style("Titre", 30, 36, font="NotoBold"),
        "cover": style("Couverture", 50, 58, font="NotoBold"),
        "intro": style("Introduction", 15, 22, color=SUB),
        "route": style("Parcours", 9, 13, color=SUB),
        "heading": style("Intertitre", 13, 17, font="NotoBold"),
        "body": style("Corps", 10.3, 14.55),
        "cell": style("Cellule", 9.3, 13),
        "cell-head": style("En-tête de tableau", 9.3, 13, font="NotoBold", color=colors.white),
    }

    def paragraph(value, selector):
        return Paragraph(inline(value, pdf=True), styles[selector])

    def put(value, selector, y, x=margin, box=avail):
        flow = paragraph(value, selector)
        _, h = flow.wrap(box, height)
        flow.drawOn(rendered, x, y - h)
        return y - h

    def frame(page, label="Comptabilité"):
        rendered.setStrokeColor(LINE)
        rendered.setLineWidth(0.55)
        rendered.line(margin, height - 52, width - margin, height - 52)
        rendered.line(margin, 52, width - margin, 52)
        rendered.setFont("NotoBold", 10)
        rendered.setFillColor(INK)
        rendered.drawString(margin, height - 39, "WAARWI")
        rendered.setFont("Noto", 8.5)
        rendered.setFillColor(SUB)
        rendered.drawRightString(width - margin, height - 39, label)
        rendered.drawString(margin, 34, "Sommaire")
        rendered.linkRect("Sommaire", "sommaire", (margin, 30, margin + 52, 45), relative=0, thickness=0)
        rendered.drawRightString(width - margin, 34, f"{page} / {len(chapters) + 2}")

    rendered.bookmarkPage("couverture")
    rendered.addOutlineEntry("Couverture", "couverture", level=0)
    rendered.drawImage(
        ImageReader(str(ROOT / "public" / "icone.png")), margin - 4, height - 168,
        74, 74, mask="auto", preserveAspectRatio=True,
    )
    rendered.setFont("NotoBold", 20)
    rendered.setFillColor(INK)
    rendered.drawString(margin + 82, height - 138, "WAARWI")
    rendered.setStrokeColor(INK)
    rendered.setLineWidth(0.8)
    rendered.line(margin, height - 185, width - margin, height - 185)
    y = put("Guide utilisateur", "cover", height - 217)
    y = put("de la comptabilité", "cover", y)
    rendered.setStrokeColor(LINE)
    rendered.line(margin, y - 30, width - margin, y - 30)
    y = put(DESCRIPTION, "intro", y - 55, box=avail - 35)
    y = put("Entreprises │ gestionnaires │ équipes comptables", "route", y - 33)
    rendered.setFont("Noto", 9)
    rendered.setFillColor(SUB)
    rendered.drawString(margin, 79, REVISION)
    rendered.setFont("NotoBold", 9)
    rendered.setFillColor(INK)
    rendered.drawString(margin, 59, "IntelligencePro Technologies")
    rendered.showPage()

    rendered.bookmarkPage("sommaire")
    rendered.addOutlineEntry("Sommaire", "sommaire", level=0)
    frame(2, "Guide utilisateur")
    y = put("Sommaire", "headline", height - 78)
    y = put("Sélectionnez un chapitre pour ouvrir la procédure.", "route", y - 7) - 19
    for number, chapter in enumerate(chapters, 3):
        row_height = 29
        rendered.setStrokeColor(LINE)
        rendered.setLineWidth(0.45)
        rendered.line(margin, y - row_height, width - margin, y - row_height)
        rendered.setFillColor(SUB)
        rendered.setFont("Noto", 9)
        rendered.drawRightString(width - margin, y - 17, f"{number:02d}")
        put(chapter.title, "body", y - 7, box=avail - 31)
        rendered.linkRect(chapter.title, chapter.key, (margin, y - row_height, width - margin, y), relative=0, thickness=0)
        y -= row_height
    if y < 65:
        raise ValueError("Sommaire trop long")
    rendered.showPage()

    def render_table(rows, y):
        fractions = {2: (0.34, 0.66), 3: (0.26, 0.37, 0.37), 4: (0.20, 0.35, 0.22, 0.23)}[len(rows[0])]
        cells = [[paragraph(c, "cell-head" if i == 0 else "cell") for c in row] for i, row in enumerate(rows)]
        grid = Table(cells, colWidths=[avail * f for f in fractions], hAlign="LEFT")
        grid.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, 0), DARK_BAND),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), (colors.white, SOFT)),
            ("LINEBELOW", (0, 1), (-1, -1), 0.35, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        _, h = grid.wrap(avail, height)
        grid.drawOn(rendered, margin, y - h)
        return y - h - 10

    for page, chapter in enumerate(chapters, 3):
        rendered.bookmarkPage(chapter.key)
        rendered.addOutlineEntry(chapter.title, chapter.key, level=0)
        frame(page)
        y = put(chapter.route, "route", height - 77)
        y = put(chapter.title, "headline", y - 8) - 17
        for kind, value in chapter.blocks:
            if kind == "heading":
                y = put(value, kind, y - 3) - 6
            elif kind == "paragraph":
                y = put(value, "body", y) - 10
            elif kind == "steps":
                for idx, step in enumerate(value, 1):
                    put(str(idx) + ".", "body", y, box=18)
                    y = put(step, "body", y, margin + 21, avail - 21) - 4.5
                y -= 6
            elif kind == "table":
                y = render_table(value, y)
            elif kind == "notice":
                heading, body = value
                heading_height = paragraph(heading, "heading").wrap(avail - 28, height)[1]
                body_height = paragraph(body, "body").wrap(avail - 28, height)[1]
                h = heading_height + body_height + 30
                rendered.setFillColor(SOFT)
                rendered.rect(margin, y - h, avail, h, fill=1, stroke=0)
                rendered.setFillColor(DARK_BAND)
                rendered.rect(margin, y - h, 2, h, fill=1, stroke=0)
                put(body, "body", put(heading, "heading", y - 12, margin + 14, avail - 28) - 4,
                    margin + 14, avail - 28)
                y -= h + 10
        if y < 63:
            raise ValueError(f"Page {page} ({chapter.title}) exceeds the footer by {63 - y:.0f} pt")
        rendered.showPage()
    rendered.save()


CSS = """
:root{font:normal 100%/1.6 Inter,system-ui,sans-serif;color:#151515;background:#fff;color-scheme:light}
*{box-sizing:border-box}
body{margin:0}
a{color:inherit;text-underline-offset:.2em}
a:focus-visible{outline:2px solid #202020;outline-offset:3px}
.skip{position:fixed;left:.5rem;top:.5rem;background:#fff;padding:.55rem .85rem;transform:translateY(-140%);z-index:5}
.skip:focus{transform:none}
.site{display:flex;justify-content:space-between;align-items:center;gap:.8rem 1.3rem;flex-wrap:wrap;padding:.7rem max(1rem,calc((100% - 74rem)/2));border-bottom:1px solid #dedede}
.brand{display:flex;align-items:center;gap:.45rem;text-decoration:none;font-size:.95rem;font-weight:800;letter-spacing:.05em}
.brand img{width:2rem;height:2rem}
.download{padding:.45rem .73rem;border:1px solid #151515;border-radius:.3rem;text-decoration:none;font-size:.84rem;font-weight:680}
.download:hover{background:#151515;color:#fff}
.layout{max-width:74rem;margin:auto;display:grid;grid-template-columns:16rem minmax(0,1fr);gap:3rem;padding:0 1rem 4rem}
aside{position:sticky;top:1rem;max-height:calc(100dvh - 2rem);overflow:auto;align-self:start}
.toc-title{margin:0 0 .55rem;font-size:1rem}
.toc{list-style:none;margin:0;padding:0}
.toc a{display:block;padding:.35rem .15rem;font-size:.875rem;line-height:1.4;text-decoration:none}
.toc a:hover{text-decoration:underline}
main{max-width:53rem;min-width:0}
.intro{grid-column:1/-1;padding:2.3rem 0 1.45rem;border-bottom:1px solid #d8d8d8}
h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:750;line-height:1.04;letter-spacing:-.035em;margin:.4rem 0 .9rem}
h2{font-size:clamp(1.65rem,3vw,2.25rem);line-height:1.15;letter-spacing:-.025em;margin:.35rem 0 1.15rem}
h3{font-size:1.18rem;line-height:1.4;margin:1.5rem 0 .35rem}
p{margin:.45rem 0 .8rem}
.route,.edition{margin:0;color:#515151;font-size:.85rem}
section{padding:2.2rem 0;border-bottom:1px solid #d8d8d8;scroll-margin-top:1rem}
section ol{margin:.35rem 0 1.25rem;padding-left:1.5rem}
section li{margin:.45rem 0;padding-left:.25rem}
table{border-collapse:collapse;width:100%;font-size:.92rem;table-layout:fixed;margin:.9rem 0 1.25rem}
th,td{padding:.55rem .65rem;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #dadada}
th{background:#222;color:#fff}
tbody tr:nth-child(even){background:#f5f5f5}
table.is-pair th:first-child{width:34%}
.note{border-left:3px solid #222;background:#f5f5f5;margin:1.15rem 0;padding:.8rem 1rem}
.note p{margin:.28rem 0 0}
.back{display:inline-block;margin-top:1.15rem;font-size:.88rem}
@media(max-width:800px){.layout{display:block;max-width:45rem;padding-top:0}.intro{padding-top:1.1rem;margin-bottom:1rem}aside{position:static;max-height:none;border-bottom:1px solid #ddd;margin-bottom:1.5rem;padding-bottom:1rem}.toc{columns:2;column-gap:1.25rem}.toc li{break-inside:avoid}}
@media(max-width:440px){.toc{columns:1}.toc a{padding:.48rem 0}th,td{padding:.4rem;font-size:.8rem}.site{gap:.55rem}.download{padding:.35rem .5rem}section{padding:1.65rem 0}}
"""


def make_html(chapters, target):
    links = "\n".join(f'<li><a href="#{c.key}">{escape(c.title)}</a></li>' for c in chapters)
    sections = []
    for chapter in chapters:
        out = [f'<section id="{chapter.key}" aria-labelledby="{chapter.key}-titre">',
               f'<p class="route">{escape(chapter.route)}</p>',
               f'<h2 id="{chapter.key}-titre">{escape(chapter.title)}</h2>']
        for kind, value in chapter.blocks:
            if kind == "heading":
                out.append(f"<h3>{inline(value)}</h3>")
            elif kind == "paragraph":
                out.append(f"<p>{inline(value)}</p>")
            elif kind == "steps":
                out.append("<ol>" + "".join(f"<li>{inline(step)}</li>" for step in value) + "</ol>")
            elif kind == "notice":
                out.append(f'<div class="note">{inline(value[0])}<p>{inline(value[1])}</p></div>')
            elif kind == "table":
                head, *rows = value
                table_class = ' class="is-pair"' if len(head) == 2 else ""
                out.append(f"<table{table_class}><thead><tr>" +
                           "".join(f'<th scope="col">{inline(c)}</th>' for c in head) +
                           "</tr></thead><tbody>" +
                           "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>"
                                   for row in rows) + "</tbody></table>")
        out.append('<a class="back" href="#sommaire">Revenir au sommaire</a></section>')
        sections.append("\n".join(out))
    text = dedent(f"""\
    <!doctype html>
    <html lang="fr-SN">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{TITLE} │ Waarwi</title>
    <meta name="description" content="{escape(DESCRIPTION)}">
    <style>{CSS}</style>
    </head>
    <body>
    <a class="skip" href="#contenu">Aller au contenu</a>
    <header class="site" id="haut">
    <a class="brand" href="#haut"><img src="../icone.png" alt="">WAARWI</a>
    <a class="download" href="./guide-comptabilite-waarwi.pdf" download="Guide-comptabilite-Waarwi.pdf">Télécharger le PDF</a>
    </header>
    <div class="layout">
    <header class="intro"><p class="edition">{REVISION}</p>
    <h1>{TITLE}</h1>
    <p>{DESCRIPTION}</p></header>
    <aside id="sommaire">
    <nav aria-labelledby="sommaire-titre"><h2 class="toc-title" id="sommaire-titre">Sommaire</h2>
    <ul class="toc">{links}</ul>
    </nav>
    </aside>
    <main id="contenu">
    {''.join(sections)}
    </main>
    </div>
    </body>
    </html>
    """)
    target.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    chapters = parse_chapters(Path(__file__).with_name("guide-utilisateur.md").read_text(encoding="utf-8"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    make_pdf(chapters, OUTPUT / "guide-comptabilite-waarwi.pdf")
    make_html(chapters, OUTPUT / "guide-comptabilite-waarwi.html")
