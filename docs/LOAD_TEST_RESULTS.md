# Local load-test results — 7 November 2026

The running local API and separate worker were tested with k6. All seven stages passed the configured HTTP p95 < 1 second and error-rate < 1% thresholds. There were **zero workload errors, HTTP 429s or server errors**. These measurements describe a paced local workload, not maximum capacity or a production SLA.

## Measured requests

Every virtual user pauses 200 ms per iteration. Redirect responses are checked for HTTP 302 without following external destinations. Latency columns use workload-only response-duration samples, excluding authentication/setup requests; request rates are k6 counter rates over each run. Creation and mixed stages use 20 iterations, not a 30-second sustained workload.

| Stage                          | VUs | Workload requests | Requests/sec | p50 ms | p95 ms | p99 ms | Errors |
| ------------------------------ | --: | ----------------: | -----------: | -----: | -----: | -----: | -----: |
| Warm-up, 30 seconds            |   5 |               728 |        24.06 |   4.99 |  10.91 |  19.61 |     0% |
| Baseline 1, 30 seconds         |  10 |             1,453 |        48.05 |   4.51 |  13.14 |  25.45 |     0% |
| Baseline 2, 30 seconds         |  10 |             1,460 |        48.31 |   4.46 |  10.99 |  18.75 |     0% |
| Baseline 3, 30 seconds         |  10 |             1,450 |        47.95 |   4.93 |  14.20 |  21.49 |     0% |
| Higher concurrency, 30 seconds |  20 |             2,921 |        96.63 |   4.42 |  11.76 |  19.85 |     0% |
| Creation burst, 20 iterations  |   5 |                20 |        20.50 |  36.99 |  50.83 |  59.32 |     0% |
| Mixed, 20 iterations           |   5 |                25 |        27.30 |  11.23 |  50.68 |  50.68 |     0% |

The three baseline runs cluster around 48 req/s. The 20-VU result is one exploratory run, not a replicated capacity estimate. The creation/mixed p99 values have very small sample counts and should not be interpreted as stable tail-latency estimates. Do not average run percentiles into a pooled percentile.

## Analytics and cache observations

- **8,042 expected click events; 8,042 persisted event rows and counter increments.** This includes warm-up and 15 setup visits. All 8,057 workload requests passed; some workload requests create/list links rather than redirect.
- Queue backlog (waiting + active + delayed) peaked at **10 in one-second samples** and ended at **0**. Failed jobs remained at **0**. Sampling can miss shorter peaks; no oldest-job-age measurement was collected.
- API counter deltas: **8,033 cache hits, 9 misses**, giving **99.89% hit ratio**. Cache errors, invalidation failures, rate-limiter errors and dropped events all had zero delta. Accepted-event and redirect deltas were both 8,042.
- The cache interval was **13:23:40–13:26:40 UTC** (18:53:40–18:56:40 IST), enclosing setup/warm-up and all workloads. It is an application-counter observation, not a per-stage ratio or generic Redis keyspace-hit ratio.
- A separate benchmark account owned all fixtures. Its **28 test links were soft-deleted** after drain/verification, preserving tombstones. The account and 8,042 event rows remain for evidence; no password/session token was saved. Existing users' links were not deleted.

Matching event counts demonstrate this run's observed outcome, not a guarantee of lossless delivery during crashes/outages.

## Environment and experimental limits

Node.js 24.13.0, k6 2.3.0, MySQL 8.0.46, Redis 7.4.2. Windows host with AMD Ryzen 7 7735HS, 16 logical CPUs and about 15.2 GiB RAM; Redis runs through WSL. API, worker, databases and load generator share local resources. Configuration: 60-second cache TTL and worker concurrency 5. HTTP uses localhost without production TLS/network conditions.

Three warmed target links dominate redirect traffic. This is a hot-cache, small-cardinality test. The natural TTL produced a few misses, but there was no controlled cache-disabled comparison. No CPU/disk saturation, large-dataset test, original synchronous baseline, outage load test, multi-instance test or maximum sustainable arrival rate was measured. Closed-loop pacing reduces offered load when responses slow, so this does not establish saturation capacity or long-term reliability.

## Reproduce

With the local API, MySQL, Redis and worker already running:

```sh
npm run loadtest -- --check
npm run loadtest
```

The runner creates one benchmark account, reuses three fixtures, performs the stages above, verifies persisted counts, and soft-deletes its own links. It respects existing quotas; registration remains limited to 5/hour/IP. Do not repeatedly create accounts to evade limits. For custom experiments, use an existing dedicated account with the direct harness in `docs/BENCHMARKS.md`.

Sanitized JSON summaries, logs, a Markdown report and one-second queue samples are saved under ignored `.local-services/load-tests/<timestamp>/`. This run's directory is `2026-11-07T13-23-56-237Z`; its additional cache-counter capture was taken from existing API logs. The automated runner does not expose a new metrics API or automatically collect those process logs.
