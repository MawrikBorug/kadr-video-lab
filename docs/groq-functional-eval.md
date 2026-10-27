# Groq functional diagnostic v1

This is a manual laboratory evaluation, not the KADR application or full acceptance of stage 3.
Gemini is excluded by the owner. Groq text access passed previously; ZDR is owner-reported enabled.

## Run one mode

After reviewed merge, open Actions → **Groq functional eval (manual)**, branch **main**, select
**recommendations** first and check **confirm_budget**. Reuse existing `GROQ_API_KEY`; never paste
it in an input. Owner only, first attempt only. Do not run concurrently with other Groq consumers.
No billing, deployment or automatic calls on push/PR are introduced.

The first mode has 3 diagnostic cases, up to **6 requests**, at most **48000 reserved tokens**.
Each request is reserved before dispatch; the conservative envelope counts UTF-8 bytes + 512
framing + completion cap (including reasoning), not an exact tokenizer. Each request must fit
7900; calls are spaced by >=65 seconds. These are local ceilings, not guaranteed account quota.
401/403/402/429, incomplete completion or unknown outcome stops the whole run; no retry.
The 900-second deadline is checked between requests; the workflow has a hard 20-minute limit. There is a 900-second inter-request run deadline and a 45-second socket timeout (not a strict wall-clock step deadline). Reports preserve
completed prior provider usage. A timeout's reservation is consumed, not silently refunded.

Modes: recommendations (3 cases,6 max), labels (2 max), analysis-film / analysis-season
(3 section groups × generation+independent model verification,6 max each), vision-one /
vision-three / vision-unknown (2 max each when their fixtures are ready).
Every mode shares the 6-call/48000 ceiling. Run sequentially, inspect actual usage and remaining
quota before another run; exact organization Limits are not independently confirmed.

## What is ready

- Recommendations: 2 real, sourced works (Sintel, Fallout S1), internal fixture IDs only;
  cold start, explicit preference with exclusion/filter, empty pool. Eight mood choices occur
  in combinations. This tiny pool diagnoses rule handling and explanation honesty, not general
  catalogue quality, random-cycle logic, popularity or discovery diversity.
- Semantic labels: same 2 evidence-backed works, unknown allowed. Mood labels are subjective.
- Film: Sintel (2010), 8 attributed factual claims. Plot source is secondary Wikipedia;
  additional Blender Studio primary metadata. This is not a frame-by-frame source corpus.
- Season: Fallout S1 (2024), 12 claims, 8 episode IDs and finality evidence for the fixture.
  Read official Amazon/Prime catalogue plus bounded original summaries of secondary recaps.
  Episode identity/release monitoring is not live-tested here.
- Both analyses request all nine approved sections: summary; plot/ending; meaning;
  details/references; creation; characters; visual language; theories; sources. Sources and
  limitations are in JSON. Interpretations/theories must be labelled, author intent not invented.
  There is no manual owner editor and no deterministic template substituted for prose.
- Known vision assets: **BLOCKED/NOT_RUN**. Provenance identifies three real CC-BY Sintel
  screenshots, but exact image bytes/hashes/preprocessing were not available in this environment.
  Unknown-frame asset is also not materialized. Selecting a blocked mode makes zero calls.
  The implemented 1/3-frame identify → offline confirmed-identity fixture → verify route must
  not be called live TMDB resolution. No invented TMDB IDs are present.

## Analysis and publication boundary

The actual source-pack → prose generation → claim/scope verification → local automatic gate
is executable. The model verifier receives only the same scope-local evidence; no future
negative-control text enters any model prompt. Full bibliography/provenance remains in the artifact
and repository; sources are not guessed by the model. Known future controls are EVALUATOR ONLY:
the independent reviewing agent must inspect generated text against them and its broader knowledge.

All three generation+review pairs are preflighted before the first call. A section-group candidate
has a 3500 UTF-8 byte diagnostic envelope, so the verifier can reserve its entire input. An oversized
candidate **stops explicitly without trimming**. An inadequate/too shallow discussion fails independent
quality review; this envelope does not reduce the product's full analysis requirement. Source gaps,
unsupported claims, failed model reviews and incomplete section coverage block gate eligibility.
A citation ID is not proof of entailment. A second LLM is not an absolute spoiler guarantee.

Generated prose is preserved only in a 7-day JSON artifact, not console/summary/Pages. Treat it
as untrusted data. The artifact includes model/usage/safe rate headers, source records and fixture
limitations; no key, raw transport body, raw exception, image bytes or request headers.
The run can be operationally successful only as **COMPLETED_PENDING_INDEPENDENT_REVIEW**.
`accepted_quality=false` and `actual_product_publication=false` always. An independent agent must
review factual support, hallucinations, completeness, preference relevance and future leakage before
claiming any diagnostic success. Local watched/finality/composition gates are not production RLS.

## Scope and rights

Fixtures live under `tests/fixtures/groq-eval` so the existing laboratory ZIP includes them.

Source claims were actually read and paraphrased on 2026-10-27. Each source record carries URL,
read locator, tier, rights and attribution. Wikipedia-derived paraphrases: CC-BY-SA, attribution to
Wikipedia contributors and linked article/history. Keep attribution and applicable share-alike terms
for derivative text. Other copyrighted pages contribute bounded factual paraphrases, no copied
recap/script/dialogue or quoted prose. Film asset license does not license unrelated pages or rigs.
Full source records and limitations must accompany independent review.

This sample does not replace architecture §10.5's broader proposed 30 recommendations,80 cards,
50 known+20 unknown scenes and10 films+10 seasons. It tests neither Netlify, live TMDB, production
queues, iPhone/RF access, ZDR settings, complete account Limits, nor all product acceptance cases.

## Model documentation checked 2026-10-27

- https://console.groq.com/docs/models — `openai/gpt-oss-120b`; preview `qwen/qwen3.8-27b`.
- https://console.groq.com/docs/vision — Qwen accepts up to3 images; each charges2048 image tokens;
  base64/JPEG and JSON mode. Preview availability and own account inference remain unproven.
- https://console.groq.com/docs/rate-limits — published Free limits 8KTPM/200KTPD for both models;
  actual organization may differ. Header request limits refer to RPD, token limits to TPM.
- https://console.groq.com/docs/reasoning — GPT completion cap includes reasoning; low effort.

Offline verification:
`python3 -m unittest discover -s tests -p groq_functional_eval_test.py`
`node --test tests/groq-functional-eval.test.mjs tests/groq-probe.test.mjs`
All transport tests are fake. They prove controls, never live inference quality.
