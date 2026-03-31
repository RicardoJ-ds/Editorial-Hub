#!/usr/bin/env python3
"""
Data seeding script for Editorial BI Hub.

Parses CSV files from the data/ directory and populates all database tables.
Uses synchronous SQLAlchemy for simplicity (one-time operation).

Usage:
    cd backend/
    python scripts/seed_data.py
"""

import os
import random
import re
import sys
from datetime import date, datetime

import pandas as pd
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add backend dir to sys.path so we can import app.models
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from app.models import (
    CapacityProjection,
    Client,
    DeliverableMonthly,
    KpiScore,
    ModelAssumption,
    TeamMember,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://editorial:changeme@localhost:5480/editorial_hub",
)
DATA_DIR = os.path.join(os.path.dirname(BACKEND_DIR), "data")

# Reproducible mock data
random.seed(42)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def safe_int(val, default=None):
    """Convert a value to int, returning default if not possible."""
    if pd.isna(val) or val is None:
        return default
    try:
        return int(float(str(val).replace(",", "").strip()))
    except (ValueError, TypeError):
        return default


def parse_date(val, formats=None):
    """Parse a date string, returning None for TBD/N/A/empty."""
    if pd.isna(val) or val is None:
        return None
    val_str = str(val).strip()
    if val_str.upper() in ("TBD", "N/A", "NA", "-", ""):
        return None

    if formats is None:
        formats = [
            "%m/%d/%Y",
            "%m/%d/%y",
            "%m/%d/%Y",
            "%B %d, %Y",
            "%b %d %Y",
            "%Y-%m-%d",
            "%d/%m/%Y",
        ]

    for fmt in formats:
        try:
            return datetime.strptime(val_str, fmt).date()
        except ValueError:
            continue
    # Last resort: dateutil
    try:
        from dateutil.parser import parse as dateutil_parse

        return dateutil_parse(val_str).date()
    except Exception:
        return None


def parse_word_count(val):
    """Parse '1,000 - 1,500' into (min, max) ints."""
    if pd.isna(val) or val is None:
        return None, None
    val_str = str(val).replace(",", "").strip()
    match = re.match(r"(\d+)\s*[-–]\s*(\d+)", val_str)
    if match:
        return int(match.group(1)), int(match.group(2))
    # Single value
    try:
        v = int(val_str)
        return v, v
    except ValueError:
        return None, None


def parse_cadence_quarters(cadence_str):
    """Parse cadence string like 'Q1 = 30 / Q2 = 51 / Q3 = 60 / Q4 = 39'
    into dict with keys q1..q4."""
    result = {"q1": None, "q2": None, "q3": None, "q4": None}
    if pd.isna(cadence_str) or cadence_str is None:
        return result
    cadence_str = str(cadence_str)
    for q in range(1, 5):
        pattern = rf"Q{q}\s*=\s*(\d+)"
        match = re.search(pattern, cadence_str)
        if match:
            result[f"q{q}"] = int(match.group(1))
    return result


def map_status(raw):
    """Map raw status text to enum value."""
    if pd.isna(raw) or raw is None:
        return None
    raw = str(raw).strip().upper()
    mapping = {
        "SOON TO BE ACTIVE": "SOON_TO_BE_ACTIVE",
        "ACTIVE": "ACTIVE",
        "COMPLETED": "COMPLETED",
        "CANCELLED": "CANCELLED",
        "INACTIVE": "COMPLETED",  # Treat INACTIVE as COMPLETED
    }
    return mapping.get(raw, raw)


def parse_month_str(month_str):
    """Parse 'Mar 2026' or 'Feb 2026' to (year, month)."""
    if pd.isna(month_str) or month_str is None:
        return None, None
    try:
        dt = datetime.strptime(str(month_str).strip(), "%b %Y")
        return dt.year, dt.month
    except ValueError:
        return None, None


# ---------------------------------------------------------------------------
# 1. Seed clients from Editorial_SOW_overview.csv
# ---------------------------------------------------------------------------


