#!/usr/bin/env python3
"""Generate the chat assistant's knowledge base from the website's own HTML.

    python3 tools/build_kb.py

Writes:
    chatbot/knowledge-base.md            human-readable, for review
    chatbot/worker/src/knowledge-base.ts bundled into the worker
    chatbot/worker/src/system-rules.ts   compiled from chatbot/system-rules.md

Why derive it instead of writing it
-----------------------------------
The assistant answers from one document. If that document were hand-written it
would drift: someone edits an office address on the contact page, nobody
remembers the bot, and the bot keeps giving the old address with total
confidence. Deriving it means the website is the single source of truth and the
bot cannot contradict the page it sits on.

The trade-off, stated honestly: this parser is coupled to the site's markup. If
the HTML structure changes, extraction breaks. The mitigation is that it breaks
LOUDLY - every section below is required, and a missing one aborts the build
rather than silently producing a thinner knowledge base. A quiet partial
success would be the dangerous failure, because the bot would then answer "I
don't have that" to things the site plainly says.

The only content here that is NOT on the website is OPERATIONAL_FACTS, kept
short deliberately so it can be audited in under a minute.
"""

import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_MD = os.path.join(ROOT, "chatbot", "knowledge-base.md")
OUT_TS = os.path.join(ROOT, "chatbot", "worker", "src", "knowledge-base.ts")
RULES_MD = os.path.join(ROOT, "chatbot", "system-rules.md")
RULES_TS = os.path.join(ROOT, "chatbot", "worker", "src", "system-rules.ts")
FAQ_SRC = os.path.join(ROOT, "chatbot", "faq-source.md")

# Facts the assistant may state that the website does not say in so many words.
# Everything here is a business decision recorded in the owner questionnaire.
# Keep this list short: it is the part nobody can verify by reading the site.
OPERATIONAL_FACTS = [
    "The first consultation is free.",
    "The team are contacted on LINE at @edenstudentservice. That is the normal next step for anyone who wants to go further.",
    "Eden works with Australia only. It does not place students in New Zealand, Canada, the United Kingdom or anywhere else.",
    # 'Australia only' is the DESTINATION; it is not a limit on who Eden serves.
    # Added after the assistant hedged on 'do you help German students?' - the
    # website and KB describe Thai students everywhere, so the bot had no fact
    # affirming other nationalities and (correctly, per rule 8) declined to
    # invent one. This gives it the fact.
    "Eden specialises in Thai students and provides Thai-language service, but it welcomes students of any nationality who want to study in Australia. It does not work only with Thai nationals. Enquiries in English or from other countries are welcome, and the team can discuss what support they can offer.",
    "Eden is an education agent. It does not give immigration or legal advice; visa questions are handled by the team.",
    "After someone messages on LINE the team will get back to them. No response time is promised.",
]


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


def strip_tags(fragment):
    """HTML fragment -> single-line plain text."""
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def require(items, what):
    """Abort the build rather than emit a knowledge base with a hole in it."""
    if not items:
        sys.exit(
            "build_kb.py: found no %s.\n"
            "The page markup has probably changed. Fix the extractor - do not "
            "ship a knowledge base that is quietly missing a section." % what
        )
    return items


