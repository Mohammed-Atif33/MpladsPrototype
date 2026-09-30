"""Synthetic demo accounts (seeded into PostgreSQL). Passwords are stored ONLY as bcrypt hashes;
the shared demo password comes from the DEMO_PASSWORD env var."""
from . import permissions as P

# (email, name, role, department, district, constituency, agency_name, is_inspector)
DEMO_ACCOUNTS = [
    ("officer@mplads.demo", "Anita Deshmukh", P.OFFICER, "Programme Monitoring Cell", "Pune", "Pune", None, False),
    ("inspector@mplads.demo", "Rahul Kulkarni", P.OFFICER, "Field Inspection Wing", "Pune", "Pune", None, True),
    ("head@mplads.demo", "Dr. Vikram Joshi", P.HEAD, "Supervisory Division", "Pune", "Pune", None, False),
    ("mp@mplads.demo", "Hon. MP Rajesh Pawar", P.MP, "Constituency Office", "Pune", "Pune", None, False),
    ("agency@mplads.demo", "Suresh Patil", P.AGENCY, "Works Section", "Pune", "Pune", "Municipal Works Department", False),
    ("agency2@mplads.demo", "Meena Shinde", P.AGENCY, "Works Section", "Pune", "Pune", "PWD Pune Division", False),
    ("citizen@mplads.demo", "Ravi Kumar", P.CITIZEN, None, "Pune", "Pune", None, False),
    ("citizen2@mplads.demo", "Priya Sharma", P.CITIZEN, None, "Pune", "Pune", None, False),
    ("admin@mplads.demo", "System Administrator", P.ADMIN, "IT Cell", "Pune", "Pune", None, False),
]

# shown on the dev login page (only when SHOW_DEMO_CREDENTIALS=true)
LOGIN_HINTS = [
    ("mp@mplads.demo", P.MP),
    ("officer@mplads.demo", P.OFFICER), ("head@mplads.demo", P.HEAD),
    ("agency@mplads.demo", P.AGENCY), ("citizen@mplads.demo", P.CITIZEN),
    ("admin@mplads.demo", P.ADMIN),
]