def seed_clients(session: Session) -> dict[str, int]:
    """Parse Editorial_SOW_overview.csv and insert into clients table.
    Returns a dict mapping client name -> client id."""
    print("\n=== Seeding clients ===")
    csv_path = os.path.join(DATA_DIR, "Editorial_SOW_overview.csv")
    if not os.path.exists(csv_path):
        print(f"  WARNING: {csv_path} not found, skipping.")
        return {}

    # skiprows=5 with header=0 captures ALL clients including SOON_TO_BE_ACTIVE
    df = pd.read_csv(csv_path, skiprows=5, header=0)

    # Standardize column names for easy access
    col_names = [
        "status",
        "client",
        "start",
        "term_months",
        "end",
        "cadence",
        "articles_sow",
        "articles_delivered",
        "articles_invoiced",
        "articles_paid",
        "word_count",
        "consulting_ko",
        "editorial_ko",
        "first_cb",
        "first_article_delivery",
        "first_feedback",
        "first_article_published",
        "comments",
        "sow",
    ]
    df.columns = col_names

    # Filter: skip rows where Client is empty/NaN
    df = df[df["client"].notna()].copy()
    # Strip whitespace
    df["client"] = df["client"].astype(str).str.strip()
    df["status"] = df["status"].astype(str).str.strip()
    # Skip rows where status is NaN or missing (these are duplicate sections)
    df = df[df["status"].notna() & (df["status"] != "nan") & (df["status"] != "")].copy()
    # Skip summary rows
    df = df[~df["client"].str.lower().str.contains("total|median|average|client", na=False)].copy()

    client_map = {}
    count = 0

    for _, row in df.iterrows():
        status = map_status(row["status"])
        if status is None:
            continue

        name = row["client"]
        cadence_raw = str(row["cadence"]) if pd.notna(row["cadence"]) else None
        quarters = parse_cadence_quarters(cadence_raw)
        wc_min, wc_max = parse_word_count(row["word_count"])

        client = Client(
            name=name,
            status=status,
            start_date=parse_date(row["start"]),
            term_months=safe_int(row["term_months"]),
            end_date=parse_date(row["end"]),
            cadence=cadence_raw,
            cadence_q1=quarters["q1"],
            cadence_q2=quarters["q2"],
            cadence_q3=quarters["q3"],
            cadence_q4=quarters["q4"],
            articles_sow=safe_int(row["articles_sow"]),
            articles_delivered=safe_int(row["articles_delivered"], 0),
            articles_invoiced=safe_int(row["articles_invoiced"], 0),
            articles_paid=safe_int(row["articles_paid"], 0),
            word_count_min=wc_min,
            word_count_max=wc_max,
            consulting_ko_date=parse_date(row["consulting_ko"]),
            editorial_ko_date=parse_date(row["editorial_ko"]),
            first_cb_approved_date=parse_date(row["first_cb"]),
            first_article_delivered_date=parse_date(row["first_article_delivery"]),
            first_feedback_date=parse_date(row["first_feedback"]),
            first_article_published_date=parse_date(row["first_article_published"]),
            comments=str(row["comments"]) if pd.notna(row["comments"]) else None,
            sow_link=str(row["sow"]) if pd.notna(row["sow"]) else None,
        )
        session.add(client)
        session.flush()  # Get the ID
        client_map[name] = client.id
        count += 1

    session.commit()
    print(f"  Inserted {count} clients.")
    return client_map


# ---------------------------------------------------------------------------
# 2. Seed team_members + capacity_projections from ET_CP_2026_V11_Mar_2026.csv
# ---------------------------------------------------------------------------


