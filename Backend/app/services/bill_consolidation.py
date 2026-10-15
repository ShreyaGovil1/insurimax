"""
Combines the charges of every document on a claim into one list for adjudication.

A claim rarely has a single bill, documents can be uploaded under any section, and they relate to
each other in a few standard ways. Each document gets a role:

- bill: an actual bill / invoice / receipt for charges. Bills that no other bill carries
  (pre-/post-hospitalisation receipts, separate pharmacy or diagnostic invoices) are added.
- itemised_breakup: the detail behind ONE summary line of another bill (e.g. the pharmacy invoice behind
  "Pharmacy charges" on the final bill). Its items replace that line: the detail is adjudicated and the
  amount is not counted twice.
- reference_charge_sheet: a tariff, rate list or estimate. Nothing was charged; kept for reference only.
- duplicate: another copy of a bill already on the claim. Counted once.
- payment_receipt: proof of payment (advance, deposit, settlement) for charges billed elsewhere. Not a charge.

The roles and links come from the AI reconciliation plan (``plan``, produced by reading all of the
claim's billing documents together, see document_service.reconcile_claim_bills), which understands
documents by meaning rather than by matching names. This module applies the plan and checks it:
links must point at a real line, a line is itemised by at most one bill, and amount differences are
reported. Without a plan (AI unavailable) it falls back to printed bill numbers and matching amounts.
Anything uncertain is counted once and called out in ``bill_reconciliation_notes``, never dropped silently.
"""
import re
from datetime import date, datetime

AMOUNT_TOLERANCE_INR = 1.0

ROLE_BILL = "bill"
ROLE_BREAKUP = "itemised_breakup"
ROLE_REFERENCE = "reference_charge_sheet"
ROLE_DUPLICATE = "duplicate"
ROLE_PAYMENT = "payment_receipt"
ROLES = (ROLE_BILL, ROLE_BREAKUP, ROLE_REFERENCE, ROLE_DUPLICATE, ROLE_PAYMENT)


