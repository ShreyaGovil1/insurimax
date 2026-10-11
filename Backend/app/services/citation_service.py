"""
Source citations for extracted data and adjudication reasons.

- Extraction: Gemini returns, for every extracted list item, the page and the verbatim text it
  read ("source"). We locate that text on the PDF's text layer and store highlight rectangles
  (normalised 0-1 page coordinates) so the UI can show the exact spot. Images and scanned PDFs
  without a text layer get a page/image reference only.
- Adjudication (lightweight RAG): the claim's policy document is split into passages and ranked
  per bill line item with BM25; the agent must cite the passages it relied on.
"""
import math
import re
from collections import Counter
from difflib import SequenceMatcher

import pymupdf

_WORD = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on",
    "or", "the", "to", "with", "per", "any", "all", "this", "that", "will", "shall", "under",
}
_MIN_MATCH_SCORE = 0.6       # share of the cited tokens that must be found in order on the page
_PASSAGE_MAX_CHARS = 700
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_RENDER_MAX_WIDTH = 1400     # px


def _normalise(token: str) -> str:
    token = token.replace(",", "")
    if re.fullmatch(r"\d+\.0+", token):  # "1500.00" == "1500"
        token = token.split(".")[0]
    return token


def _tokens(text: str) -> list[str]:
    return [_normalise(t) for t in _WORD.findall((text or "").lower())]


def is_pdf(mime_type: str | None, filename: str | None) -> bool:
    return (mime_type or "").lower() == "application/pdf" or (filename or "").lower().endswith(".pdf")


# ── PDF text layer ─────────────────────────────────────────────────────────────

def _load_pages(file_bytes: bytes) -> list[dict]:
    """
    Per page: size and two token sequences pointing at word boxes. "tokens" follows the PDF's
    block order (good for paragraphs); "row_tokens" follows visual rows top-to-bottom and
    left-to-right, so the cells of one table row (e.g. a bill line) are adjacent.
    """
    pages = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        for page in pdf:
            tokens = []
            for x0, y0, x1, y1, word, block, line, _ in page.get_text("words"):
                for tok in _tokens(word):
                    tokens.append({"tok": tok, "rect": (x0, y0, x1, y1), "line": (block, line)})
            pages.append({
                "width": page.rect.width,
                "height": page.rect.height,
                "tokens": tokens,
                "row_tokens": _visual_rows(tokens),
            })
    return pages


def _visual_rows(tokens: list[dict]) -> list[dict]:
    """Re-order tokens by visual row (words whose vertical centres are within half a line)."""
    ordered = sorted(tokens, key=lambda t: ((t["rect"][1] + t["rect"][3]) / 2, t["rect"][0]))
    rows: list[list[dict]] = []
    row_mid = None
    for t in ordered:
        mid = (t["rect"][1] + t["rect"][3]) / 2
        half = (t["rect"][3] - t["rect"][1]) / 2
        if rows and abs(mid - row_mid) <= half:
            rows[-1].append(t)
        else:
            rows.append([t])
            row_mid = mid
    out = []
    for idx, row in enumerate(rows):
        for t in sorted(row, key=lambda t: t["rect"][0]):
            out.append({**t, "line": ("row", idx)})
    return out