def seed_team_and_capacity(session: Session, client_map: dict[str, int]):
    """Parse ET_CP_2026_V11_Mar_2026.csv for team members and capacity projections."""
    print("\n=== Seeding team members ===")
    csv_path = os.path.join(DATA_DIR, "ET_CP_2026_V11_Mar_2026.csv")
    if not os.path.exists(csv_path):
        print(f"  WARNING: {csv_path} not found, skipping.")
        return {}

    # -----------------------------------------------------------------------
    # Team members: hardcoded from pod assignments (rows 5-38 in the CSV)
    # -----------------------------------------------------------------------
    pod_teams = {
        "Pod 1": {
            "senior_editor": "Nina Denison",
            "editors": ["Robert Thorpe", "Jimmy Bunes"],
            "clients": ["College HUNKS", "Eventbrite", "Felt", "Gainbridge", "n8n"],
        },
        "Pod 2": {
            "senior_editor": "Kennedy Stevens",
            "editors": ["Jimmy Bunes", "Elliot Gardner", "Tiffany Anderson"],
            "clients": [
                "Genstore AI",
                "GenstoreAI",
                "Get Flex",
                "Flex",
                "Huntress",
                "Maven Clinic",
                "Mistplay",
                "Miter",
                "Workleap + Sharegate",
            ],
        },
        "Pod 3": {
            "senior_editor": "Alyssa Zacharias",
            "editors": ["Lee Anderson", "Haley Drucker"],
            "clients": [
                "BLVD",
                "Boulevard",
                "Cointracker",
                "Leapsome",
                "Pylon",
                "Vimeo",
                "Webflow",
            ],
        },
        "Pod 5": {
            "senior_editor": "Maggie Gowland",
            "editors": ["Lauren Friar", "Shivani Verma"],
            "clients": [
                "Honeybook",
                "Fivetran",
                "Front",
                "Meta fB",
                "Meta BMG",
                "Meta RL",
                "Meta AI",
                "Oyster",
            ],
        },
    }

    # Deduplicate team members (Jimmy Bunes appears in Pod 1 and Pod 2)
    # Assign to primary pod (Pod 1 per the CSV assignments)
    seen_members = {}
    member_map = {}  # name -> TeamMember.id
    member_count = 0

    for pod_name, pod_info in pod_teams.items():
        # Senior Editor
        se_name = pod_info["senior_editor"]
        if se_name not in seen_members:
            tm = TeamMember(
                name=se_name,
                role="SENIOR_EDITOR",
                pod=pod_name,
                is_active=True,
                monthly_capacity=20,
            )
            session.add(tm)
            session.flush()
            seen_members[se_name] = tm
            member_map[se_name] = tm.id
            member_count += 1

        # Editors
        for ed_name in pod_info["editors"]:
            if ed_name not in seen_members:
                tm = TeamMember(
                    name=ed_name,
                    role="EDITOR",
                    pod=pod_name,
                    is_active=True,
                    monthly_capacity=60,
                )
                session.add(tm)
                session.flush()
                seen_members[ed_name] = tm
                member_map[ed_name] = tm.id
                member_count += 1

    session.commit()
    print(f"  Inserted {member_count} team members.")

    # -----------------------------------------------------------------------
    # Update clients with editorial_pod
    # -----------------------------------------------------------------------
    print("\n=== Updating client editorial pod assignments ===")
    pod_update_count = 0
    for pod_name, pod_info in pod_teams.items():
        for client_name in pod_info["clients"]:
            # Look up client by name (handle aliases)
            cid = client_map.get(client_name)
            if cid:
                session.execute(
                    text("UPDATE clients SET editorial_pod = :pod WHERE id = :cid"),
                    {"pod": pod_name, "cid": cid},
                )
                pod_update_count += 1
    session.commit()
    print(f"  Updated {pod_update_count} client pod assignments.")

    # -----------------------------------------------------------------------
    # Capacity projections: parse from the CAPACITY section (~row 87+)
    # -----------------------------------------------------------------------
    print("\n=== Seeding capacity projections ===")

    # Read the raw CSV with all columns
    df = pd.read_csv(csv_path, header=None)

    # The months for the capacity section: Dec 2025 through Dec 2026
    months = [
        (2025, 12),  # Dec 2025
        (2026, 1),  # Jan 2026
        (2026, 2),  # Feb 2026
        (2026, 3),  # Mar 2026
        (2026, 4),  # Apr 2026
        (2026, 5),  # May 2026
        (2026, 6),  # Jun 2026
        (2026, 7),  # Jul 2026
        (2026, 8),  # Aug 2026
        (2026, 9),  # Sep 2026
        (2026, 10),  # Oct 2026
        (2026, 11),  # Nov 2026
        (2026, 12),  # Dec 2026
    ]

    # Find the Senior Editor rows for each pod in the capacity section
    # Each month block is 8 columns wide starting at column 3:
    # Pod(3), Role(4), Team(5), blank(6), Capacity(7),
    # Total Capacity(8), Projected Used(9), Actual Used(10)
    # Next month starts at column 11, etc.

    # Find the row indices where pod SE data lives
    # Look for rows containing "Pod 1" and "Senior Editor" after row 80
    capacity_count = 0
    version = "V11 Mar 2026"

    # Scan for SE rows in the capacity section (starts around row 79)
    for row_idx in range(75, min(len(df), 120)):
        row = df.iloc[row_idx]
        # Check if col 3 matches a pod name and col 4 is "Senior Editor"
        col3_val = str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ""
        col4_val = str(row.iloc[4]).strip() if pd.notna(row.iloc[4]) else ""

        if col3_val.startswith("Pod") and col4_val == "Senior Editor":
            pod_name = col3_val  # e.g. "Pod 1"

            # Extract data for each of the 13 months
            for month_idx, (year, month) in enumerate(months):
                # Each month block is 8 columns wide, starting at col 3
                base_col = 3 + (month_idx * 8)
                total_cap_col = base_col + 5  # Total Capacity
                projected_col = base_col + 6  # Projected Used Capacity
                actual_col = base_col + 7  # Actual Used Capacity

                if total_cap_col >= len(df.columns):
                    break

                total_cap = safe_int(row.iloc[total_cap_col])
                projected = safe_int(row.iloc[projected_col])
                actual = safe_int(row.iloc[actual_col])

                cp = CapacityProjection(
                    pod=pod_name,
                    year=year,
                    month=month,
                    total_capacity=total_cap,
                    projected_used_capacity=projected,
                    actual_used_capacity=actual,
                    version=version,
                )
                session.add(cp)
                capacity_count += 1

    session.commit()
    print(f"  Inserted {capacity_count} capacity projections.")
    return member_map


