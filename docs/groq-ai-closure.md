# Remaining AI architecture closure — one manual run

Use **Groq AI closure (manual)** → **main** → **confirm_budget** → Run once.
Existing `GROQ_API_KEY` is reused. Do not run other Groq consumers concurrently. No new account,
card, paid service, source preparation or frame upload is requested from the owner. Gemini remains
excluded. ZDR is owner-reported enabled, not independently observed by this workflow.

This is an addressable extension to the accepted recommendation mechanism; it does not repeat
recommendations or replace the product with a benchmark framework.

## Bound and results

One run, maximum **20 API calls / 160000 reserved tokens** across both models:

| Case | Maximum calls |
|---|---:|
| One real Sintel frame: identify → confirmed identity fixture → independent pixel verification | 2 |
| Three distinct real Sintel frames: same complete route | 2 |
| Original non-film chart: unknown/abstention control | 2 |
| Current film sources → grounded claim extraction → all nine analysis sections + verification | 7 |
| Current season sources/finality → grounded extraction → all nine sections + verification | 7 |

There are no inference retries. 65 seconds minimum separates API starts; each request has a
45-second socket timeout. The 2400-second limit is checked between operations; the workflow has
an independent hard **45-minute** timeout. Sources have separate 20-second socket bounds and
4MB maximum bodies. The theoretical 20×7900=158000 envelope fits the run's 160000 ceiling.
Published Free limits are 8K TPM/200K TPD per selected model, not a guarantee of remaining quota.
The existing recommendation run used 2385 actual tokens. Other account load is unknown; select
this run only with sufficient daily quota. 429, unauthorized, billing-required or uncertain transport
outcome stops all remaining cases without retry or refunding reservation. No billing is activated.
A rejected vision request (400/404/422) disables further vision requests and preserves the independent
text cases; it is recorded as rejection, not proof that the model never exists.

Content/schema/relevance failure is recorded and independent remaining cases continue. Validly
structured model rejection inside an analysis does not suppress later section groups. No result
is labelled product-quality PASS: every output needs independent coordinator-agent review, and
`accepted_quality=false`, `actual_product_publication=false` remain true constraints. A completed
workflow means that evidence was collected, not that all five cases succeeded. Check every case.
Partial reports checkpoint after requests/cases. Arbitrary model JSON is never checkpointed before
caller validation; only validated case results and span-validated source packs are retained. A hard runner kill leaves RUNNING/incomplete
rather than silently granting acceptance. Only one report.json is uploaded for seven days.

## Real input and identity

Three CC-BY-3.0 Sintel screenshots were downloaded from their actual Wikimedia Commons files.
Original SHA-1s match Commons metadata; original and normalized SHA-256, byte counts,
dimensions, attribution and source pages are in `tests/fixtures/groq-eval/closure-media.json`.
Normalized JPEGs are 1024×435, EXIF/ICC stripped; no film imagery was generated. The unknown
640×360 chart is original deterministic CC0 material, expressly not a film frame.

Identification gets pixels without a title hint. Candidate names/year/type must resolve to the
confirmed Sintel identity fixture before the second pixel check. This route does not claim a new
live TMDB API lookup, independent person-ID crosswalk or catalogue-wide image accuracy. The
existing confirmed card identity is never itself proof of a frame's origin.

Qwen `qwen/qwen3.8-27b` is a documented preview vision model, with 2048 input tokens per image
and at most three images. `reasoning_effort=none` disables reasoning for this diagnostic; JSON
mode and exact model ID are fixed. The selected text model remains `openai/gpt-oss-120b`, low
reasoning. Own-account vision availability and quality are measured by this run, not assumed.

## Automatic source acquisition and finality

The new source adapter performs **current HTTPS retrieval → work/season-specific HTML extraction
→ scope/rights/hash metadata → RAM-only bounded input**. It does not return old stored claims
when a source is unavailable. Fixed source URLs are deliberate adapters for these two real control
works, not a universal source-discovery implementation. Transport failure is distinguishable from
scope rejection. Direct native HTTPS connections in the preparation environment were unavailable. A later public
urllib retrieval using the environment network configuration successfully fetched all five real
HTML sources and passed the same scoped parsers. Hashes, actual signals and eight release events
are recorded in source-acquisition-observation.json; no source text is stored there and the runtime
never falls back to that observation. The manual GitHub runner still measures its fixed native
HTTPS transport and current sources independently.

