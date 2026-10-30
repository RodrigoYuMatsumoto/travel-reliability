"""No browser, scripts, URL fetching or CSS execution. Explicit hiding is excluded.

This is not a browser rendering engine. Stylesheets and ambiguous inline styling
remain flagged for human review, so text presence is never proof of visibility.
"""

import re

from bs4 import BeautifulSoup, Comment


def visible_html_text(text: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(text, "html.parser")
    nodes = soup.find_all(True)
    if len(nodes) > 10000:
        return "", ["HTML_COMPLEXITY_LIMIT"]
    warnings: list[str] = []
    if soup.find("style") or soup.find("link", rel=lambda value: value and "stylesheet" in value):
        warnings.append("HTML_STYLES_REQUIRE_REVIEW")
    for comment in soup.find_all(string=lambda item: isinstance(item, Comment)):
        comment.extract()
    for node in soup(["script", "style", "iframe", "object", "embed", "svg", "template", "noscript", "head"]):
        node.decompose()
    # Reverse order avoids traversing already-decomposed descendants.
    for node in reversed(soup.find_all(True)):
        style = re.sub(r"/\*.*?\*/", "", str(node.get("style", "")), flags=re.DOTALL).lower()
        compact = re.sub(r"\s+", "", style)
        hidden = (
            node.has_attr("hidden")
            or node.has_attr("inert")
            or str(node.get("aria-hidden", "")).lower() == "true"
        )
        hidden = hidden or node.name == "input" and str(node.get("type", "")).lower() == "hidden"
        hidden = hidden or bool(
            re.search(
                r"(?:^|;)(?:display:none|visibility:(?:hidden|collapse)|opacity:0(?:[;!]|$)|font-size:0(?:px|pt|em|rem)?(?:[;!]|$))",
                compact,
            )
        )
        hidden = hidden or bool(re.search(r"(?:left|top):-[1-9][0-9]{2,}(?:px|em)|clip:rect\(0", compact))
        if hidden:
            warnings.append("HTML_HIDDEN_CONTENT_REMOVED")
            node.decompose()
        elif style:
            warnings.append("HTML_STYLES_REQUIRE_REVIEW")
    return soup.get_text("\n"), sorted(set(warnings))
