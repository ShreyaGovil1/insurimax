from datetime import date

from app.services.bill_consolidation import bill_from_payload, consolidate

ADMIT, DISCHARGE = date(2026, 3, 10), date(2026, 3, 13)


def _line(n, name, amount, when="2026-03-11", **extra):
    return {"line_number": n, "item_name": name, "total_price_inr": amount, "date": when, **extra}


def _bill(doc_id, doc_type, lines, bill=None, total=None):
    payload = {"line_items": lines}
    if bill is not None:
        payload["bill"] = bill
    if total is not None:
        payload["total_billed_inr"] = total
    return bill_from_payload(doc_id, f"{doc_id}.pdf", doc_type, payload)


def _claim():
    final = _bill("final", "itemized_bill", [
        _line(1, "Room charges", 12000),
        _line(2, "Medicines & consumables issued to ward", 4300),  # the pharmacy bill, not named
        _line(3, "Surgeon fee", 30000),
    ], bill={"bill_number": "IP-77"})
    pharmacy = _bill("pharmacy", "other", [  # uploaded in the wrong section
        _line(1, "Inj. Ceftriaxone", 300),
        _line(2, "Adult diaper", 4000),
    ], bill={"bill_number": "RX-9"})
    opd = _bill("opd", "prescription", [_line(1, "OPD consultation", 800, when="2026-03-02")], bill={})
    copy = _bill("opd_copy", "itemized_bill", [_line(1, "OPD consultation", 800, when="2026-03-02")], bill={})
    tariff = _bill("tariff", "other", [_line(1, "Deluxe room per day", 9000)], bill={"document_role": "reference_charge_sheet"})
    return [final, pharmacy, opd, copy, tariff]


AI_PLAN = {
    "final": {"document_id": "final", "role": "bill", "claim_phase": "hospitalisation"},
    "pharmacy": {"document_id": "pharmacy", "role": "itemised_breakup", "itemises": {"document_id": "final", "line_number": 2}},
    "opd": {"document_id": "opd", "role": "bill", "claim_phase": "pre_hospitalisation"},
    "opd_copy": {"document_id": "opd_copy", "role": "duplicate", "duplicate_of": "opd"},
    "tariff": {"document_id": "tariff", "role": "reference_charge_sheet"},
}


def test_ai_plan_combines_every_bill_once():
    out = consolidate(_claim(), ADMIT, DISCHARGE, AI_PLAN)
    names = [li["item_name"] for li in out["line_items"]]
    # Summary line replaced by its itemised bill, in place; separate bill added; duplicate & tariff not charged
    assert names == ["Room charges", "Inj. Ceftriaxone", "Adult diaper", "Surgeon fee", "OPD consultation"]
    assert [li["line_number"] for li in out["line_items"]] == [1, 2, 3, 4, 5]
    assert out["total_billed_inr"] == 12000 + 4300 + 30000 + 800
    assert out["superseded_summary_lines"][0]["item_name"] == "Medicines & consumables issued to ward"
    roles = {b["document_id"]: b["role"] for b in out["bills"]}
    assert roles == {
        "final": "primary_bill", "pharmacy": "itemised_breakup", "opd": "separate_bill",
        "opd_copy": "duplicate", "tariff": "reference_charge_sheet",
    }
    assert out["reference_charge_sheets"][0]["document_id"] == "tariff"
    assert out["primary_document_id"] == "final"


def test_lines_keep_their_source_and_phase():
    out = consolidate(_claim(), ADMIT, DISCHARGE, AI_PLAN)
    diaper = next(li for li in out["line_items"] if li["item_name"] == "Adult diaper")
    assert diaper["source_document"] == "pharmacy.pdf"
    assert diaper["bill_line_number"] == 2
    assert diaper["claim_phase"] == "hospitalisation"  # inherited from the final bill it itemises
    assert "final.pdf line 2" in diaper["itemises_summary_line"]
    opd = next(li for li in out["line_items"] if li["item_name"] == "OPD consultation")
    assert opd["claim_phase"] == "pre_hospitalisation"


def test_invalid_ai_link_is_counted_separately_not_dropped():
    plan = {**AI_PLAN, "pharmacy": {"document_id": "pharmacy", "role": "itemised_breakup", "itemises": {"document_id": "final", "line_number": 99}}}
    out = consolidate(_claim(), ADMIT, DISCHARGE, plan)
    assert out["total_billed_inr"] == 12000 + 4300 + 30000 + 800 + 4300
    assert any("double billing" in n for n in out["bill_reconciliation_notes"])


def test_amount_mismatch_is_reported():
    bills = _claim()
    bills[1]["total"] = 4350
    out = consolidate(bills, ADMIT, DISCHARGE, AI_PLAN)
    assert any("verify the difference" in n for n in out["bill_reconciliation_notes"])


def test_rules_fallback_uses_extracted_bill_metadata():
    final = _bill("final", "itemized_bill", [
        _line(1, "Room charges", 12000),
        _line(2, "Pharmacy", 4300, summarises_other_bill=True, referenced_bill_number="RX/9"),
    ], bill={"bill_number": "IP-77"})
    pharmacy = _bill("pharmacy", "itemized_bill", [_line(1, "Inj. Ceftriaxone", 300), _line(2, "Adult diaper", 4000)],
                     bill={"bill_number": "RX-9", "document_role": "itemised_breakup"})
    dup = _bill("dup", "itemized_bill", [_line(1, "Inj. Ceftriaxone", 300), _line(2, "Adult diaper", 4000)],
                bill={"bill_number": "RX 9"})
    out = consolidate([final, pharmacy, dup], ADMIT, DISCHARGE)
    assert out["bill_reconciliation_method"] == "rules"
    assert out["total_billed_inr"] == 16300
    assert {b["document_id"]: b["role"] for b in out["bills"]}["dup"] == "duplicate"


def test_summary_line_without_breakup_and_dates_drive_phase():
    final = _bill("final", "itemized_bill", [_line(1, "Pharmacy", 4300, summarises_other_bill=True)], bill={})
    post = _bill("post", "itemized_bill", [_line(1, "Follow-up visit", 600, when="2026-03-25")], bill={})
    out = consolidate([final, post], ADMIT, DISCHARGE)
    assert out["total_billed_inr"] == 4900
    assert out["line_items"][1]["claim_phase"] == "post_hospitalisation"
    assert any("assessed as one amount" in n for n in out["bill_reconciliation_notes"])


def test_document_without_charges_is_ignored():
    assert bill_from_payload("x", "x.pdf", "discharge_summary", {"line_items": []}) is None