# ---------------------------------------------------------------------------
# 3. Seed deliverables_monthly from Delivered_vs_Invoiced_v2.csv
# ---------------------------------------------------------------------------


def seed_deliverables(session: Session, client_map: dict[str, int]):
    """Parse Delivered_vs_Invoiced_v2.csv and insert into deliverables_monthly."""
    print("\n=== Seeding deliverables_monthly ===")
    csv_path = os.path.join(DATA_DIR, "Delivered_vs_Invoiced_v2.csv")
    if not os.path.exists(csv_path):
        print(f"  WARNING: {csv_path} not found, skipping.")
        return

    df = pd.read_csv(csv_path, header=None)

    # Build a reverse lookup: lowercase/stripped name -> client_id
    # Handle common aliases
    name_lookup = {}
    for name, cid in client_map.items():
        name_lookup[name.lower().strip()] = cid
    # Add some aliases
    alias_map = {
        "get flex": "flex",
        "genstoreai": "genstoreai",
        "genstore ai": "genstoreai",
        "blvd": "boulevard",
        "meta fb": "meta bmg",
        "meta bmg": "meta bmg",
        "college hunks": "college hunks",
    }
    for alias, canonical in alias_map.items():
        if canonical in name_lookup and alias not in name_lookup:
            name_lookup[alias] = name_lookup[canonical]

    # Data starts at row 3 (0-indexed), in groups of 6 rows per client
    # Group structure: SOW, Invoicing, Cumulative, Article Deliveries, Variance, Cumulative Delivered
    deliverable_count = 0
    row_idx = 3
    max_months = 12

    while row_idx + 5 < len(df):
        header_row = df.iloc[row_idx]

        # Check if this is a client header row (col 0 has status)
        status_val = str(header_row.iloc[0]).strip() if pd.notna(header_row.iloc[0]) else ""
        if not status_val or status_val.lower() == "nan":
            row_idx += 1
            continue

        # Extract client name from col 3
        client_name = str(header_row.iloc[3]).strip() if pd.notna(header_row.iloc[3]) else ""
        if not client_name or client_name.lower() == "nan":
            row_idx += 6
            continue

        # Get start month from col 5
        start_month_str = str(header_row.iloc[5]).strip() if pd.notna(header_row.iloc[5]) else ""
        start_year, start_month = parse_month_str(start_month_str)

        if start_year is None:
            row_idx += 6
            continue

        # Look up client_id
        client_id = name_lookup.get(client_name.lower().strip())
        if client_id is None:
            # Try partial matching
            for key, cid in name_lookup.items():
                if client_name.lower().strip() in key or key in client_name.lower().strip():
                    client_id = cid
                    break

        if client_id is None:
            print(f"  WARNING: Client '{client_name}' not found in DB, skipping.")
            row_idx += 6
            continue

        # Rows within the group (relative to row_idx):
        # 0: SOW targets
        # 1: Invoicing
        # 2: Cumulative
        # 3: Article Deliveries
        # 4: Variance
        # 5: Cumulative Delivered
        sow_row = df.iloc[row_idx]  # SOW targets per month
        invoicing_row = df.iloc[row_idx + 1]  # Invoicing
        deliveries_row = df.iloc[row_idx + 3]  # Article Deliveries

        # Month data columns start at col 7 (M1), col 8 (M2), etc.
        for m_offset in range(max_months):
            col_idx = 7 + m_offset
            if col_idx >= len(df.columns):
                break

            # Calculate actual year/month
            dt = date(start_year, start_month, 1) + relativedelta(months=m_offset)
            year = dt.year
            month = dt.month

            articles_delivered_val = safe_int(deliveries_row.iloc[col_idx])
            articles_invoiced_val = safe_int(invoicing_row.iloc[col_idx])
            articles_sow_val = safe_int(sow_row.iloc[col_idx])

            # Only insert if there's any data for this month
            if articles_delivered_val is not None or articles_invoiced_val is not None:
                dm = DeliverableMonthly(
                    client_id=client_id,
                    year=year,
                    month=month,
                    articles_sow_target=articles_sow_val if articles_sow_val else 0,
                    articles_delivered=articles_delivered_val
                    if articles_delivered_val is not None
                    else 0,
                    articles_invoiced=articles_invoiced_val
                    if articles_invoiced_val is not None
                    else 0,
                )
                session.add(dm)
                deliverable_count += 1

        row_idx += 6

    session.commit()
    print(f"  Inserted {deliverable_count} deliverables_monthly records.")


