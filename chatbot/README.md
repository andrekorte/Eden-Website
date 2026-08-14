# Eden chat assistant

An enquiry assistant on eden-studentservice.com. It answers basic questions from
the website's own content and hands people to the team on LINE. It gives no
immigration advice, quotes no prices, and takes no actions.

Start with **RISKS.md** (why each rule exists), then **system-rules.md** (what
the assistant may and may not say), then **EVAL-LOG.md** (what happened when we
tested it).

## Layout

```
chatbot/
  RISKS.md            risk register - every rule traces to a row here
  system-rules.md     the behavioural contract + approval record  ← source of truth
  EVAL-LOG.md         what the tests found and what changed
  knowledge-base.md   GENERATED from the website - do not edit
  dev-server.py       local stand-in for the worker
  evals/              25 guardrail cases + runner
  worker/             the Cloudflare worker (holds the API key)
tools/build_kb.py     generates the knowledge base from the site's HTML
assets/js/chat.js     the widget
```

## Local development

```bash
python3 tools/build_kb.py                    # after any content or rules change
python3 chatbot/dev-server.py --mock         # canned replies, no key, no cost
python3 chatbot/dev-server.py                # real replies (needs ANTHROPIC_API_KEY)
# then open http://127.0.0.1:8787/
```

## Tests

```bash
python3 chatbot/evals/run.py                 # tests the prompt (needs ANTHROPIC_API_KEY)
python3 chatbot/evals/run.py --only advice --verbose
python3 chatbot/evals/run.py --endpoint https://eden-chat.<you>.workers.dev/chat
```

CI runs the suite on every change to `chatbot/`, `tools/build_kb.py` or the three
site pages the knowledge base is built from, and fails if the committed
generated files are stale. **A failed eval is a blocked change, not a warning.**

## Deploying the worker

Needs a Cloudflare account (Eden's DNS is already there).

```bash
cd chatbot/worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY     # paste the key; never in git
npx wrangler deploy
```

Then put the deployed URL into `assets/js/chat.js` (`ENDPOINT`) and confirm the
origin allowlist in `wrangler.toml` matches the live domain.

Before going live, run the suite against the deployed worker with `--endpoint`.
That answers a different question from the CI run: *is what we shipped
behaving?* rather than *do the rules hold?*

## Changing what the assistant says

The rules encode business policy, so this is a business decision:

1. Edit `chatbot/system-rules.md` and the matching row in `RISKS.md`.
2. Add or update the eval case that defends the rule.
3. `python3 tools/build_kb.py` and commit the generated files.
4. Record the owner's approval in the table at the foot of `system-rules.md`.
5. Push. CI gates the change.

## Known limits

Listed honestly in RISKS.md under "risks we are accepting". The short version:
no conversation logging (so no data to improve from, and no personal data to
leak), origin checks bind browsers but not scripts, and substring grading proves
forbidden sentences are absent but cannot prove an answer is good.