def _best_window(query: list[str], tokens: list[dict]) -> tuple[float, list[dict]]:
    """Best fuzzy match of the query tokens against a contiguous window of page tokens."""
    if not query or not tokens:
        return 0.0, []
    words = [t["tok"] for t in tokens]
    qset = set(query)
    span = len(query) + max(3, len(query) // 2)  # allow for extra columns/tokens inside the row
    best_score, best_hits = 0.0, []
    for start, word in enumerate(words):
        if word not in qset:
            continue
        window = words[start:start + span]
        blocks = SequenceMatcher(None, query, window, autojunk=False).get_matching_blocks()
        matched = sum(b.size for b in blocks)
        score = matched / len(query)
        if score > best_score:
            best_score = score
            best_hits = [tokens[start + b.b + k] for b in blocks for k in range(b.size)]
            if score == 1.0:
                break
    return best_score, best_hits


def _line_rects(hits: list[dict], width: float, height: float) -> list[list[float]]:
    """Merge matched word boxes into one rectangle per text line, normalised to 0-1."""
    lines: dict[tuple, list[float]] = {}
    for h in hits:
        x0, y0, x1, y1 = h["rect"]
        r = lines.get(h["line"])
        lines[h["line"]] = [min(r[0], x0), min(r[1], y0), max(r[2], x1), max(r[3], y1)] if r else [x0, y0, x1, y1]
    return [
        [round(r[0] / width, 4), round(r[1] / height, 4), round(r[2] / width, 4), round(r[3] / height, 4)]
        for r in lines.values()
    ]


def locate_text(pages: list[dict], text: str, page_hint: int | None = None) -> dict:
    """Find cited text in the PDF. Returns page (1-based), rects, match quality."""
    query = _tokens(text)
    has_text = any(p["tokens"] for p in pages)
    if not query or not has_text:
        page = page_hint if page_hint and 1 <= page_hint <= len(pages) else None
        return {"page": page, "rects": [], "match": "page" if page else "none"}

    order = list(range(len(pages)))
    if page_hint and 1 <= page_hint <= len(pages):  # try the page Gemini named first
        order.remove(page_hint - 1)
        order.insert(0, page_hint - 1)
    best = (0.0, None, [])
    for idx in order:
        for seq in ("row_tokens", "tokens"):
            score, hits = _best_window(query, pages[idx][seq])
            if score > best[0]:
                best = (score, idx, hits)
            if score == 1.0:
                break
        if best[0] == 1.0:
            break

    score, idx, hits = best
    if idx is None or score < _MIN_MATCH_SCORE:
        page = page_hint if page_hint and 1 <= page_hint <= len(pages) else None
        return {"page": page, "rects": [], "match": "page" if page else "none"}
    page = pages[idx]
    return {
        "page": idx + 1,
        "rects": _line_rects(hits, page["width"], page["height"]),
        "match": "exact" if score == 1.0 else "fuzzy",
        "score": round(score, 2),
    }


# ── Extraction payloads ────────────────────────────────────────────────────────

def attach_citations(
    payload: dict,
    *,
    document_id: str,
    filename: str,
    mime_type: str | None,
    file_bytes: bytes,
) -> int:
    """
    Replace every {"source": {"page", "text"}} Gemini produced inside the payload with a full
    citation (document, page, verbatim text, highlight rects). Returns the number of citations.
    """
    pdf = is_pdf(mime_type, filename)
    pages = None
    if pdf:
        try:
            pages = _load_pages(file_bytes)
        except Exception:
            pages = []
    count = 0

    def build(src: dict) -> dict:
        text = str(src.get("text") or "").strip()
        try:
            hint = int(src.get("page")) if src.get("page") is not None else None
        except (TypeError, ValueError):
            hint = None
        citation = {
            "document_id": document_id,
            "filename": filename,
            "kind": "pdf" if pdf else "image",
            "text": text,
        }
        if pdf:
            citation.update(locate_text(pages or [], text, hint))
        else:
            citation.update({"page": 1, "rects": [], "match": "image"})
        return citation

    def visit(node):
        nonlocal count
        if isinstance(node, dict):
            src = node.get("source")
            if isinstance(src, dict) and (src.get("text") or src.get("page")) and "document_id" not in src:
                node["source"] = build(src)
                count += 1
            for key, value in node.items():
                if key != "source":
                    visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(payload)
    return count


# ── Page rendering ─────────────────────────────────────────────────────────────

def pdf_page_count(file_bytes: bytes) -> int:
    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        return pdf.page_count


def render_pdf_page(file_bytes: bytes, page_number: int) -> bytes:
    """PNG of a 1-based PDF page, scaled to at most _RENDER_MAX_WIDTH pixels wide."""
    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        if not 1 <= page_number <= pdf.page_count:
            raise IndexError(f"Page {page_number} out of range (1-{pdf.page_count})")
        page = pdf[page_number - 1]
        zoom = min(2.0, _RENDER_MAX_WIDTH / max(page.rect.width, 1))
        return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("png")


# ── Policy passages + BM25 retrieval (RAG) ─────────────────────────────────────

def pdf_passages(file_bytes: bytes, *, document_id: str, filename: str) -> list[dict]:
    """Split a text-layer PDF into passages (consecutive text blocks), each with its citation."""
    passages = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        for page in pdf:
            w, h = page.rect.width, page.rect.height
            buf, rects = "", []
            for x0, y0, x1, y1, text, _, block_type in page.get_text("blocks"):
                if block_type != 0 or not text.strip():
                    continue
                if buf and len(buf) + len(text) > _PASSAGE_MAX_CHARS:
                    passages.append(_passage(buf, page.number + 1, rects, document_id, filename))
                    buf, rects = "", []
                buf += " " + " ".join(_CONTROL_CHARS.sub(" ", text).split())
                rects.append([round(x0 / w, 4), round(y0 / h, 4), round(x1 / w, 4), round(y1 / h, 4)])
            if buf.strip():
                passages.append(_passage(buf, page.number + 1, rects, document_id, filename))
    return passages


def _passage(text: str, page: int, rects: list, document_id: str, filename: str) -> dict:
    return {
        "text": text.strip(),
        "citation": {
            "document_id": document_id,
            "filename": filename,
            "kind": "pdf",
            "page": page,
            "text": text.strip(),
            "rects": rects,
            "match": "exact",
        },
    }


def bm25_rank(query: str, passages: list[dict], k: int = 3) -> list[int]:
    """Indexes of the k passages most relevant to the query (BM25, k1=1.5, b=0.75)."""
    q = [t for t in _tokens(query) if t not in _STOPWORDS]
    if not q or not passages:
        return []
    docs = [[t for t in _tokens(p["text"]) if t not in _STOPWORDS] for p in passages]
    n = len(docs)
    avgdl = sum(len(d) for d in docs) / n or 1
    df = Counter(t for d in docs for t in set(d))
    scores = []
    for i, d in enumerate(docs):
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * 2.5 / (tf[t] + 1.5 * (1 - 0.75 + 0.75 * len(d) / avgdl))
        scores.append((s, i))
    return [i for s, i in sorted(scores, reverse=True)[:k] if s > 0]