# ---------------------------------------------------------------------------
# 4. Seed model_assumptions from Model_Assumptions.csv
# ---------------------------------------------------------------------------


def seed_model_assumptions(session: Session):
    """Parse Model_Assumptions.csv into model_assumptions table."""
    print("\n=== Seeding model assumptions ===")
    csv_path = os.path.join(DATA_DIR, "Model_Assumptions.csv")
    if not os.path.exists(csv_path):
        print(f"  WARNING: {csv_path} not found, skipping.")
        return

    df = pd.read_csv(csv_path, header=None)
    count = 0
    current_category = None

    # Known category headers
    categories = {
        "CLIENT CATEGORIZATION": "CLIENT_CATEGORIZATION",
        "RAMP-UP PERIODS (TEAM)": "RAMP_UP_PERIODS",
        "WEEKLY & MONTHLY CAPACITY": "WEEKLY_MONTHLY_CAPACITY",
        "IDEAL CAPACITY": "IDEAL_CAPACITY",
        "NEW CLIENTS PER POD PER MONTH": "NEW_CLIENTS_PER_POD",
    }

    for _, row in df.iterrows():
        first_col = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ""

        # Check if this row is a category header
        if first_col in categories:
            current_category = categories[first_col]
            continue

        if current_category is None:
            continue

        # Skip empty/header rows
        if not first_col or first_col in ("MODEL ASSUMPTIONS", "nan", ""):
            continue

        # Parse key-value data based on category
        if current_category == "CLIENT_CATEGORIZATION":
            key = first_col
            value = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            if value and value != "nan":
                ma = ModelAssumption(
                    category=current_category,
                    key=key,
                    value=value,
                    description=f"Client categorization: {key}",
                )
                session.add(ma)
                count += 1

        elif current_category == "RAMP_UP_PERIODS":
            role = first_col
            col1 = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            col2 = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""
            col3 = str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ""
            col4 = str(row.iloc[4]) if len(row) > 4 and pd.notna(row.iloc[4]) else ""

            if col1 == "percentage" or col1 == "articles":
                key = f"{role}_{col1}"
                value = f"M1={col2}, M2={col3}, M3+={col4}" if col4 else f"M1={col2}, M2={col3}"
                ma = ModelAssumption(
                    category=current_category,
                    key=key,
                    value=value,
                    description=f"Ramp-up {col1} for {role}",
                )
                session.add(ma)
                count += 1
            elif col2 and col2 != "nan":
                # Numeric ramp-up rows
                key = f"ramp_{role}"
                value = (
                    f"M1={col1}, M2={col2}, M3={col3}, M4={col4}"
                    if col4
                    else f"M1={col1}, M2={col2}, M3={col3}"
                )
                ma = ModelAssumption(
                    category=current_category,
                    key=key,
                    value=value,
                )
                session.add(ma)
                count += 1

        elif current_category == "WEEKLY_MONTHLY_CAPACITY":
            role = first_col
            per_week = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            per_month = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""
            comments_val = (
                str(row.iloc[3]).strip() if len(row) > 3 and pd.notna(row.iloc[3]) else ""
            )
            if per_week and per_week != "nan" and per_week != "per week":
                ma = ModelAssumption(
                    category=current_category,
                    key=f"{role}_weekly",
                    value=per_week,
                    description=comments_val if comments_val and comments_val != "nan" else None,
                )
                session.add(ma)
                count += 1
                ma2 = ModelAssumption(
                    category=current_category,
                    key=f"{role}_monthly",
                    value=per_month,
                    description=comments_val if comments_val and comments_val != "nan" else None,
                )
                session.add(ma2)
                count += 1

        elif current_category == "IDEAL_CAPACITY":
            pct = first_col
            status_val = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            desc = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ""
            if status_val and status_val != "nan" and status_val != "status":
                ma = ModelAssumption(
                    category=current_category,
                    key=pct,
                    value=status_val,
                    description=desc if desc and desc != "nan" else None,
                )
                session.add(ma)
                count += 1

        elif current_category == "NEW_CLIENTS_PER_POD":
            key = first_col  # Min or Max
            value = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            if value and value != "nan":
                ma = ModelAssumption(
                    category=current_category,
                    key=key,
                    value=value,
                    description=None,
                )
                session.add(ma)
                count += 1

    session.commit()
    print(f"  Inserted {count} model assumptions.")


