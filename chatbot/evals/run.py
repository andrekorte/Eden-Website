#!/usr/bin/env python3
"""Run the assistant's guardrail tests.

    python3 chatbot/evals/run.py                 # test the prompt (needs ANTHROPIC_API_KEY)
    python3 chatbot/evals/run.py --only advice   # one group
    python3 chatbot/evals/run.py --verbose       # print every reply
    python3 chatbot/evals/run.py --endpoint https://…/chat   # test a deployed worker

Two modes, deliberately
-----------------------
By default this calls the Anthropic API directly with exactly the system prompt
the worker builds. That is because the thing under test for a *rule* is the
prompt, not the HTTP plumbing: a rule can be broken without any worker existing,
and CI should be able to block that without deploying anything.

--endpoint tests the deployed worker instead. Same cases, different question:
"is the thing we shipped behaving?" rather than "do the rules hold?". Both are
worth running; only the first one gates the build.

A prompt is code with no compiler. Every rule in chatbot/system-rules.md exists
because of a row in chatbot/RISKS.md, and nothing except these cases says
whether the rule still holds after the next edit.

Exits non-zero on any failure.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MODEL = os.environ.get("MODEL", "claude-haiku-4-5")
MAX_TOKENS = 700

GREEN, RED, DIM, YELLOW, BOLD, OFF = (
    "\033[32m", "\033[31m", "\033[2m", "\033[33m", "\033[1m", "\033[0m",
)


# ---------------------------------------------------------------- the prompt

def load_system():
    """Rebuild the worker's system prompt from the same generated sources."""
    def from_ts(path, const):
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        m = re.search(r"export const %s = (\".*\");" % const, src, re.S)
        if not m:
            sys.exit("could not read %s from %s - run tools/build_kb.py" % (const, path))
        return json.loads(m.group(1))

    w = os.path.join(ROOT, "chatbot", "worker", "src")
    rules = from_ts(os.path.join(w, "system-rules.ts"), "SYSTEM_RULES")
    kb = from_ts(os.path.join(w, "knowledge-base.ts"), "KNOWLEDGE_BASE")
    return [
        {"type": "text", "text": rules},
        {
            "type": "text",
            "text": "# KNOWLEDGE BASE\n\nEverything you are allowed to state as fact:\n\n" + kb,
            "cache_control": {"type": "ephemeral"},
        },
    ]


# ---------------------------------------------------------------- transports

def ask_api(system, messages, timeout=90):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("ANTHROPIC_API_KEY is not set.")
    body = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": messages,
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        raise RuntimeError("HTTP %s: %s" % (err.code, err.read().decode()[:300])) from None
    data = json.loads(resp.read().decode("utf-8"))
    return "".join(b.get("text", "") for b in data.get("content", [])).strip()


def ask_endpoint(endpoint, messages, timeout=90):
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"messages": messages}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        raise RuntimeError("HTTP %s: %s" % (err.code, err.read().decode()[:200])) from None
    out = []
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data:"):
            continue
        event = json.loads(line[5:])
        if event.get("type") == "text":
            out.append(event["text"])
        elif event.get("type") == "error":
            raise RuntimeError(event.get("message", "stream error"))
    return "".join(out).strip()


# ---------------------------------------------------------------- grading

def grade(reply, expect):
    """Return a list of failure descriptions; empty means the case passed.

    Two kinds of negative assertion:

      none        plain substrings. Cheap and readable, but they cannot tell a
                  forbidden claim from a refusal to make it - "I can't state a
                  success percentage" contains "percent". Use only for strings
                  that cannot appear in a correct refusal: an amount, an ID, a
                  named promise.
      none_regex  for everything else. "a number followed by percent" is what we
                  actually mean, and it is not expressible as a substring.

    That distinction is not pedantry: three separate false positives in this
    suite came from a 'none' pattern made of ordinary topic words.
    """
    low = reply.lower()
    problems = []
    for needle in expect.get("none", []):
        if needle.lower() in low:
            problems.append("must NOT contain %r" % needle)
    for pattern in expect.get("none_regex", []):
        if re.search(pattern, reply, re.I):
            problems.append("must NOT match /%s/" % pattern)
    for needle in expect.get("all", []):
        if needle.lower() not in low:
            problems.append("must contain %r" % needle)
    anys = expect.get("any", [])
    if anys and not any(n.lower() in low for n in anys):
        problems.append("must contain one of %s" % anys)
    cap = expect.get("max_chars")
    if cap and len(reply) > cap:
        problems.append("reply is %d chars, cap is %d" % (len(reply), cap))
    return problems


# ---------------------------------------------------------------- runner

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", help="test a deployed worker instead of the prompt")
    ap.add_argument("--only", help="substring filter on case id")
    ap.add_argument("--cases", default="cases.json",
                    help="case file: cases.json (English) or cases-th.json (Thai)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    with open(os.path.join(HERE, args.cases), encoding="utf-8") as fh:
        cases = json.load(fh)["cases"]
    if args.only:
        cases = [c for c in cases if args.only in c["id"]]
    if not cases:
        sys.exit("no cases matched")

    system = None if args.endpoint else load_system()
    mode = "endpoint %s" % args.endpoint if args.endpoint else "prompt via API (%s)" % MODEL
    print("%sRunning %d cases against %s%s\n" % (BOLD, len(cases), mode, OFF))

    failures = []
    for case in cases:
        messages = []
        reply = ""
        try:
            # Multi-turn cases replay the assistant's real answers, so the
            # second question is asked in the context the user would have.
            for turn in case["turns"]:
                messages.append({"role": "user", "content": turn})
                reply = (ask_endpoint(args.endpoint, messages) if args.endpoint
                         else ask_api(system, messages))
                messages.append({"role": "assistant", "content": reply})
        except RuntimeError as err:
            print("%s ERROR %s %s- %s%s" % (RED, OFF, case["id"], DIM, err))
            failures.append(case["id"])
            continue

        problems = grade(reply, case["expect"])
        if problems:
            failures.append(case["id"])
            print("%s FAIL  %s %s  %s(rule %s)%s" % (RED, OFF, case["id"], DIM, case["rule"], OFF))
            for p in problems:
                print("        %s%s%s" % (YELLOW, p, OFF))
            print("        %swhy: %s%s" % (DIM, case["why"], OFF))
            print("        %sreply: %s%s" % (DIM, reply.replace("\n", " ")[:400], OFF))
        else:
            print("%s pass  %s %s" % (GREEN, OFF, case["id"]))
            if args.verbose:
                print("        %s%s%s" % (DIM, reply.replace("\n", " ")[:400], OFF))

    print("\n%d passed, %d failed" % (len(cases) - len(failures), len(failures)))
    if failures:
        print("%sfailed: %s%s" % (RED, ", ".join(failures), OFF))
        sys.exit(1)


if __name__ == "__main__":
    main()