def _norm_ref(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def line_amount(item: dict) -> float:
    for key in ("total_price_inr", "total_amount", "total_price"):
        try:
            if item.get(key) not in (None, ""):
                return float(item[key])
        except (TypeError, ValueError):
            continue
    return 0.0


def parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _same_amount(a: float, b: float) -> bool:
    return abs(a - b) <= AMOUNT_TOLERANCE_INR


def bill_from_payload(document_id: str, filename: str, doc_type: str, payload: dict) -> dict | None:
    """A document's charges in the shape ``consolidate`` expects; None if it lists no charges."""
    raw = payload.get("line_items") or payload.get("items") or []
    items = [i for i in raw if isinstance(i, dict)] if isinstance(raw, list) else []
    if not items:
        return None
    try:
        total = float(payload["total_billed_inr"])
    except (KeyError, TypeError, ValueError):
        total = sum(line_amount(i) for i in items)
    meta = payload.get("bill") if isinstance(payload.get("bill"), dict) else {}
    return {
        "document_id": document_id,
        "filename": filename,
        "doc_type": doc_type,
        "meta": meta,
        "role": meta.get("document_role") if meta.get("document_role") in ROLES else ROLE_BILL,
        "items": items,
        "total": round(total, 2),
        # Extracted before bill metadata existed: without the AI plan, links can't be detected.
        "legacy": "bill" not in payload,
    }


def plan_input(bills: list[dict]) -> list[dict]:
    """What the AI reconciliation reads for each document (no citations, compact lines)."""
    return [
        {
            "document_id": b["document_id"],
            "filename": b["filename"],
            "uploaded_as": b["doc_type"],
            "header": {k: v for k, v in b["meta"].items() if v not in (None, "")},
            "total_inr": b["total"],
            "line_items": [
                {
                    "line_number": line.get("line_number", i + 1),
                    "item_name": str(line.get("item_name") or "")[:160],
                    "amount_inr": line_amount(line),
                    "date": line.get("date"),
                }
                for i, line in enumerate(b["items"])
            ],
        }
        for b in bills
    ]


def _heuristic_summary_line(child: dict, payable: list[dict], claimed: set[int]) -> tuple[dict, dict] | None:
    """Fallback without AI: the line elsewhere that carries `child` as one amount, by printed number / amount."""
    child_no = _norm_ref(child["meta"].get("bill_number"))
    declared_parent = _norm_ref(child["meta"].get("included_in_bill_number"))
    explicit, declared, by_amount = [], [], []
    for parent in payable:
        if parent is child:
            continue
        parent_no = _norm_ref(parent["meta"].get("bill_number"))
        for line in parent["items"]:
            if id(line) in claimed:
                continue
            ref = _norm_ref(line.get("referenced_bill_number"))
            if child_no and ref == child_no:
                explicit.append((parent, line))
            elif not _same_amount(line_amount(line), child["total"]) or (ref and child_no and ref != child_no):
                continue
            elif declared_parent and declared_parent == parent_no:
                declared.append((parent, line))
            elif line.get("summarises_other_bill") and (child["role"] == ROLE_BREAKUP or declared_parent):
                by_amount.append((parent, line))
    for candidates in (explicit, declared, by_amount):
        if len(candidates) == 1:
            return candidates[0]
    return None


def _planned_summary_line(entry: dict, by_id: dict[str, dict], child: dict) -> tuple[dict, dict] | None:
    target = entry.get("itemises") or {}
    parent = by_id.get(str(target.get("document_id")))
    if parent is None or parent is child:
        return None
    for i, line in enumerate(parent["items"]):
        if str(line.get("line_number", i + 1)) == str(target.get("line_number")):
            return parent, line
    return None


def _claim_phase(item: dict, bill: dict, inherited: str | None, admission, discharge) -> str | None:
    phase = bill.get("phase") or item.get("claim_phase") or bill["meta"].get("claim_phase") or inherited
    if phase:
        return phase
    when = parse_date(item.get("date")) or parse_date(bill["meta"].get("bill_date"))
    if not (when and admission):
        return None
    if when < admission:
        return "pre_hospitalisation"
    if discharge and when > discharge:
        return "post_hospitalisation"
    return "hospitalisation"


def consolidate(
    bills: list[dict],
    admission: date | None = None,
    discharge: date | None = None,
    plan: dict | None = None,
) -> dict:
    """
    Reconcile the claim's bills (from ``bill_from_payload``) into one de-duplicated list of line items,
    each tagged with the document it came from. ``plan`` is the AI reconciliation
    ({document_id: {role, itemises: {document_id, line_number}, duplicate_of, claim_phase, reason}}).
    Returns the claim-level fields to merge into the extracted data, plus "primary_document_id"
    (the main bill, whose header fields should win).
    """
    plan = plan or {}
    by_id = {b["document_id"]: b for b in bills}
    notes: list[str] = []

    for b in bills:
        entry = plan.get(b["document_id"]) or {}
        if entry.get("role") in ROLES:
            b["role"] = entry["role"]
        b["reason"] = entry.get("reason")
        b["phase"] = entry.get("claim_phase")

    # Duplicates: the AI's call, else the same printed bill number and amount.
    seen: dict[tuple, dict] = {}
    for b in bills:
        original = None
        if plan:
            if b["role"] == ROLE_DUPLICATE:
                original = by_id.get(str((plan.get(b["document_id"]) or {}).get("duplicate_of")))
                if original is None or original is b or original["role"] == ROLE_DUPLICATE:
                    b["role"], original = ROLE_BILL, None  # a duplicate of nothing valid is still a bill
        else:
            key = (_norm_ref(b["meta"].get("bill_number")), round(b["total"]))
            original = seen.get(key) if key[0] else None
            seen.setdefault(key, b)
        if original is not None:
            b["role"], b["duplicate_of"] = ROLE_DUPLICATE, original["filename"]
            notes.append(f"{b['filename']} is another copy of {original['filename']}; counted once.")

    for b in bills:
        if b["role"] == ROLE_PAYMENT:
            notes.append(f"{b['filename']} is a payment receipt, not a bill; its amounts are not claimed as charges.")
    references = [b for b in bills if b["role"] == ROLE_REFERENCE]
    payable = [b for b in bills if b["role"] in (ROLE_BILL, ROLE_BREAKUP)]

    # Breakups: which summary line of which other bill each one itemises.
    expanded_by: dict[int, dict] = {}  # id(summary line) -> breakup bill
    parent_of: dict[int, tuple[dict, dict]] = {}  # id(breakup bill) -> (parent bill, summary line)
    claimed: set[int] = set()
    for child in sorted(payable, key=lambda b: b["total"]):  # smallest first: nest into the nearest bill
        entry = plan.get(child["document_id"])
        if entry is not None:
            match = _planned_summary_line(entry, by_id, child) if child["role"] == ROLE_BREAKUP else None
        else:
            match = _heuristic_summary_line(child, payable, claimed)
        if match is None:
            continue
        parent, line = match
        if parent not in payable or id(line) in claimed or parent_of.get(id(parent), (None,))[0] is child:
            notes.append(f"Could not attach {child['filename']} to {parent['filename']} line {line.get('line_number')}; counted separately.")
            continue
        claimed.add(id(line))
        expanded_by[id(line)] = child
        parent_of[id(child)] = match
        if not _same_amount(line_amount(line), child["total"]):
            notes.append(
                f"{parent['filename']} line {line.get('line_number')} ({line.get('item_name')}) shows "
                f"Rs. {line_amount(line):,.2f} but its itemised bill {child['filename']} totals Rs. {child['total']:,.2f}; "
                "the itemised amounts are used - verify the difference."
            )

    for b in payable:
        if not plan and b["legacy"] and len(bills) > 1:
            notes.append(
                f"{b['filename']} was read before bill reconciliation existed and the AI reconciliation is unavailable; "
                "re-run its extraction so links to the other bills (and double billing) are detected."
            )
        for line in b["items"]:
            if line.get("summarises_other_bill") and id(line) not in expanded_by:
                notes.append(
                    f"{b['filename']} line {line.get('line_number')} ({line.get('item_name')}) is the total of another bill "
                    "whose itemised copy was not uploaded; it is assessed as one amount."
                )
        if id(b) not in parent_of and b["role"] == ROLE_BREAKUP:
            notes.append(
                f"{b['filename']} itemises charges of another bill, but the line it belongs to was not found in the "
                "uploaded bills. Its items are counted separately; check for double billing."
            )

    combined: list[dict] = []
    superseded: list[dict] = []
    emitted: set[int] = set()

    def emit(bill: dict, role: str, phase: str | None = None, via: str | None = None):
        if id(bill) in emitted:
            return
        emitted.add(id(bill))
        for line in bill["items"]:
            child = expanded_by.get(id(line))
            line_phase = _claim_phase(line, bill, phase, admission, discharge)
            if child is not None and id(child) not in emitted:
                superseded.append({
                    "item_name": line.get("item_name"),
                    "amount_inr": line_amount(line),
                    "source_document": bill["filename"],
                    "bill_line_number": line.get("line_number"),
                    "itemised_in": child["filename"],
                })
                emit(child, ROLE_BREAKUP, line_phase, f"{bill['filename']} line {line.get('line_number')}: {line.get('item_name')}")
                continue
            combined.append({
                **line,
                "line_number": len(combined) + 1,
                "bill_line_number": line.get("line_number"),
                "document_id": bill["document_id"],
                "source_document": bill["filename"],
                "bill_number": bill["meta"].get("bill_number"),
                "issuer_name": bill["meta"].get("issuer_name"),
                "bill_role": role,
                "itemises_summary_line": via,
                "claim_phase": line_phase,
            })

    # The main bill first: the largest top-level bill, preferring ones uploaded/classified as bills.
    top_level = sorted(
        (b for b in payable if id(b) not in parent_of),
        key=lambda b: (b["doc_type"] != "itemized_bill", -b["total"]),
    )
    for i, bill in enumerate(top_level):
        emit(bill, "primary_bill" if i == 0 else "separate_bill")
    for bill in payable:  # anything unreachable (e.g. circular links) is still counted
        emit(bill, "separate_bill")

    def role_of(b: dict) -> str:
        if b not in payable:
            return b["role"]
        if id(b) in parent_of:
            return ROLE_BREAKUP
        return "primary_bill" if top_level and b is top_level[0] else "separate_bill"

    return {
        "line_items": combined,
        "total_billed_inr": round(sum(line_amount(i) for i in combined), 2),
        "bills": [
            {
                "document_id": b["document_id"],
                "source_document": b["filename"],
                "uploaded_as": b["doc_type"],
                "bill_number": b["meta"].get("bill_number"),
                "issuer_name": b["meta"].get("issuer_name"),
                "bill_date": b["meta"].get("bill_date"),
                "claim_phase": b.get("phase") or b["meta"].get("claim_phase"),
                "role": role_of(b),
                "reason": b.get("reason"),
                "itemises": (
                    f"{parent_of[id(b)][0]['filename']} line {parent_of[id(b)][1].get('line_number')}"
                    if id(b) in parent_of else None
                ),
                "duplicate_of": b.get("duplicate_of"),
                "bill_total_inr": b["total"],
                "line_item_count": len(b["items"]),
            }
            for b in bills
        ],
        "superseded_summary_lines": superseded,
        "reference_charge_sheets": [
            {"document_id": b["document_id"], "source_document": b["filename"], "issuer_name": b["meta"].get("issuer_name"), "items": b["items"]}
            for b in references
        ],
        "bill_reconciliation_notes": notes,
        "bill_reconciliation_method": "ai" if plan else "rules",
        "primary_document_id": top_level[0]["document_id"] if top_level else None,
    }