# ---------------------------------------------------------------------------
# 5. Generate mock KPI data
# ---------------------------------------------------------------------------


def seed_kpi_scores(session: Session, member_map: dict[str, int]):
    """Generate mock KPI scores for each team member for Oct 2025 - Mar 2026."""
    print("\n=== Seeding KPI scores (mock data) ===")

    # KPI definitions per role
    se_kpis = {
        "internal_quality": {"min": 70, "max": 95, "target": 85},
        "external_quality": {"min": 70, "max": 95, "target": 85},
        "revision_rate": {"min": 5, "max": 25, "target": 15},
        "capacity_utilization": {"min": 70, "max": 100, "target": 82.5},
        "second_reviews": {"min": 3, "max": 10, "target": 5},
        "turnaround_time": {"min": 7, "max": 21, "target": 14},
        "ai_compliance": {"min": 80, "max": 100, "target": 95},
        "mentorship": {"min": 60, "max": 95, "target": 80},
    }

    editor_kpis = {
        "internal_quality": {"min": 70, "max": 95, "target": 85},
        "external_quality": {"min": 70, "max": 95, "target": 85},
        "revision_rate": {"min": 5, "max": 25, "target": 15},
        "capacity_utilization": {"min": 70, "max": 100, "target": 82.5},
        "turnaround_time": {"min": 7, "max": 21, "target": 14},
        "ai_compliance": {"min": 80, "max": 100, "target": 95},
        "feedback_adoption": {"min": 60, "max": 95, "target": 80},
    }

    # 6 months: Oct 2025 - Mar 2026
    months = [
        (2025, 10),
        (2025, 11),
        (2025, 12),
        (2026, 1),
        (2026, 2),
        (2026, 3),
    ]

    # Get all team members from DB
    team_members = session.query(TeamMember).all()
    count = 0

    for tm in team_members:
        kpis = se_kpis if tm.role == "SENIOR_EDITOR" else editor_kpis

        for year, month in months:
            for kpi_type, params in kpis.items():
                # Generate a realistic score with some variance
                # Trend slightly upward over time for realism
                month_offset = (year - 2025) * 12 + month - 10  # 0-5
                trend_bonus = month_offset * 0.5  # slight improvement

                base_score = random.uniform(params["min"], params["max"])
                score = min(base_score + trend_bonus, params["max"])
                score = round(score, 1)

                kpi = KpiScore(
                    team_member_id=tm.id,
                    year=year,
                    month=month,
                    kpi_type=kpi_type,
                    score=score,
                    target=params["target"],
                )
                session.add(kpi)
                count += 1

    session.commit()
    print(f"  Inserted {count} KPI score records.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def truncate_all(session: Session):
    """Truncate all tables in the correct order."""
    print("=== Truncating all tables ===")
    tables = [
        "kpi_scores",
        "capacity_projections",
        "deliverables_monthly",
        "model_assumptions",
        "audit_log",
        "team_members",
        "clients",
    ]
    for table in tables:
        session.execute(text(f"TRUNCATE TABLE {table} CASCADE"))  # nosemgrep
    session.commit()
    print("  All tables truncated.")


def print_counts(session: Session):
    """Print record counts for all tables."""
    print("\n=== Final record counts ===")
    tables = [
        "clients",
        "team_members",
        "capacity_projections",
        "deliverables_monthly",
        "model_assumptions",
        "kpi_scores",
        "audit_log",
    ]
    for table in tables:
        result = session.execute(text(f"SELECT COUNT(*) FROM {table}"))  # nosemgrep
        count = result.scalar()
        print(f"  {table}: {count}")


def main():
    print("=" * 60)
    print("Editorial BI Hub - Data Seeder")
    print("=" * 60)
    print(f"Database: {DATABASE_URL}")
    print(f"Data dir: {DATA_DIR}")

    engine = create_engine(DATABASE_URL, echo=False)

    with Session(engine) as session:
        try:
            # Truncate all existing data
            truncate_all(session)

            # 1. Seed clients
            client_map = seed_clients(session)

            # 2. Seed team members + capacity projections
            member_map = seed_team_and_capacity(session, client_map)

            # 3. Seed deliverables
            seed_deliverables(session, client_map)

            # 4. Seed model assumptions
            seed_model_assumptions(session)

            # 5. Generate mock KPI scores
            seed_kpi_scores(session, member_map)

            # Print final counts
            print_counts(session)

            print("\n" + "=" * 60)
            print("Seeding complete!")
            print("=" * 60)

        except Exception as e:
            session.rollback()
            print(f"\nERROR: {e}")
            import traceback

            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    main()
