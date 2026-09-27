"""
Deterministic calculation tools for the adjudication agent.

Gemini is good at reading policy language and bill line items, but is not
reliable at multi-step arithmetic. Every cap / co-pay / proportionate
deduction calculation must go through one of these functions instead of
being computed by the model itself — the agent's instructions (see
``prompts.py``) require this explicitly.

Functions in this module are plain, stateless Python callables. ADK wraps
any callable passed in ``Agent(tools=[...])`` as a ``FunctionTool``,
building the function-calling schema straight from the type hints and
docstring below — so keep both accurate.
"""
from typing import Callable


def calculate_cap_deduction(
    billed_amount_inr: float,
    cap_limit_inr: float,
    cap_type: str,
) -> dict:
    """Calculates the payable amount when a policy places a cap/sub-limit on a charge.

    Use this for room rent caps, ICU caps, and any per-item or per-category
    sub-limit. Do NOT compute this deduction by hand — always call this tool.

    Args:
        billed_amount_inr: The amount actually billed/requested for this item.
        cap_limit_inr: The policy's capped/allowed limit for this item.
        cap_type: Which kind of cap this is, e.g. "room_rent_cap", "icu_cap",
            "sub_limit".

    Returns:
        A dict with: cap_applies (bool), cap_type, cap_limit_inr,
        requested_amount_inr, approved_amount_inr, deducted_amount_inr,
        proportionate_deduction_ratio (approved/requested, 1.0 if no cap
        breach — pass this ratio to apply_proportionate_deduction for any
        associated charges).
    """
    requested = round(float(billed_amount_inr), 2)
    cap = round(float(cap_limit_inr), 2) if cap_limit_inr else None

    if not cap or cap <= 0 or requested <= cap:
        return {
            "cap_applies": False,
            "cap_type": cap_type,
            "cap_limit_inr": cap,
            "requested_amount_inr": requested,
            "approved_amount_inr": requested,
            "deducted_amount_inr": 0.0,
            "proportionate_deduction_ratio": 1.0,
        }

    ratio = round(cap / requested, 6)
    return {
        "cap_applies": True,
        "cap_type": cap_type,
        "cap_limit_inr": cap,
        "requested_amount_inr": requested,
        "approved_amount_inr": cap,
        "deducted_amount_inr": round(requested - cap, 2),
        "proportionate_deduction_ratio": ratio,
    }


def apply_proportionate_deduction(
    associated_charge_inr: float,
    proportionate_deduction_ratio: float,
) -> dict:
    """Applies a proportionate deduction ratio to an associated charge.

    IRDAI rule: when room rent or ICU charges exceed the policy cap, the
    SAME proportion must be deducted from every other charge that scales
    with the room category (nursing, doctor visits, OT charges,
    consumables, etc.) — not just the room rent line itself. Use the
    ``proportionate_deduction_ratio`` returned by calculate_cap_deduction.

    Args:
        associated_charge_inr: The billed amount of the associated charge.
        proportionate_deduction_ratio: The ratio returned by
            calculate_cap_deduction (approved/requested for the room/ICU cap).

    Returns:
        A dict with requested_amount_inr, approved_amount_inr,
        deducted_amount_inr.
    """
    requested = round(float(associated_charge_inr), 2)
    ratio = max(0.0, min(1.0, float(proportionate_deduction_ratio)))
    approved = round(requested * ratio, 2)
    return {
        "requested_amount_inr": requested,
        "approved_amount_inr": approved,
        "deducted_amount_inr": round(requested - approved, 2),
    }


def calculate_copay(
    eligible_amount_inr: float,
    copay_percentage: float,
) -> dict:
    """Calculates the patient's co-pay share and the insurer-payable amount.

    Args:
        eligible_amount_inr: The amount eligible for reimbursement AFTER any
            caps/exclusions have already been applied (do not pass the raw
            billed amount).
        copay_percentage: The co-pay percentage from the policy (e.g. 10 for 10%).

    Returns:
        A dict with eligible_amount_inr, copay_percentage,
        copay_amount_inr (deducted from payout), approved_amount_inr
        (eligible minus co-pay).
    """
    eligible = round(float(eligible_amount_inr), 2)
    pct = max(0.0, float(copay_percentage))
    copay_amount = round(eligible * pct / 100.0, 2)
    return {
        "eligible_amount_inr": eligible,
        "copay_percentage": pct,
        "copay_amount_inr": copay_amount,
        "approved_amount_inr": round(eligible - copay_amount, 2),
    }


def make_non_payable_matcher(non_payable_items: list[dict]) -> Callable[[str, str], dict]:
    """Builds a `check_non_payable_item` tool bound to this claim's IRDAI list.

    Kept out of the tool's own signature (rather than passed in by the
    model) because the list is claim-independent lookup data, not something
    the LLM should have to transcribe on every call.
    """

    def check_non_payable_item(item_name: str, item_category: str = "") -> dict:
        """Checks whether a billed item is on the IRDAI non-payable items list.

        ALWAYS call this before marking an item APPROVED — non-payable items
        must be rejected with no exceptions, regardless of policy wording.

        Args:
            item_name: The billed line item's name, as it appears on the bill.
            item_category: The item's category if known (e.g. "consumables").

        Returns:
            A dict with is_non_payable (bool), matched_name, matched_keyword,
            reason — matched_name/keyword are None when there is no match.
        """
        needle = item_name.lower()
        category_needle = (item_category or "").lower()

        for entry in non_payable_items:
            name = (entry.get("name") or "").lower()
            category = (entry.get("category") or "").lower()
            keywords = [str(k).lower() for k in (entry.get("keywords") or [])]

            if name and name in needle:
                return {
                    "is_non_payable": True,
                    "matched_name": entry.get("name"),
                    "matched_keyword": None,
                    "reason": f"Matches IRDAI non-payable item '{entry.get('name')}'.",
                }
            for kw in keywords:
                if kw and kw in needle:
                    return {
                        "is_non_payable": True,
                        "matched_name": entry.get("name"),
                        "matched_keyword": kw,
                        "reason": (
                            f"Item name contains non-payable keyword '{kw}' "
                            f"(IRDAI item: '{entry.get('name')}')."
                        ),
                    }
            if category and category_needle and category == category_needle and not keywords and not name:
                return {
                    "is_non_payable": True,
                    "matched_name": entry.get("name"),
                    "matched_keyword": None,
                    "reason": f"Category '{item_category}' is fully non-payable.",
                }

        return {
            "is_non_payable": False,
            "matched_name": None,
            "matched_keyword": None,
            "reason": "No match against the IRDAI non-payable items list.",
        }

    return check_non_payable_item