def cards(source, section_id):
    """Extract <article class="card"> h3/p pairs from one <section>."""
    sec = re.search(
        r'<section[^>]*aria-labelledby="%s".*?</section>' % re.escape(section_id),
        source, re.S,
    )
    if not sec:
        return []
    out = []
    for art in re.findall(r"<article[^>]*class=\"card[^\"]*\".*?</article>", sec.group(0), re.S):
        h3 = re.search(r"<h3[^>]*>(.*?)</h3>", art, re.S)
        if not h3:
            continue
        body = " ".join(strip_tags(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", art, re.S))
        bullets = [strip_tags(li) for li in re.findall(r"<li[^>]*>(.*?)</li>", art, re.S)]
        if bullets:
            body = (body + " " + "; ".join(bullets)).strip()
        out.append((strip_tags(h3.group(1)), body))
    return out


def read_faq():
    """The team-curated FAQ. This is the primary knowledge now; it replaces the
    thin set of questions that used to be scraped from the homepage. Unlike the
    rest of the KB it is NOT generated from the website - it is expert content
    the team wrote, so it is version-controlled as chatbot/faq-source.md and
    approved like the rules. Strip only the top-level H1 so it nests cleanly."""
    with open(FAQ_SRC, encoding="utf-8") as fh:
        text = fh.read().strip()
    text = re.sub(r"^#\s+.*\n+", "", text, count=1)   # drop the leading H1 title
    return text.strip()


def build():
    index = read("index.html")
    services = read("services.html")
    contact = read("contact.html")
    faq = require(read_faq(), "FAQ content in chatbot/faq-source.md")
    lines = []

    def head(title):
        lines.append("\n## %s\n" % title)

    lines.append("# Eden Student and Migration Service - knowledge base")
    lines.append(
        "\nThe FAQ section below is the team-curated source of answers "
        "(chatbot/faq-source.md); the rest is generated from the website by "
        "tools/build_kb.py. Do not edit the generated sections by hand.\n"
    )

    head("What Eden helps with")
    for name, body in require(cards(services, "visa-services"), "visa service cards"):
        lines.append("- **%s** - %s" % (name, body))
    for name, body in require(cards(services, "study-services"), "study service cards"):
        lines.append("- **%s** - %s" % (name, body))
    for name, body in require(cards(services, "extra-services"), "support service cards"):
        lines.append("- **%s** - %s" % (name, body))

    head("Cities Eden places students in")
    for name, body in require(cards(index, "dest-heading"), "city cards"):
        lines.append("- **%s** - %s" % (name, body))

    head("Offices and contact details")
    offices = require(
        re.findall(r"<article[^>]*class=\"card office\">(.*?)</article>", contact, re.S),
        "office cards",
    )
    for art in offices:
        name = strip_tags(re.search(r"<h3[^>]*>(.*?)</h3>", art, re.S).group(1))
        addr = re.search(r"<address>(.*?)</address>", art, re.S)
        lines.append("- **%s**" % name)
        if addr:
            lines.append("  - Address: %s" % strip_tags(addr.group(1)))
        for dt, dd in re.findall(r"<dt>(.*?)</dt>\s*<dd>(.*?)</dd>", art, re.S):
            lines.append("  - %s: %s" % (strip_tags(dt), strip_tags(dd)))

    head("Frequently asked questions (team-curated)")
    lines.append(
        "These are GENERAL answers the team approved for sharing. They are never "
        "to be applied to the person's own case - see rule 2. Anything about "
        "someone's own eligibility, documents, scores, current visa or refusal "
        "goes to the team on LINE.\n"
    )
    lines.append(faq)

    head("Operating facts not stated on the website")
    for fact in OPERATIONAL_FACTS:
        lines.append("- %s" % fact)

    return "\n".join(lines).strip() + "\n"


def ts_module(name, docstring, value):
    return (
        "// Generated by tools/build_kb.py - do not edit.\n"
        "// %s\n\nexport const %s = %s;\n" % (docstring, name, json.dumps(value))
    )


def main():
    kb = build()
    os.makedirs(os.path.dirname(OUT_TS), exist_ok=True)
    with open(OUT_MD, "w", encoding="utf-8") as fh:
        fh.write(kb)
    with open(OUT_TS, "w", encoding="utf-8") as fh:
        fh.write(ts_module("KNOWLEDGE_BASE", "Source: the website's own pages.", kb))

    with open(RULES_MD, encoding="utf-8") as fh:
        rules = fh.read()
    rules = re.sub(r"<!--.*?-->", "", rules, flags=re.S)          # drop editor notes
    rules = rules.split("## Approval record")[0].strip() + "\n"   # drop the sign-off table
    with open(RULES_TS, "w", encoding="utf-8") as fh:
        fh.write(ts_module("SYSTEM_RULES", "Source: chatbot/system-rules.md.", rules))

    print("knowledge base: %d chars, ~%d tokens" % (len(kb), len(kb) // 4))
    print("rules:          %d chars, ~%d tokens" % (len(rules), len(rules) // 4))
    print("wrote %s" % os.path.relpath(OUT_MD, ROOT))
    print("wrote %s" % os.path.relpath(OUT_TS, ROOT))
    print("wrote %s" % os.path.relpath(RULES_TS, ROOT))


if __name__ == "__main__":
    main()
