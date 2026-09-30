"""Generate SYNTHETIC sample project PDFs for the demo (no real data).

    python -m database.generate_sample_pdfs

demo_pdfs/MPLADS-PN-001_Progress_Report.pdf   clean report (tables, 4 pages) - the headline demo project
demo_pdfs/MPLADS-PC-002_Field_Report_messy.pdf messy report (text lines, missing/invalid values) - shows warnings
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parents[1] / "demo_pdfs"

FONT, FONT_BOLD, RS = "Helvetica", "Helvetica-Bold", "Rs."
for reg, bold in [(r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
                  ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")]:
    if os.path.exists(reg) and os.path.exists(bold):
        pdfmetrics.registerFont(TTFont("DemoSans", reg))
        pdfmetrics.registerFont(TTFont("DemoSans-Bold", bold))
        FONT, FONT_BOLD, RS = "DemoSans", "DemoSans-Bold", "\u20b9"
        break

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], fontName=FONT_BOLD, fontSize=16, spaceAfter=4)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName=FONT_BOLD, fontSize=12, spaceBefore=8, spaceAfter=4,
                    textColor=colors.HexColor("#1e3a5f"))
BODY = ParagraphStyle("BODY", parent=styles["BodyText"], fontName=FONT, fontSize=9.5, leading=13)
SMALL = ParagraphStyle("SMALL", parent=BODY, fontSize=8, textColor=colors.grey, alignment=TA_CENTER)
CELL = ParagraphStyle("CELL", parent=BODY, fontSize=9.5, leading=12)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName=FONT_BOLD)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.grey)
    canvas.drawString(20 * mm, 10 * mm, "SYNTHETIC DEMONSTRATION DOCUMENT - not a real government record")
    canvas.drawRightString(190 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def kv_table(rows, col_widths=(55 * mm, 115 * mm)):
    data = [[Paragraph(k, CELLB), Paragraph(v, CELL)] for k, v in rows]
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9aa5b1")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def grid_table(header, rows, widths):
    data = [[Paragraph(h, CELLB) for h in header]] + [[Paragraph(str(c), CELL) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9aa5b1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dfe7f1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def fmt(d: date) -> str:
    return d.strftime("%d %b %Y")


def clean_report(path: Path, as_of: date):
    """Dates are offsets from `as_of` so the demo PDF always looks current (delay stays 180 days)."""
    off = lambda days: fmt(as_of + timedelta(days=days))
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title="MPLADS-PN-001 Progress Report", author="Synthetic Demo")
    s = []
    # ---------------- page 1
    s += [Paragraph("MPLADS Project Sanction &amp; Progress Report", H1),
          Paragraph("Ministry of Statistics &amp; Programme Implementation - Local Area Development (synthetic demo format)", SMALL),
          Spacer(1, 6), Paragraph("1. Project Information", H2)]
    s.append(kv_table([
        ("Project ID", "MPLADS-PN-001"),
        ("Project Name", "Road Development \u2014 Pune"),
        ("Category", "Road Development"),
        ("Location", "Sinhagad Road, Ward 34, Pune"),
        ("District", "Pune"),
        ("Constituency", "Pune"),
        ("Implementing Agency", "Municipal Works Department"),
        ("Description", "Strengthening and widening of a 2.4 km internal road including base course, "
                        "asphalt surfacing, side drains and road furniture for the Sinhagad Road residential belt."),
    ]))
    s += [Spacer(1, 6),
          Paragraph("Coordinates: 18.4813, 73.8113", BODY),
          Spacer(1, 6),
          Paragraph(f"Administrative approval was granted vide Sanction Order No. MP/2024/PN/118 dated {off(-591)} "
                    f"(Annexure A). The work order was issued on {off(-551)} (Annexure B).", BODY),
          PageBreak()]
    # ---------------- page 2
    s += [Paragraph("2. Financial Details", H2)]
    s.append(kv_table([
        ("Sanctioned Amount", f"{RS}18.5 lakh"),
        ("Released Amount", f"{RS}16.0 lakh"),
        ("Expenditure", f"{RS}14.2 lakh"),
        ("Remaining Amount", f"{RS}4.3 lakh"),
        ("Budget Revisions", "2"),
    ]))
    s += [Spacer(1, 6),
          Paragraph(f"Revision 1 ({(as_of + timedelta(days=-350)).strftime('%b %Y')}): quantities for drainage increased. Revision 2 "
                    f"({(as_of + timedelta(days=-140)).strftime('%b %Y')}): rate revision for bituminous items.", BODY),
          Paragraph("3. Payment Schedule", H2)]
    s.append(grid_table(
        ["Payment Date", f"Amount ({RS})", "Description", "Voucher No."],
        [[off(-502), "3,00,000", "Mobilisation advance", "V-1187"],
         [off(-417), "4,90,000", "Stage payment 1 - sub-base", "V-1256"],
         [off(-401), "4,95,000", "Stage payment 2 - drainage", "V-1261"],
         [off(-390), "1,35,000", "Material supply", "V-1270"],
         ["Total", "14,20,000", "", ""]],
        [32 * mm, 32 * mm, 70 * mm, 36 * mm]))
    s.append(PageBreak())
    # ---------------- page 3
    s += [Paragraph("4. Timeline", H2)]
    s.append(kv_table([
        ("Sanction Date", off(-591)),
        ("Start Date", off(-544)),
        ("Original Deadline", off(-180)),
        ("Revised Deadline", off(35)),
        ("Delay Days", "180"),
        ("Extension Requests", "2"),
        ("Reporting Period", f"{off(-179)} to {off(0)}"),
    ]))
    s += [Spacer(1, 6),
          Paragraph(f"Extension 1 was requested on {off(-198)} (monsoon disruption) and Extension 2 on {off(-68)} "
                    "(utility shifting).", BODY),
          Paragraph("5. Physical Progress", H2),
          Paragraph("Planned Progress: 88%", BODY),
          Paragraph("Progress: 62%", BODY),
          Spacer(1, 6),
          Paragraph("Milestones", H2)]
    s.append(grid_table(
        ["Milestone", "Planned Date", "Status"],
        [["Site clearance", off(-514), "Completed"],
         ["Sub-base", off(-392), "Completed"],
         ["Drainage works", off(-302), "Completed (late)"],
         ["Base course", off(-241), "In progress (70%)"],
         ["Asphalt surfacing", off(-180), "Not started"],
         ["Road furniture", off(-149), "Not started"]],
        [70 * mm, 45 * mm, 55 * mm]))
    s.append(PageBreak())
    # ---------------- page 4
    s += [Paragraph("6. Annexures", H2),
          Paragraph("Annexure A - Sanction Order No. MP/2024/PN/118", BODY),
          Paragraph(f"Annexure B - Work Order dated {off(-551)}", BODY),
          Paragraph(f"Annexure C - Utilization Certificate (interim) for the period ending {off(-57)}", BODY),
          Paragraph("Annexure D - Geo-tagged photographs of progress (12 images)", BODY)]
    doc.build(s, onFirstPage=footer, onLaterPages=footer)


def messy_report(path: Path, as_of: date):
    """Text-line layout, mixed formats, an out-of-range progress value, missing fields."""
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title="Field Report PC-002", author="Synthetic Demo")
    s = [Paragraph("FIELD PROGRESS NOTE", H1), Paragraph("(informal format - synthetic demo)", SMALL), Spacer(1, 8)]
    lines = [
        "Project Code: MPLADS-PC-002",
        "Name of Work: Water Supply Augmentation - Chinchwad Gaon",
        "Type of Work: Water Supply",
        "Site: Chinchwad Gaon, Pune Road",
        "District: Pimpri-Chinchwad",
        "Constituency: Baramati",
        "Executing Agency: P.W.D. Pune Div.",
        "Scope of Work: Laying of 3.1 km distribution pipeline, 2 elevated storage tanks and household connections.",
        "",
        "Budget: Rs. 42,00,000/-",
        "Funds Released: Rs. 30,00,000",
        "Amount Spent: Rs. 33,50,000",
        "Balance: Rs. 8,50,000",
        "Revisions: 1",
        "",
        f"Date of Commencement: {(as_of + timedelta(days=-652)).strftime('%d/%m/%Y')}",
        f"Stipulated Completion Date: {(as_of + timedelta(days=-271)).strftime('%d-%m-%Y')}",
        "Delay: 95 days",
        f"As on: {fmt(as_of)}",
        "Progress: 108%",
    ]
    for ln in lines:
        s.append(Paragraph(ln or "&nbsp;", BODY))
    s += [Spacer(1, 10),
          Paragraph("Note: work is behind schedule due to pipe supply issues; site engineer to confirm actual physical progress.", BODY)]
    doc.build(s, onFirstPage=footer, onLaterPages=footer)


def main(as_of: date | None = None):
    as_of = as_of or (date.today() - timedelta(days=3))
    OUT.mkdir(parents=True, exist_ok=True)
    clean_report(OUT / "MPLADS-PN-001_Progress_Report.pdf", as_of)
    messy_report(OUT / "MPLADS-PC-002_Field_Report_messy.pdf", as_of)
    print("Generated PDFs in", OUT, "as of", as_of)


if __name__ == "__main__":
    main()