Sources: Sintel Wikipedia (CC-BY-SA; plot prioritized, bounded420 words), optional Blender Studio
character metadata; Fallout S1's official Amazon creator panel, selected S1 Prime catalogue,
and a season-one-specific GamesRadar ending explanation (copyrighted input ≤200 words/source,
RAM only). Bibliographic records accompany results. Source text/quotes/raw HTML/headers never
enter the artifact. Source hashes, quote offsets and attributable bounded generated paraphrases do.
Full copyrighted pages, scripts and copied recaps are not packaged. Future-season headings exclude
their entire paragraph subtree, including text without an explicit season marker, until a valid
nonfuture sibling/ancestor heading resumes the scope.

For season one, **publisher-confirmed released** evidence requires the official Amazon page's
affirmative availability of all eight S1 episodes and current Prime's selected S1 episode entries.
**Season final confirmed** additionally requires an explicit S1 final-episode statement and all
entries1–8. Numbers, a passed date, next-season existence or Lift alone never confirm release.
Evidence carries source IDs/current document hashes/check time/composition revision. When the
conditions fail, finality is unknown and the seasonal analysis is not opened. The local fixture
watch state exists solely to test gates; it does not assert real users watched these episodes.

Implementation contract for new shows: confirmed canonical work/season identity selects a
publisher/structured-source adapter via the source registry. Matching publisher evidence creates
versioned release/composition events. Planned-date changes update planned evidence only;
unconfirmed/missing evidence stays unknown, preserves queue position and schedules bounded
maintenance retry. No default manual source-hunting/editor job is assigned to Maxim. The generic
source-discovery registry and production scheduler are implementation work; this limited adapter
must not be described as having proven automatic coverage of arbitrary titles/seasons.

## Complete analysis and automatic candidate publication

Current source excerpts go to a separate extraction call. Every extracted factual claim needs an
exact short quote found in the current source excerpt, an allowed source ID and a scope-local
section mapping; offsets are checked deterministically. Unknown IDs, fabricated quotations and
unbounded paraphrases stop that case. This is grounded extraction, not proof of semantic entailment.

The generation and independent model verification stages both receive the current exact quoted
support, avoiding a verifier that only trusts another model's unsupported summary. Complete prose
is generated for all nine approved sections: summary; plot/ending; meaning; details/references;
creation; characters; visual language; theories; sources. Interpretation and hypothesis are separate
from facts. Evidence gaps remain explicit; no templated replacement or standing owner editor is
introduced. Each group has a preflighted3500-byte candidate envelope; oversized/insufficient prose
fails explicitly rather than being silently cropped or accepted as a reduced product requirement.

Local eligibility requires full section coverage, no evidence gaps, all supported claim IDs approved,
independent verifier passes and current watched/finality/composition gates. Scope excludes future
seasons; evaluator-only future controls never enter any model prompt. Independent agent review
checks actual prose for future leaks, weak/incorrect entailment and shallow sections. Two model
calls are not an absolute guarantee; actual product publication and production access controls
remain separate implementation/integration obligations. There is no automatic production write here.

## Audit delta for the final editor

| Row | This package supplies | Admission boundary |
|---|---|---|
| A03 | Executable automatic current-source acquisition, exact-span grounding, free prose for all nine sections, verification and candidate gate for one film/season | Requires actual run + independent source/scope/prose inspection; not universal source discovery or production publication |
| B04 | Specific publisher availability/finale + selected-season composition adapter, versioned evidence, unknown/date-change policy | Real public HTML parser/evidence is recorded; current runner refresh remains measured by this run; production scheduler and generic source assignment remain implementation obligations |
| B07 | One/three-frame and unknown routes, actual text/vision usage/latency/header collection, sequential budget reservation and failures | Own-account remaining daily quota/ZDR not independently inspected; sample proves specific paths, not broad quality percentages |
| A02 | Existing accepted foreground RAM/image-job contract preserved | Netlify/RLS/iPhone integration remains implementation acceptance |
| A04 | Gemini excluded by owner | No Gemini runtime capacity or new attempts |

Offline checks are fakes and source HTML controls. They prove guard behavior, not inference quality.
The existing archive includes these scripts/tests/docs/media fixtures; no packaging refactor is needed.
No main product, backend deployment, Pages publication or recommendation repetition is introduced.

Official model/limit references checked for this package:
https://console.groq.com/docs/vision
https://console.groq.com/docs/reasoning
https://console.groq.com/docs/rate-limits
https://console.groq.com/docs/models
