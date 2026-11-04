"""Shared, deterministic helpers for the package extractor.

Nothing in this module executes page scripts, follows links or touches the network.
Every value comes from a literal match on visible page text; unknown values stay None.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, DecimalException
from typing import Iterable
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Comment, Tag

from .errors import PackageError

SCHEMA_VERSION = "package-observation/1"
SITES = ("atrativa", "niel", "valle", "augustus", "generic")
RETRIEVALS = ("fixture", "static_html", "rendered_dom")
MAX_HTML_BYTES = 5 * 1024 * 1024
MAX_NODES = 250_000
MAX_URL_LENGTH = 2048
MAX_MINOR = 10**12

# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

_OBSERVED_AT = re.compile(r"(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})")


def check_html(html: object) -> bytes:
    """Return the UTF-8 bytes of the page or raise a stable error."""
    if not isinstance(html, str):
        raise PackageError("HTML_NOT_TEXT")
    if len(html) > MAX_HTML_BYTES:
        raise PackageError("HTML_TOO_LARGE")
    try:
        raw = html.encode("utf-8")
    except UnicodeEncodeError:
        raise PackageError("HTML_NOT_UTF8") from None
    if len(raw) > MAX_HTML_BYTES:
        raise PackageError("HTML_TOO_LARGE")
    return raw


def check_url(url: object) -> str:
    """Accept only absolute https URLs made of printable ASCII."""
    if not isinstance(url, str) or not url:
        raise PackageError("URL_INVALID")
    if len(url) > MAX_URL_LENGTH:
        raise PackageError("URL_TOO_LONG")
    if not re.fullmatch(r"[\x21-\x7e]+", url):
        raise PackageError("URL_INVALID")
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not url.lower().startswith("https://"):
        raise PackageError("URL_NOT_HTTPS")
    try:
        host = parts.hostname
        parts.port  # noqa: B018 - raises ValueError on a malformed port
    except ValueError:
        raise PackageError("URL_INVALID") from None
    if not host or parts.username is not None or parts.password is not None:
        raise PackageError("URL_INVALID")
    return url


def check_observed_at(observed_at: object) -> date:
    """Validate an RFC 3339 timestamp with offset; return its date as written."""
    if not isinstance(observed_at, str):
        raise PackageError("OBSERVED_AT_INVALID")
    match = _OBSERVED_AT.fullmatch(observed_at)
    if not match:
        raise PackageError("OBSERVED_AT_INVALID")
    try:
        datetime.fromisoformat(observed_at)
        return date.fromisoformat(match[1])
    except ValueError:
        raise PackageError("OBSERVED_AT_INVALID") from None


def check_retrieval(retrieval: object) -> str:
    if retrieval not in RETRIEVALS:
        raise PackageError("RETRIEVAL_INVALID")
    return str(retrieval)


def check_site(site: object) -> str:
    if site not in SITES:
        raise PackageError("SITE_INVALID")
    return str(site)


# ---------------------------------------------------------------------------
# Text normalisation, privacy and instruction filters
# ---------------------------------------------------------------------------

_ZERO_WIDTH = dict.fromkeys((0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD), None)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_ZERO_WIDTH)).strip()


# Patterns evaluated on the original text.
_CONTACT_PATTERNS = (
    re.compile(r"whats\s*app|wa\.me|zap\s*zap|telegram|t\.me/", re.I),
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{3,}"),
    re.compile(r"https?://|www\.|(?<!\w)(?:mailto|tel):", re.I),
    # Any host name: labels plus a lower-case alphabetic TLD (no closed TLD list), such as
    # "linktr.ee/x" or "bit.ly/x". Sentences restart in upper case, which keeps "fim.Volta" out.
    re.compile(
        r"(?<![\w.@-])[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
        r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[a-z]{2,24}(?![\w-])"
    ),
    re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-\d{2}\b"),
    re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\bCEP\b|\b\d{5}-\d{3}\b", re.I),
    re.compile(r"\bn[º°]\s*\d", re.I),
    re.compile(
        r"\b(?:rua|r\.|avenida|av\.?|travessa|tv\.|alameda|rodovia|estrada)\s+[^,;\n]{1,60}?"
        r"(?:,|\s)\s*(?:n[º°o.]?\s*)?(?:\d{1,5}|s/n)\b",
        re.I,
    ),
)

# Phone detection runs on a masked copy: dates, times and money amounts become same-length
# placeholders first, so their digits never join a phone-like run and positions still match.
_DATE_MASK = re.compile(r"(?<!\d)\d{1,2}/\d{1,2}(?:/\d{4}|/\d{2})?(?![\d/])")
_TIME_MASK = re.compile(r"(?<!\d)\d{1,2}\s?(?::\s?[0-5]\d|[hH](?:\s?[0-5]\d)?)(?!\d)")
_PLAIN_AMOUNT_MASK = re.compile(r"(?<![\d.,])\d{1,3}(?:\.\d{3})+,\d{2}(?!\d)")
# Eight or more digits once spaces (NBSP included), dots, hyphens and parentheses are ignored.
_PHONE_RUN = re.compile(r"(?<![\w+])\+?\(?\d(?:[\s().\-]*\d){7,}")
_SERVICE_NUMBER = re.compile(r"(?<!\d)(?:0800|0300|4004|4003)(?:[\s.\-]*\d){3,}")


def _masked(text: str) -> str:
    chars = list(text)
    for pattern in (MONEY_RE, _PLAIN_AMOUNT_MASK, _DATE_MASK, _TIME_MASK):
        for match in pattern.finditer(text):
            chars[match.start() : match.end()] = "#" * (match.end() - match.start())
    return "".join(chars)


def unsafe_spans(text: str, *, instructions: bool = True) -> list[tuple[int, int]]:
    """Spans of ``text`` that hold contact data (and, optionally, injected instructions)."""
    spans = [match.span() for pattern in _CONTACT_PATTERNS for match in pattern.finditer(text)]
    masked = _masked(text)
    spans += [match.span() for pattern in (_PHONE_RUN, _SERVICE_NUMBER) for match in pattern.finditer(masked)]
    if instructions:
        spans += [match.span() for match in INSTRUCTION.finditer(text)]
    return sorted(spans)


def excerpt(text: str, start: int, before: int = 60) -> str:
    """Text from about ``before`` characters ahead of ``start`` to the end of ``text``.

    The beginning is moved to a word boundary and past any contact span it would cut, so a
    phone number is never split into an innocent-looking fragment. The end is left whole:
    :meth:`Observation.put` filters the complete text before shortening it.
    """
    if len(text) <= 240:
        return text  # a short text is quoted whole
    begin = max(0, start - before)
    if begin > 0:
        space = text.find(" ", begin)
        begin = space + 1 if 0 <= space < start else start
    for span_start, span_end in unsafe_spans(text, instructions=False):
        if span_start < begin < span_end:
            begin = span_end
    return text[begin:]


INSTRUCTION = re.compile(
    r"ignor(?:e|ar|em|ando)\s+(?:as\s+|todas\s+as\s+|all\s+|the\s+|any\s+)?"
    r"(?:instru[cç][õo]es|previous|prior|anteriores|regras|instructions)"
    r"|desconsider\w*\s+(?:as\s+|todas\s+as\s+)?(?:instru|regras|orienta)"
    r"|instru[cç][õo]es\s+anteriores|previous\s+instructions|system\s+prompt|prompt\s+do\s+sistema"
    r"|(?:assistente|assistant|modelo|agente|\bia\b)\s*[:,]?\s*(?:ignore|esque[cç]a|forget|desconsidere)",
    re.I,
)


def has_contact(text: str) -> bool:
    return bool(unsafe_spans(text, instructions=False))


def is_unsafe(text: str) -> bool:
    return bool(unsafe_spans(text))


def truncate_words(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    space = cut.rfind(" ")
    if space >= limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:-"), True


_LEADING_JUNK = re.compile(r"^[^\w(À-ɏ]+")
_TRAILING_JUNK = re.compile(r"[\s,;:.\-]+$")


def strip_decoration(text: str) -> str:
    """Remove bullets, emoji and punctuation around a literal phrase."""
    return _TRAILING_JUNK.sub("", _LEADING_JUNK.sub("", norm(text)))


# ---------------------------------------------------------------------------
# Document preparation
# ---------------------------------------------------------------------------

_REMOVED_TAGS = (
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "iframe",
    "object",
    "embed",
    "canvas",
    "video",
    "audio",
    "picture",
    "img",
    "select",
    "button",
    "address",
    "head",
    "link",
    "meta",
    "input",
    "textarea",
    "title",
)
_BLOCK_TAGS = (
    "article",
    "aside",
    "blockquote",
    "caption",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "summary",
    "table",
    "tbody",
    "tfoot",
    "thead",
    "tr",
    "ul",
)
_HIDDEN_STYLE = re.compile(
    r"(?:^|;)(?:display:none|visibility:(?:hidden|collapse)|opacity:0(?:\.0+)?(?:[;!]|$)"
    r"|font-size:0(?:px|pt|em|rem)?(?:[;!]|$))"
)
_OFFSCREEN_STYLE = re.compile(r"(?:left|top):-[1-9][0-9]{2,}(?:px|em)|clip:rect\(0")


def _is_hidden(node: Tag) -> bool:
    if node.has_attr("hidden") or node.has_attr("inert"):
        return True
    if str(node.get("aria-hidden", "")).lower() == "true":
        return True
    style = re.sub(r"/\*.*?\*/", "", str(node.get("style", "")), flags=re.DOTALL).lower()
    compact = re.sub(r"\s+", "", style)
    return bool(_HIDDEN_STYLE.search(compact) or _OFFSCREEN_STYLE.search(compact))


class Document:
    """Visible-text view of a page. Scripts are removed, never evaluated.

    The only script content kept is the raw text of ``application/ld+json`` blocks, which
    callers may read with ``json.loads``; nothing is executed.
    """

    def __init__(self, html: str):
        soup = BeautifulSoup(html, "html.parser")
        if len(soup.find_all(True)) > MAX_NODES:
            raise PackageError("HTML_TOO_COMPLEX")
        self.warnings: set[str] = set()
        title = soup.find("title")
        self.head_title = norm(title.get_text()) if title else ""
        self.jsonld: list[str] = []
        for script in soup.find_all("script"):
            if str(script.get("type", "")).strip().lower() == "application/ld+json":
                self.jsonld.append(script.get_text())
        for comment in soup.find_all(string=lambda item: isinstance(item, Comment)):
            comment.extract()
        for node in soup.find_all(list(_REMOVED_TAGS)):
            node.decompose()
        hidden_texts: list[str] = []
        for node in reversed(soup.find_all(True)):
            if _is_hidden(node):
                hidden_texts.append(norm(node.get_text(" ")))
                node.decompose()
                self.warnings.add("HIDDEN_CONTENT_REMOVED")
        if any(INSTRUCTION.search(text) for text in hidden_texts):
            self.warnings.add("UNTRUSTED_INSTRUCTION_DETECTED")
        for br in soup.find_all("br"):
            br.replace_with("\n")
        for node in soup.find_all(list(_BLOCK_TAGS)):
            node.insert_before("\n")
            node.insert_after("\n")
        for node in soup.find_all(["td", "th"]):
            node.insert_after(" ")
        self.soup = soup

    def lines(self) -> list[str]:
        return lines_of(self.soup)

    def scan_instructions(self) -> None:
        if any(INSTRUCTION.search(line) for line in self.lines()):
            self.warnings.add("UNTRUSTED_INSTRUCTION_DETECTED")


def lines_of(node) -> list[str]:
    out = []
    for raw in node.get_text().split("\n"):
        line = norm(raw)
        if line:
            out.append(line)
    return out


def text_lines(text: str) -> list[str]:
    """Split a plain or HTML text fragment (for example a JSON-LD description) into lines."""
    if re.search(r"<[A-Za-z/!]", text):
        return Document(text).lines()
    return [line for line in (norm(raw) for raw in re.split(r"\r\n|\r|\n", text)) if line]


def first_heading(doc: Document, names: Iterable[str] = ("h1",)) -> str | None:
    for name in names:
        for node in doc.soup.find_all(name):
            text = norm(node.get_text(" "))
            if text:
                return text
    return None


# ---------------------------------------------------------------------------
# Money, dates and times
# ---------------------------------------------------------------------------

# Brazilian amounts: "R$ 1.299", "R$ 1.299,00", "R$ 0,99" and, strictly in groups of three with
# one consistent separator, "R$ 1 299,00" (space or NBSP). A malformed amount does not match at
# all ("R$ 1 299,0", "R$ 1.299,5", "R$ 12.34"): a prefix of it is never returned.
_THOUSANDS = r"(?P<sep>[. " + chr(0xA0) + r"])"
MONEY = (
    r"R\$\s*(?P<int>\d{1,3}" + _THOUSANDS + r"\d{3}(?:(?P=sep)\d{3})*|\d{1,9})"
    r"(?:,(?P<cents>\d{2})(?![\d]|[.,]\d)|(?![\d]|[.,]\d|[ " + chr(0xA0) + r"]\d))"
)
MONEY_RE = re.compile(MONEY)
_INSTALLMENT_WORD = r"(?:[xX]|parcelas?|vezes)"
INSTALLMENT_RE = re.compile(
    r"(?<!\d)(?P<count>\d{1,2})\s*" + _INSTALLMENT_WORD + r"\s*(?:de\s*)?" + MONEY, re.I
)
_INSTALLMENT_BEFORE = re.compile(r"\d\s*" + _INSTALLMENT_WORD + r"\s*(?:de\s*)?$", re.I)


def money_minor(match: re.Match) -> int | None:
    whole = int(re.sub(r"\D", "", match["int"]))
    cents = int(match["cents"] or "0")
    minor = whole * 100 + cents
    return minor if 0 <= minor <= MAX_MINOR else None


def first_money(text: str, *, skip_installments: bool = True) -> re.Match | None:
    """First R$ amount that is not the per-installment value of an ``N x/parcelas/vezes de`` phrase."""
    for match in MONEY_RE.finditer(text):
        before = text[max(0, match.start() - 24) : match.start()]
        if skip_installments and _INSTALLMENT_BEFORE.search(before):
            continue
        return match
    return None


def decimal_minor(value: object) -> int | None:
    """Minor units of a JSON-LD number; None for anything malformed, negative or absurd."""
    if isinstance(value, bool) or value is None:
        return None
    text = str(value).strip()
    if len(text) > 32:
        return None
    try:
        amount = Decimal(text)
        if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2 or amount.adjusted() > 12:
            return None
        minor = int(amount * 100)
    except (DecimalException, ValueError, OverflowError):
        return None
    return minor if minor <= MAX_MINOR else None


MONTHS = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}
_FULL_MONTHS = {
    "janeiro",
    "fevereiro",
    "março",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
}


def month_number(word: str) -> int | None:
    lowered = word.lower().rstrip(".")
    if len(lowered) == 3 or lowered in _FULL_MONTHS:
        return MONTHS.get(lowered[:3])
    return None


TIME_PART = (
    r"(?:\s*[,\-]?\s*(?:[àáa]s\s+|[àáa]s(?=\d))?(?P<hh>\d{1,2})"
    r"\s*(?:[:hH]\s*(?P<mm>[0-5]\d)|[hH])(?![\d]))?"
)
NUMERIC_DATE = r"(?P<d>\d{1,2})/(?P<m>\d{1,2})(?:/(?P<y>\d{4}|\d{2}))?(?![\d/])"
NUMERIC_MOMENT_RE = re.compile(r"^[^\d]{0,30}?" + NUMERIC_DATE + TIME_PART, re.I)
FULL_DATE_MOMENT_RE = re.compile(
    r"(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{4}|\d{2})(?![\d/])" + TIME_PART, re.I
)
DAY_MONTH_RE = re.compile(
    r"^[^\d]{0,10}?(?P<d>\d{1,2})\s*(?:de\s+)?(?P<mon>[A-Za-zçÇ]{3,9})\.?(?:\s+de\s+(?P<y>\d{4}))?",
    re.I,
)
DAYS_NIGHTS_RE = re.compile(
    r"(?P<days>\d{1,2})\s*dias?\s*(?:e|/|\||,|-)\s*(?P<nights>\d{1,2})\s*noites?", re.I
)


def clock(hh: str | None, mm: str | None) -> str | None:
    if hh is None:
        return None
    hour, minute = int(hh), int(mm or "0")
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


# ---------------------------------------------------------------------------
# Observation builder
# ---------------------------------------------------------------------------


def blank_moment() -> dict:
    return {"date": None, "time": None, "yearStated": False}


def blank_observation(source: dict) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": source,
        "title": None,
        "destination": None,
        "modal": "unknown",
        "departure": blank_moment(),
        "returnDeparture": blank_moment(),
        "returnArrival": blank_moment(),
        "days": None,
        "nights": None,
        "lodging": {"name": None, "nightsIncluded": None},
        "breakfast": {"status": "unknown", "count": None},
        "price": {
            "amountMinor": None,
            "currency": "BRL",
            "basis": "unknown",
            "qualifier": "unknown",
            "installments": None,
        },
        "mandatoryFees": [],
        "included": [],
        "excluded": [],
        "boardingCities": [],
        "evidence": [],
        "warnings": [],
    }


def safe_prefix(text: str, limit: int = 240) -> str | None:
    """The longest clean beginning of ``text``, at most ``limit`` characters, or None.

    The whole text is filtered first and cut *before* the first contact or instruction span;
    only then is it shortened. A phone number straddling the limit therefore never leaves a
    harmless-looking fragment behind.
    """
    text = norm(text)
    spans = unsafe_spans(text)
    if spans:
        text = text[: spans[0][0]]
    text = text[:limit].rstrip(" ,;:-(+[")
    if not text or is_unsafe(text):
        return None
    return text


class Observation:
    """Collects literal values and their evidence; serialises to the package contract."""

    def __init__(self, source: dict, observed_date: date):
        self.data = blank_observation(source)
        self.observed_date = observed_date
        self.warnings: set[str] = set()
        self._evidence: dict[str, str] = {}

    def warn(self, code: str) -> None:
        self.warnings.add(code)

    def _safe_quote(self, quote: str, fallback: str | None) -> str | None:
        for candidate in (quote, fallback):
            if candidate:
                text = safe_prefix(candidate)
                if text:
                    return text
        return None

    def put(self, path: str, value, quote: str, fallback: str | None = None) -> bool:
        """Set ``path`` to ``value`` only when a safe literal quote supports it."""
        if value is None:
            return False
        safe = self._safe_quote(quote, fallback)
        if safe is None:
            self.warn("UNSAFE_EVIDENCE_VALUE_DROPPED")
            return False
        target = self.data
        keys = path.split(".")
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        self._evidence[path] = safe
        return True

    def put_text(self, path: str, raw: str | None, limit: int, quote: str | None = None) -> bool:
        value = self.clean(raw, limit)
        if value is None:
            return False
        return self.put(path, value, quote or value, value)

    def clean(self, raw: str | None, limit: int) -> str | None:
        """Normalise a literal phrase; drop it when it carries contacts or instructions."""
        if raw is None:
            return None
        text = strip_decoration(raw)
        if not text:
            return None
        if has_contact(text):
            self.warn("CONTACT_DATA_DROPPED")
            return None
        if INSTRUCTION.search(text):
            self.warn("UNTRUSTED_INSTRUCTION_DETECTED")
            return None
        text, cut = truncate_words(text, limit)
        if cut:
            self.warn("TEXT_TRUNCATED")
        return text or None

    def put_list(
        self, path: str, items: Iterable[str], limit: int, max_items: int, quote: str | None
    ) -> None:
        values: list[str] = []
        for item in items:
            value = self.clean(item, limit)
            if value and value not in values:
                values.append(value)
        if len(values) > max_items:
            self.warn("LIST_TRUNCATED")
            values = values[:max_items]
        if values:
            self.put(path, values, quote or values[0], values[0])

    def put_moment(
        self, prefix: str, iso: str | None, year_stated: bool, time: str | None, quote: str
    ) -> None:
        # A time is only meaningful next to the date it belongs to.
        if iso is not None and self.put(f"{prefix}.date", iso, quote):
            self.data[prefix]["yearStated"] = year_stated
            if time is not None:
                self.put(f"{prefix}.time", time, quote)

    def add_fee(self, fee: dict, quote: str) -> None:
        fees = self.data["mandatoryFees"]
        if len(fees) >= 20 or fee in fees:
            return
        safe = self._safe_quote(quote, None)
        if safe is None:
            self.warn("UNSAFE_EVIDENCE_VALUE_DROPPED")
            return
        fees.append(fee)
        self._evidence[f"mandatoryFees[{len(fees) - 1}]"] = safe

    def resolve_date(
        self, day: str, month: int | str | None, year: str | None, anchor: date
    ) -> tuple[str | None, bool]:
        """Literal date when the year is written; otherwise the next occurrence on/after ``anchor``."""
        try:
            day_number = int(day)
            month_number_ = int(month) if month is not None else 0
        except ValueError:
            return None, False
        if year:
            full_year = int(year) + (2000 if len(year) == 2 else 0)
            try:
                return date(full_year, month_number_, day_number).isoformat(), True
            except ValueError:
                self.warn("INVALID_DATE_IGNORED")
                return None, False
        for candidate_year in range(anchor.year, anchor.year + 9):
            try:
                candidate = date(candidate_year, month_number_, day_number)
            except ValueError:
                continue
            if candidate >= anchor:
                self.warn("YEAR_NOT_STATED")
                return candidate.isoformat(), False
        self.warn("INVALID_DATE_IGNORED")
        return None, False

    def return_anchor(self) -> date:
        """Return legs are anchored to the departure date when one is known.

        A past departure with a stated year (``10/01/26``) keeps its return in the same trip
        (``12/01`` -> 2026-01-12); the observation date is only the fallback anchor.
        """
        departure = self.data["departure"]["date"]
        if departure:
            return date.fromisoformat(departure)
        return self.observed_date

    def reset(self, prefixes: Iterable[str]) -> None:
        """Return the given top-level fields to their unknown state and drop their evidence."""
        blank = blank_observation(self.data["source"])
        for prefix in prefixes:
            self.data[prefix] = blank[prefix]
            for field in [field for field in self._evidence if field.split(".")[0].split("[")[0] == prefix]:
                del self._evidence[field]

    def finish(self, extra_warnings: Iterable[str] = ()) -> dict:
        self.warnings.update(extra_warnings)
        evidence = [{"field": field, "quote": quote} for field, quote in self._evidence.items()]
        self.data["evidence"] = evidence[:60]
        self.data["warnings"] = sorted(self.warnings)[:30]
        return self.data


# ---------------------------------------------------------------------------
# Label search helpers shared by the site parsers
# ---------------------------------------------------------------------------


class Hit:
    """A label found in a line: ``value`` is the text after it, ``quote`` starts at the label."""

    __slots__ = ("value", "quote", "index")

    def __init__(self, value: str, quote: str, index: int):
        self.value = value
        self.quote = quote
        self.index = index


def find_labels(lines: list[str], label: str, *, colon: bool = False) -> Iterable[Hit]:
    """Yield every occurrence of ``label`` (a regex) with the text that follows it.

    When nothing follows the label on its own line, the next line is used as the value.
    """
    pattern = re.compile(r"(?<!\w)(?:" + label + r")(?!\w)\s*" + (r":" if colon else r":?") + r"\s*", re.I)
    for index, line in enumerate(lines):
        for match in pattern.finditer(line):
            value = line[match.end() :]
            quote = line[match.start() :]
            if not value.strip() and index + 1 < len(lines):
                value = lines[index + 1]
                quote = f"{quote} {value}"
            yield Hit(value, quote, index)


def find_label(lines: list[str], label: str, *, colon: bool = False) -> Hit | None:
    for hit in find_labels(lines, label, colon=colon):
        if hit.value.strip():
            return hit
    return None


def find_numeric_moment(lines: list[str], label: str, *, colon: bool = False):
    """First ``label`` followed by ``dd/mm[/yy[yy]] [às HH:MM]``."""
    for hit in find_labels(lines, label, colon=colon):
        match = NUMERIC_MOMENT_RE.match(hit.value)
        if match:
            return match, hit
    return None


def put_numeric_moment(obs: Observation, prefix: str, found, anchor: date) -> None:
    if not found:
        return
    match, hit = found
    iso, stated = obs.resolve_date(match["d"], match["m"], match["y"], anchor)
    obs.put_moment(prefix, iso, stated, clock(match["hh"], match["mm"]), hit.quote)


_ASCII_BULLET_START = re.compile(r"^\s*[\-+*" + chr(0x2022) + r"]")


def block_lines(lines: list[str], start: re.Pattern, stop: re.Pattern, max_lines: int = 60):
    """Lines of the block that starts with ``start`` and ends before a ``stop`` heading."""
    for index, line in enumerate(lines):
        match = start.search(line)
        if not match:
            continue
        rest = line[match.end() :]
        stop_inline = stop.search(rest)
        if stop_inline and stop_inline.start() > 0:
            rest = rest[: stop_inline.start()]
        collected = [rest] if strip_decoration(rest) else []
        for following in lines[index + 1 : index + 1 + max_lines]:
            # A bulleted line is an item of the current block, never the next heading.
            if stop.search(following) and not _ASCII_BULLET_START.match(following):
                break
            collected.append(following)
        # Evidence: the heading followed by its items, up to the first unsafe line.
        quote_parts = [line[match.start() :]]
        for item in collected:
            if is_unsafe(item):
                break
            quote_parts.append(item)
        return collected, " ".join(quote_parts)
    return [], None


# Bullet glyphs and the Unicode dash-punctuation range U+2010..U+2015 separate list items.
_BULLET_GLYPHS = "".join(
    map(chr, (*range(0x2010, 0x2016), 0x2022, 0x2192, 0x25AA, 0x25CF, 0x2705, 0x2714, 0x27A1))
)
# A "+" that starts an international phone number is not a bullet: the item must stay whole
# so the contact filter can discard it.
_PLUS_BULLET = r"\+(?!\s?\d{2}[\s.-]?\(?\d{2}\)?[\s.-]?\d{4,5})"
_BULLETS = re.compile(r"(?:^|\s)(?:[\-*" + _BULLET_GLYPHS + r"]|" + _PLUS_BULLET + r")+\s*")


def split_items(lines: Iterable[str]) -> list[str]:
    items: list[str] = []
    for line in lines:
        for part in _BULLETS.split(line):
            text = strip_decoration(part)
            if text:
                items.append(text)
    return items


# ---------------------------------------------------------------------------
# Semantic helpers (modal, breakfast, lodging nights, price basis, fees)
# ---------------------------------------------------------------------------

_BUS = re.compile(
    r"(?<!\w)(?:[ôo]nibus|rodovi[áa]ri[oa]s?|micro-?[ôo]nibus|semi-?leito|leito\s+turismo)(?!\w)",
    re.I,
)
_AIR = re.compile(
    r"(?<!\w)(?:a[ée]reo|(?:passage[mn]s?|parte|via|trecho|bilhetes?)\s+a[ée]reas?"
    r"|v[ôo]os?(?!\s+(?:livre|de\s+(?:parapente|asa|bal[ãa]o|helic[óo]ptero))))(?!\w)",
    re.I,
)


def put_modal(obs: Observation, segments: Iterable[str]) -> None:
    bus_quote = air_quote = None
    for segment in segments:
        if not segment:
            continue
        bus = _BUS.search(segment)
        air = _AIR.search(segment)
        if bus and bus_quote is None:
            bus_quote = excerpt(segment, bus.start())
        if air and air_quote is None:
            air_quote = excerpt(segment, air.start())
    if bus_quote and air_quote:
        obs.put("modal", "mixed", bus_quote, air_quote)
    elif bus_quote:
        obs.put("modal", "bus", bus_quote)
    elif air_quote:
        obs.put("modal", "air", air_quote)


_BREAKFAST = re.compile(r"caf[ée]s?\s+da\s+manh[ãa]", re.I)
_BREAKFAST_COUNT = re.compile(r"(?<![\d,.])(\d{1,3})\s*caf[ée]s?\s+da\s+manh[ãa]", re.I)
_NEGATION = re.compile(r"\bsem\s+caf|n[ãa]o\s+(?:est[áa]\s+)?inclu", re.I)


def put_breakfast(obs: Observation, included: list[str], excluded: list[str]) -> None:
    inc = next((item for item in included if _BREAKFAST.search(item) and not _NEGATION.search(item)), None)
    exc = next((item for item in excluded if _BREAKFAST.search(item)), None)
    if exc is None:
        exc = next((item for item in included if _BREAKFAST.search(item) and _NEGATION.search(item)), None)
    if inc and exc:
        # The exception listed as not included is what makes breakfast partial.
        obs.put("breakfast.status", "partial", exc)
    elif inc:
        obs.put("breakfast.status", "included", inc)
    elif exc:
        obs.put("breakfast.status", "excluded", exc)
    if inc:
        count = _BREAKFAST_COUNT.search(inc)
        if count and int(count[1]) <= 120:
            obs.put("breakfast.count", int(count[1]), inc)


_LODGING_WORD = re.compile(r"hosped|hotel|pousada|resort|hostel|acomoda", re.I)
_NIGHTS_COUNT = re.compile(r"(?<![\d,.])(\d{1,2})\s*(?:noites?|di[áa]rias?)(?!\w)", re.I)


def put_lodging_nights(obs: Observation, included: list[str]) -> None:
    for item in included:
        if _LODGING_WORD.search(item):
            match = _NIGHTS_COUNT.search(item)
            if match and int(match[1]) <= 60:
                obs.put("lodging.nightsIncluded", int(match[1]), item)
                return


_PER_PERSON = re.compile(r"(?:por|p/|/)\s*(?:pessoa|pax|passageiro)|valor\s+por\s+pessoa", re.I)
_PER_ROOM = re.compile(r"por\s+(?:quarto|apartamento|apto)", re.I)
_PER_GROUP = re.compile(r"por\s+grupo", re.I)


def basis_of(text: str) -> str:
    if _PER_PERSON.search(text):
        return "per_person"
    if _PER_ROOM.search(text):
        return "per_room"
    if _PER_GROUP.search(text):
        return "per_group"
    return "unknown"


_PAID_LOCALLY = re.compile(
    r"(?:pag[oa]s?|cobrad[oa]s?|recolhid[oa]s?)\b[^.\n]{0,40}?(?:em\s+dinheiro|dentro\s+do\s+[ôo]nibus"
    r"|no\s+[ôo]nibus|no\s+embarque|no\s+local|no\s+destino|na\s+chegada|diretamente)",
    re.I,
)
_IN_PACKAGE = re.compile(r"(?:j[áa]\s+)?inclus[oa]s?\s+no\s+(?:valor|pacote|pre[çc]o)", re.I)
_FEE_LINE = re.compile(r"taxa", re.I)
_MANDATORY = re.compile(r"obrigat[óo]ri", re.I)


def put_mandatory_fees(obs: Observation, lines: list[str]) -> None:
    """``Taxa(s) ... obrigatória(s) ... R$ X`` phrases; label and amount are literal."""
    for index, line in enumerate(lines):
        if not (_FEE_LINE.search(line) and _MANDATORY.search(line)):
            continue
        segment = line
        next_index = index + 1
        money = first_money(segment)
        if money is None and index + 1 < len(lines):
            segment = f"{line} {lines[index + 1]}"
            next_index = index + 2
            money = first_money(segment)
        if money is None:
            continue
        amount = money_minor(money)
        label = obs.clean(segment[: money.start()], 120)
        if amount is None or label is None:
            continue
        payment = "unknown"
        quote = segment
        # The payment condition may sit on the fee line or on one of the next two lines.
        for candidate in [segment, *lines[next_index : next_index + 2]]:
            if _PAID_LOCALLY.search(candidate):
                payment = "paid_locally"
            elif _IN_PACKAGE.search(candidate):
                payment = "in_package"
            else:
                continue
            if candidate is not segment:
                quote = f"{segment} {candidate}"
            break
        basis = basis_of(segment[money.end() : money.end() + 40])
        basis = basis if basis in ("per_person", "per_group") else "unknown"
        fee = {"label": label, "amountMinor": amount, "basis": basis, "payment": payment}
        obs.add_fee(fee, quote)


_LODGING_MAY_CHANGE = re.compile(
    r"pode(?:m|r[áa])?\s+(?:haver|ocorrer|sofrer)\s+(?:altera[çc][õo]es|altera[çc][ãa]o|mudan[çc]as?)"
    r"\s+(?:n[ao]s?\s+|de\s+)?(?:hospedage[mn]s?|hot[eé]is|hotel|pousadas?|acomoda[çc][ãa]o)"
    r"|(?:hotel|pousada|hospedagem)[^.\n]{0,60}\bou\s+similar",
    re.I,
)


def scan_lodging_may_change(obs: Observation, lines: Iterable[str]) -> None:
    if any(_LODGING_MAY_CHANGE.search(line) for line in lines):
        obs.warn("LODGING_MAY_CHANGE")


def put_days_nights(obs: Observation, candidates: Iterable[str]) -> None:
    for text in candidates:
        if not text:
            continue
        match = DAYS_NIGHTS_RE.search(text)
        if match:
            days, nights = int(match["days"]), int(match["nights"])
            quote = excerpt(text, match.start())
            if 1 <= days <= 60:
                obs.put("days", days, quote)
            if 0 <= nights <= 60:
                obs.put("nights", nights, quote)
            return


def put_price_amount(
    obs: Observation,
    money: re.Match,
    quote: str,
    qualifier: str,
    basis_text: str,
    basis_quote: str | None = None,
) -> bool:
    """Amount, qualifier and basis. ``basis_text`` is only searched; the quote stays whole."""
    amount = money_minor(money)
    if amount is None or not obs.put("price.amountMinor", amount, quote):
        return False
    obs.put("price.qualifier", qualifier, quote)
    basis = basis_of(basis_text)
    if basis == "unknown" or not obs.put("price.basis", basis, basis_quote or basis_text, quote):
        obs.warn("PRICE_BASIS_UNKNOWN")
    return True


def put_installments(obs: Observation, text: str) -> bool:
    match = INSTALLMENT_RE.search(text)
    if not match:
        return False
    count = int(match["count"])
    amount = money_minor(match)
    if not 1 <= count <= 60 or amount is None:
        return False
    quote = excerpt(text, match.start(), 40)
    return obs.put("price.installments", {"count": count, "amountMinor": amount}, quote, match[0])
