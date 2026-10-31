"""Bounded local MIME-to-observation normalization. No network, attachments or LLM.

Only explicit supported literal labels are extracted. Unrecognized vendor formats
remain unknown; sender headers do not authenticate a booking. Never log raw mail.
"""

import base64
import hashlib
import hmac
import json
import re
import sys
from datetime import date, datetime
from email import policy
from email.parser import BytesParser

from .html_safety import visible_html_text

MAX_BYTES = 524288


def normalize_email(raw: bytes, *, record_key: str, source_ref: str,
                    provider_key: str, reference_secret: bytes, observed_at: str) -> dict:
    if (not isinstance(raw, bytes) or not raw or len(raw) > MAX_BYTES
            or raw.count(b"\n") > 20000
            or not re.fullmatch(r"[A-Z][A-Z0-9_-]{1,39}", record_key)
            or not re.fullmatch(r"SRC[0-9]{2,6}", source_ref)
            or not re.fullmatch(r"[a-z][a-z0-9-]{1,39}", provider_key)
            or not isinstance(reference_secret, bytes) or not 32 <= len(reference_secret) <= 128):
        raise ValueError("EMAIL_INPUT_REJECTED")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", observed_at):
        raise ValueError("EMAIL_INPUT_REJECTED")
    stamp = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("EMAIL_INPUT_REJECTED")
    message = BytesParser(policy=policy.default).parsebytes(raw)
    stack = [(message, 0)]
    texts: list[str] = []
    warnings: set[str] = set()
    count = 0
    while stack:
        part, depth = stack.pop()
        count += 1
        if count > 32 or depth > 6:
            raise ValueError("EMAIL_COMPLEXITY_LIMIT")
        if part.defects:
            warnings.add("MIME_DEFECT_REQUIRES_REVIEW")
        if part.get_content_disposition() == "attachment" or part.get_filename():
            warnings.add("ATTACHMENTS_NOT_PROCESSED")
            continue
        if part.get_content_maintype() == "message":
            warnings.add("NESTED_MESSAGE_NOT_PROCESSED")
            continue
        if part.is_multipart():
            children = part.get_payload()
            if not isinstance(children, list) or len(children) > 32:
                raise ValueError("EMAIL_COMPLEXITY_LIMIT")
            stack.extend((child, depth + 1) for child in children)
            continue
        mime = part.get_content_type()
        if mime not in {"text/plain", "text/html"}:
            warnings.add("NON_TEXT_PART_NOT_PROCESSED")
            continue
        payload = part.get_payload(decode=True)
        if not isinstance(payload, bytes) or len(payload) > MAX_BYTES:
            raise ValueError("EMAIL_INPUT_REJECTED")
        try:
            text = payload.decode(part.get_content_charset() or "utf-8", errors="strict")
        except (LookupError, UnicodeError):
            warnings.add("CHARSET_REQUIRES_REVIEW")
            continue
        if mime == "text/html":
            text, html_warnings = visible_html_text(text)
            warnings.update(html_warnings)
        texts.append(text)
    text = "\n".join(texts)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError("EMAIL_TEXT_LIMIT")

    def literal(label: str, value_pattern: str, field: str) -> str | None:
        # Horizontal whitespace only: labels must not span lines or rescan a
        # long whitespace suffix from every newline in a MIME body.
        values = set(re.findall(rf"(?im)^[ \t]*(?:{label})[ \t]*:[ \t]*({value_pattern})[ \t]*\r?$", text))
        if len(values) > 1:
            warnings.add(f"CONFLICT_{field.upper()}")
        return next(iter(values)) if len(values) == 1 else None

    def day(label: str, field: str) -> str | None:
        value = literal(label, r"\d{4}-\d{2}-\d{2}", field)
        if value is not None:
            try:
                date.fromisoformat(value)
            except ValueError:
                warnings.add(f"INVALID_{field.upper()}")
                return None
        return value

    reference = literal(r"booking reference|reservation reference|localizador|c[oó]digo da reserva", r"[A-Za-z0-9][A-Za-z0-9-]{2,39}", "reference")
    token = (hmac.new(reference_secret, (provider_key + "\0" + reference.upper()).encode(), hashlib.sha256).hexdigest()
             if reference is not None else None)
    currency = literal(r"currency|moeda", r"[A-Z]{3}", "currency")
    currency = currency.upper() if currency else None
    minor = literal(r"total minor units|total em unidades menores", r"[0-9]{1,16}", "total_minor")
    total = int(minor) if minor is not None and int(minor) <= 9007199254740991 and currency else None
    if minor is not None and total is None:
        warnings.add("AMOUNT_REQUIRES_REVIEW")
    status = literal(r"reservation status|status da reserva", r"quote|booked|cancelled|completed|unknown", "status") or "unknown"
    status = status.lower()
    observation = {
        "recordKey": record_key, "sourceRef": source_ref, "referenceToken": token,
        "startDate": day(r"start date|check-in|data inicial", "start_date"),
        "endDate": day(r"end date|check-out|data final", "end_date"),
        "status": status, "currency": currency, "totalMinor": total,
        "policyHash": None, "observedAt": observed_at, "expiresAt": None, "origin": "email_claim",
    }
    if observation["startDate"] and observation["endDate"] and observation["endDate"] < observation["startDate"]:
        observation["startDate"] = observation["endDate"] = None
        warnings.add("DATE_ORDER_REQUIRES_REVIEW")
    warnings.add("EMAIL_CONTENT_NOT_AUTHENTICATED")
    warnings.add("UNSUPPORTED_LITERAL_FIELDS_REMAIN_UNKNOWN")
    return {"observation": observation, "warnings": sorted(warnings), "attachmentsProcessed": 0,
            "externalCalls": 0, "modelCalls": 0, "rawContentReturned": False}


def main() -> None:
    try:
        packet = sys.stdin.buffer.read(800001)
        if len(packet) > 800000:
            raise ValueError("EMAIL_INPUT_REJECTED")
        data = json.loads(packet)
        if not isinstance(data, dict) or set(data) != {"rawBase64", "recordKey", "sourceRef", "providerKey", "referenceSecretBase64", "observedAt"}:
            raise ValueError("EMAIL_INPUT_REJECTED")
        result = normalize_email(base64.b64decode(data["rawBase64"], validate=True),
                                 record_key=data["recordKey"], source_ref=data["sourceRef"],
                                 provider_key=data["providerKey"],
                                 reference_secret=base64.b64decode(data["referenceSecretBase64"], validate=True),
                                 observed_at=data["observedAt"])
        print(json.dumps(result, ensure_ascii=True))
    except Exception:
        print('{"error":"EMAIL_NORMALIZATION_REJECTED"}')
        sys.exit(1)


if __name__ == "__main__":
    main()
