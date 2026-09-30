# MPLADS Risk Intelligence Platform

A role-based project-monitoring and risk-analysis prototype for MPLADS-type local-area development works.
One application, one PostgreSQL database, one connected workflow:

```
Login -> role dashboard -> PDF upload -> extraction (confidence + source page) -> human verification ->
database -> historical comparison -> rule + Isolation-Forest risk score -> explanation -> notification ->
officer decision -> escalation -> Head Officer supervision -> audit trail
```

> **Synthetic data only.** No real people or government records. A risk score is an investigation / prioritisation
> signal, **not** proof of wrongdoing. The score bands (0-29 Low, 30-59 Medium, 60-79 High, 80-100 Critical) are
> prototype thresholds, not official ones.

## Read this first

**`MPLADS_Project_Guide.docx`** (the same guide is also in `MPLADS_Project_Guide.pdf`) explains, for someone who
knows nothing about the project: how to install and run it, a guided click-through for every role, how it is built,
every folder, every module, every screen, how the demo data ("seed") works, and how to fix common problems.

## Quick start (Windows)

You need **Python 3.10+** and **PostgreSQL 12+** installed and running.

1. Extract the zip.
2. Double-click **`setup.bat`** - it installs the Python packages, asks for your PostgreSQL connection
   (host / port / user / password), creates the `mplads` database and loads the demo data.
3. Double-click **`run.bat`** and open **http://localhost:8000**.

Mac / Linux: `python3 setup.py` once, then `python3 run.py`.

To wipe everything and reload the demo data: double-click **`reset_data.bat`**.

## Demo accounts (password for all: `Demo@12345`)

| Login | Role |
|---|---|
| `officer@mplads.demo` | Officer (uploads PDFs, verifies, analyses, decides) |
| `head@mplads.demo` | Head Officer (supervision, inspections, appeals) |
| `agency@mplads.demo` | Implementing Agency (Municipal Works Department) |
| `agency2@mplads.demo` | Implementing Agency (PWD Pune Division) |
| `citizen@mplads.demo`, `citizen2@mplads.demo` | Citizen |
| `inspector@mplads.demo` | Officer flagged as a field inspector |
| `admin@mplads.demo` | Admin (creates users, changes roles, resets passwords) |

The role is never chosen at login - it is read from the database. Visitors can also create their own **Citizen**
account from the login page.

## What is in the folder

| Path | What it is |
|---|---|
| `backend/` | The server (FastAPI): routers, services, database models, security, tests |
| `ml/` | Historical comparison, Isolation Forest and the risk engine |
| `database/` | `seed.py` (demo data), sample-PDF generator, `schema.sql` |
| `frontend/` | The screens (React). `frontend/dist` is the ready-made build the server serves |
| `demo_pdfs/` | Two synthetic sample project PDFs |
| `setup.*`, `run.*`, `reset_data.*` | One-click scripts |

## Stack

React 18 + Vite + Tailwind + Recharts + Leaflet - Python + FastAPI + SQLAlchemy + Pydantic + JWT + bcrypt -
PostgreSQL - pdfplumber / PyMuPDF (optional Tesseract OCR) - pandas, NumPy, scikit-learn.

## Tests

`.venv\Scripts\python -m pytest backend/tests -q` (needs an empty database named `mplads_test` on the same
PostgreSQL server). 59 tests cover security, permissions and the full workflow.
