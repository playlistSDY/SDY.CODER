#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://coder.sdy.world';
const DEFAULT_TOTAL = 1200;
const DEFAULT_CONCURRENCY = 100;
const DEFAULT_TIMEOUT_MS = 1200000;
const DEFAULT_STAGGER_MS = 100;
const DEFAULT_INITIAL_BURST = 1200;

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    total: DEFAULT_TOTAL,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    staggerMs: DEFAULT_STAGGER_MS,
    initialBurst: DEFAULT_INITIAL_BURST,
    seed: `${Date.now()}`
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === '--total' && next) {
      options.total = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--concurrency' && next) {
      options.concurrency = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--stagger-ms' && next) {
      options.staggerMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--initial-burst' && next) {
      options.initialBurst = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--simultaneous') {
      options.staggerMs = 0;
      continue;
    }
    if (arg === '--seed' && next) {
      options.seed = next;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.total) || options.total <= 0) {
    throw new Error('--total must be a positive number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) {
    throw new Error('--concurrency must be a positive number');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }
  if (!Number.isFinite(options.staggerMs) || options.staggerMs < 0) {
    throw new Error('--stagger-ms must be a non-negative number');
  }
  if (!Number.isFinite(options.initialBurst) || options.initialBurst < 0) {
    throw new Error('--initial-burst must be a non-negative number');
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run load:test -- [--base-url https://coder.sdy.world] [--total 1200] [--concurrency 100] [--timeout-ms 120000] [--stagger-ms 200] [--initial-burst 100] [--seed demo] [--simultaneous]

Examples:
  npm run load:test
  npm run load:test -- --total 150 --concurrency 100
  npm run load:test -- --base-url http://localhost:5403 --total 40 --concurrency 20
  npm run load:test -- --total 1200 --concurrency 100 --initial-burst 100 --stagger-ms 200
  npm run load:test -- --total 150 --concurrency 100 --simultaneous`);
}

function createRng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return function rng() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}

function shuffle(rng, items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCases() {
  return [
    {
      language: 'c',
      name: 'c-low-sum',
      level: 'low',
      code: `#include <stdio.h>

int main(void) {
    long long sum = 0;
    for (int i = 1; i <= 1000000; ++i) {
        sum += i % 97;
    }
    printf("%lld\\n", sum);
    return 0;
}`
    },
    {
      language: 'c',
      name: 'c-mid-sort',
      level: 'medium',
      code: `#include <stdio.h>
#include <stdlib.h>

static int cmp_int(const void *a, const void *b) {
    int x = *(const int *)a;
    int y = *(const int *)b;
    return (x > y) - (x < y);
}

int main(void) {
    const int n = 60000;
    int *arr = (int *)malloc(sizeof(int) * n);
    if (!arr) return 1;
    unsigned int x = 2463534242u;
    for (int i = 0; i < n; ++i) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        arr[i] = (int)(x & 0x7fffffff);
    }
    qsort(arr, n, sizeof(int), cmp_int);
    long long checksum = 0;
    for (int i = 0; i < n; i += 500) checksum += arr[i];
    printf("%lld\\n", checksum);
    free(arr);
    return 0;
}`
    },
    {
      language: 'c',
      name: 'c-high-sieve',
      level: 'high',
      code: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    const int n = 2000000;
    char *is_prime = (char *)malloc((size_t)n + 1);
    if (!is_prime) return 1;
    memset(is_prime, 1, (size_t)n + 1);
    is_prime[0] = 0;
    is_prime[1] = 0;
    for (int i = 2; i * i <= n; ++i) {
        if (is_prime[i]) {
            for (int j = i * i; j <= n; j += i) is_prime[j] = 0;
        }
    }
    int count = 0;
    long long sum = 0;
    for (int i = 2; i <= n; ++i) {
        if (is_prime[i]) {
            count += 1;
            sum += i;
        }
    }
    printf("%d %lld\\n", count, sum);
    free(is_prime);
    return 0;
}`
    },
    {
      language: 'c',
      name: 'c-veryhigh-dp',
      level: 'very-high',
      code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    const int rows = 900;
    const int cols = 900;
    int *dp = (int *)malloc(sizeof(int) * rows * cols);
    if (!dp) return 1;
    for (int i = 0; i < rows; ++i) {
        for (int j = 0; j < cols; ++j) {
            int idx = i * cols + j;
            int from_up = i > 0 ? dp[(i - 1) * cols + j] : 0;
            int from_left = j > 0 ? dp[i * cols + (j - 1)] : 0;
            dp[idx] = (from_up + from_left + (i * 31 + j * 17) % 1000) % 1000000007;
        }
    }
    printf("%d\\n", dp[rows * cols - 1]);
    free(dp);
    return 0;
}`
    },
    {
      language: 'cpp',
      name: 'cpp-low-vector',
      level: 'low',
      code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<long long> v;
    v.reserve(100000);
    for (int i = 1; i <= 100000; ++i) v.push_back((1LL * i * i) % 1000003);
    long long sum = 0;
    for (long long x : v) sum += x;
    cout << sum << '\\n';
    return 0;
}`
    },
    {
      language: 'cpp',
      name: 'cpp-mid-sort',
      level: 'medium',
      code: `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int main() {
    const int n = 80000;
    vector<int> v(n);
    unsigned int x = 123456789u;
    for (int i = 0; i < n; ++i) {
        x = x * 1103515245u + 12345u;
        v[i] = static_cast<int>(x & 0x7fffffff);
    }
    sort(v.begin(), v.end());
    long long sum = 0;
    for (int i = 0; i < n; i += 400) sum += v[i];
    cout << sum << '\\n';
    return 0;
}`
    },
    {
      language: 'cpp',
      name: 'cpp-high-graph',
      level: 'high',
      code: `#include <iostream>
#include <queue>
#include <vector>
using namespace std;

int main() {
    const int n = 60000;
    vector<vector<int>> g(n);
    for (int i = 0; i < n; ++i) {
        for (int step = 1; step <= 3; ++step) {
            g[i].push_back((i + step * 97) % n);
        }
    }
    vector<int> dist(n, -1);
    queue<int> q;
    dist[0] = 0;
    q.push(0);
    while (!q.empty()) {
        int cur = q.front();
        q.pop();
        for (int nxt : g[cur]) {
            if (dist[nxt] == -1) {
                dist[nxt] = dist[cur] + 1;
                q.push(nxt);
            }
        }
    }
    long long checksum = 0;
    for (int i = 0; i < n; i += 100) checksum += dist[i];
    cout << checksum << '\\n';
    return 0;
}`
    },
    {
      language: 'cpp',
      name: 'cpp-veryhigh-matrix',
      level: 'very-high',
      code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    const int n = 180;
    vector<vector<int>> a(n, vector<int>(n));
    vector<vector<int>> b(n, vector<int>(n));
    vector<vector<long long>> c(n, vector<long long>(n, 0));
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            a[i][j] = (i * 17 + j * 13) % 1000;
            b[i][j] = (i * 19 + j * 7) % 1000;
        }
    }
    for (int i = 0; i < n; ++i) {
        for (int k = 0; k < n; ++k) {
            for (int j = 0; j < n; ++j) {
                c[i][j] += 1LL * a[i][k] * b[k][j];
            }
        }
    }
    cout << c[n - 1][n - 1] << '\\n';
    return 0;
}`
    },
    {
      language: 'java',
      name: 'java-low-loop',
      level: 'low',
      code: `public class Main {
    public static void main(String[] args) {
        long sum = 0;
        for (int i = 1; i <= 1_500_000; i++) {
            sum += (long) (i % 113) * (i % 17);
        }
        System.out.println(sum);
    }
}`
    },
    {
      language: 'java',
      name: 'java-mid-sort',
      level: 'medium',
      code: `import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int n = 70_000;
        int[] arr = new int[n];
        long x = 88172645463325252L;
        for (int i = 0; i < n; i++) {
            x ^= (x << 7);
            x ^= (x >>> 9);
            arr[i] = (int) (x & 0x7fffffff);
        }
        Arrays.sort(arr);
        long checksum = 0;
        for (int i = 0; i < n; i += 350) checksum += arr[i];
        System.out.println(checksum);
    }
}`
    },
    {
      language: 'java',
      name: 'java-high-sieve',
      level: 'high',
      code: `public class Main {
    public static void main(String[] args) {
        int n = 2_000_000;
        boolean[] prime = new boolean[n + 1];
        java.util.Arrays.fill(prime, true);
        prime[0] = false;
        prime[1] = false;
        for (int i = 2; i * i <= n; i++) {
            if (prime[i]) {
                for (int j = i * i; j <= n; j += i) prime[j] = false;
            }
        }
        long sum = 0;
        int count = 0;
        for (int i = 2; i <= n; i++) {
            if (prime[i]) {
                count++;
                sum += i;
            }
        }
        System.out.println(count + " " + sum);
    }
}`
    },
    {
      language: 'java',
      name: 'java-veryhigh-dp',
      level: 'very-high',
      code: `public class Main {
    public static void main(String[] args) {
        int rows = 1000;
        int cols = 1000;
        int[][] dp = new int[rows][cols];
        final int MOD = 1_000_000_007;
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                int up = i > 0 ? dp[i - 1][j] : 0;
                int left = j > 0 ? dp[i][j - 1] : 0;
                dp[i][j] = (int) (((long) up + left + ((i * 37 + j * 19) % 1000)) % MOD);
            }
        }
        System.out.println(dp[rows - 1][cols - 1]);
    }
}`
    },
    {
      language: 'python',
      name: 'python-low-loop',
      level: 'low',
      code: `total = 0
for i in range(1, 1_200_000):
    total += (i % 97) * (i % 23)
print(total)
`
    },
    {
      language: 'python',
      name: 'python-mid-sort',
      level: 'medium',
      code: `n = 70000
x = 2463534242
arr = []
for _ in range(n):
    x ^= (x << 13) & 0xFFFFFFFF
    x ^= (x >> 17)
    x ^= (x << 5) & 0xFFFFFFFF
    arr.append(x & 0x7FFFFFFF)
arr.sort()
print(sum(arr[::350]))
`
    },
    {
      language: 'python',
      name: 'python-high-sieve',
      level: 'high',
      code: `n = 1_500_000
prime = bytearray(b"\\x01") * (n + 1)
prime[0:2] = b"\\x00\\x00"
limit = int(n ** 0.5)
for i in range(2, limit + 1):
    if prime[i]:
        start = i * i
        step = i
        prime[start:n + 1:step] = b"\\x00" * (((n - start) // step) + 1)
count = 0
total = 0
for i in range(2, n + 1):
    if prime[i]:
        count += 1
        total += i
print(count, total)
`
    },
    {
      language: 'python',
      name: 'python-veryhigh-grid',
      level: 'very-high',
      code: `rows = 900
cols = 900
mod = 1_000_000_007
dp = [[0] * cols for _ in range(rows)]
for i in range(rows):
    row = dp[i]
    prev = dp[i - 1] if i else None
    for j in range(cols):
        up = prev[j] if i else 0
        left = row[j - 1] if j else 0
        row[j] = (up + left + ((i * 37 + j * 11) % 1000)) % mod
print(dp[-1][-1])
`
    }
  ];
}

function buildPlan(testCases, total, rng) {
  const plan = [];
  for (let i = 0; i < total; i += 1) {
    const picked = testCases[Math.floor(rng() * testCases.length)];
    plan.push({
      requestId: i + 1,
      language: picked.language,
      name: picked.name,
      level: picked.level,
      code: picked.code,
      stdin: ''
    });
  }
  return shuffle(rng, plan);
}

async function runOne(baseUrl, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const sentAtIso = new Date(startedAt).toISOString();

  console.log(
    `[SEND] #${payload.requestId} ${payload.language}/${payload.name} level=${payload.level} at=${sentAtIso}`
  );

  try {
    const response = await fetch(`${baseUrl}/api/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        language: payload.language,
        code: payload.code,
        stdin: payload.stdin
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }

    return {
      ...payload,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      sentAt: startedAt,
      sentAtIso,
      receivedAt: Date.now(),
      receivedAtIso: new Date().toISOString(),
      data
    };
  } catch (error) {
    const receivedAt = Date.now();
    return {
      ...payload,
      ok: false,
      status: null,
      elapsedMs: receivedAt - startedAt,
      sentAt: startedAt,
      sentAtIso,
      receivedAt,
      receivedAtIso: new Date(receivedAt).toISOString(),
      error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runScheduled(plan, concurrency, staggerMs, initialBurst, rng, worker) {
  const results = new Array(plan.length);
  const inFlight = new Set();
  const burstCount = Math.min(plan.length, concurrency, initialBurst);

  const launch = (item, index) => {
    const task = (async () => {
      results[index] = await worker(item, index);
    })()
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  };

  for (let index = 0; index < plan.length; index += 1) {
    if (index >= burstCount && staggerMs > 0) {
      const delayMs = Math.floor(rng() * (staggerMs + 1));
      await sleep(delayMs);
    }

    while (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }

    launch(plan[index], index);
  }

  await Promise.all(inFlight);
  return results;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(results) {
  const ok = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  const elapsed = results.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const queueWaits = results
    .map((item) => item.data?.queueWaitMs)
    .filter((value) => typeof value === 'number')
    .sort((a, b) => a - b);

  const byLanguage = {};
  for (const item of results) {
    if (!byLanguage[item.language]) {
      byLanguage[item.language] = { total: 0, ok: 0, failed: 0 };
    }
    byLanguage[item.language].total += 1;
    if (item.ok) byLanguage[item.language].ok += 1;
    else byLanguage[item.language].failed += 1;
  }

  return {
    total: results.length,
    ok: ok.length,
    failed: failed.length,
    elapsedMs: {
      min: elapsed[0] ?? null,
      p50: percentile(elapsed, 50),
      p90: percentile(elapsed, 90),
      p95: percentile(elapsed, 95),
      max: elapsed[elapsed.length - 1] ?? null
    },
    queueWaitMs: {
      min: queueWaits[0] ?? null,
      p50: percentile(queueWaits, 50),
      p90: percentile(queueWaits, 90),
      p95: percentile(queueWaits, 95),
      max: queueWaits[queueWaits.length - 1] ?? null
    },
    byLanguage
  };
}

function printSummary(summary, baseUrl, concurrency, seed) {
  console.log('');
  console.log('=== Load Test Summary ===');
  console.log(`target        : ${baseUrl}`);
  console.log(`seed          : ${seed}`);
  console.log(`total         : ${summary.total}`);
  console.log(`success       : ${summary.ok}`);
  console.log(`failed        : ${summary.failed}`);
  console.log(`concurrency   : ${concurrency}`);
  console.log(
    `elapsed(ms)   : min=${summary.elapsedMs.min} p50=${summary.elapsedMs.p50} p90=${summary.elapsedMs.p90} p95=${summary.elapsedMs.p95} max=${summary.elapsedMs.max}`
  );
  console.log(
    `queueWait(ms) : min=${summary.queueWaitMs.min} p50=${summary.queueWaitMs.p50} p90=${summary.queueWaitMs.p90} p95=${summary.queueWaitMs.p95} max=${summary.queueWaitMs.max}`
  );
  console.log('by language   :');
  for (const [language, stats] of Object.entries(summary.byLanguage)) {
    console.log(
      `  ${language.padEnd(6)} total=${String(stats.total).padEnd(4)} ok=${String(stats.ok).padEnd(4)} failed=${stats.failed}`
    );
  }
}

function printFailures(results) {
  const failed = results.filter((item) => !item.ok);
  if (failed.length === 0) {
    return;
  }

  console.log('');
  console.log('=== Failed Requests ===');
  for (const item of failed.slice(0, 20)) {
    const message =
      item.error ||
      item.data?.error ||
      item.data?.stderr ||
      item.data?.raw ||
      'unknown error';
    console.log(
      `#${item.requestId} ${item.language}/${item.name} level=${item.level} status=${item.status ?? 'ERR'} elapsed=${item.elapsedMs}ms`
    );
    console.log(`  ${String(message).split('\n')[0]}`);
  }
  if (failed.length > 20) {
    console.log(`  ... ${failed.length - 20} more failures omitted`);
  }
}

function printProgress(done, total, active, result) {
  const status = result.ok ? 'OK ' : 'ERR';
  const queueWait = result.data?.queueWaitMs;
  const queueText = typeof queueWait === 'number' ? ` queue=${queueWait}ms` : '';
  console.log(
    `[RECV] #${result.requestId} at=${result.receivedAtIso} status=${result.status ?? 'ERR'} elapsed=${result.elapsedMs}ms${queueText}`
  );
  console.log(
    `[${String(done).padStart(String(total).length)}/${total}] active=${String(active).padStart(3)} ${status} ${result.language}/${result.name} level=${result.level} sent=${result.sentAtIso} recv=${result.receivedAtIso} status=${result.status ?? 'ERR'} elapsed=${result.elapsedMs}ms${queueText}`
  );
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('This script requires Node.js with global fetch support (Node 18+).');
  }

  const options = parseArgs(process.argv.slice(2));
  const rng = createRng(options.seed);
  const testCases = buildCases();
  const plan = buildPlan(testCases, options.total, rng);
  const startedAt = Date.now();
  let done = 0;
  let active = 0;

  console.log('Starting load test...');
  console.log(`target      : ${options.baseUrl}`);
  console.log(`total       : ${plan.length}`);
  console.log(`concurrency : ${options.concurrency}`);
  console.log(`timeoutMs   : ${options.timeoutMs}`);
  console.log(`initialBurst: ${Math.min(options.initialBurst, options.concurrency, plan.length)}`);
  console.log(`staggerMs   : 0~${options.staggerMs} between sends`);
  console.log(`seed        : ${options.seed}`);
  console.log(`case pool   : ${testCases.length} snippets (C/C++/Java/Python x 4 levels)`);

  const results = await runScheduled(
    plan,
    options.concurrency,
    options.staggerMs,
    options.initialBurst,
    rng,
    async (item) => {
    active += 1;
    const result = await runOne(options.baseUrl, item, options.timeoutMs);
    done += 1;
    active -= 1;
    printProgress(done, plan.length, active, result);
    return result;
    }
  );

  const totalElapsed = Date.now() - startedAt;
  const summary = summarize(results);
  printSummary(summary, options.baseUrl, options.concurrency, options.seed);
  printFailures(results);

  console.log('');
  console.log(`wall time(ms): ${totalElapsed}`);
  console.log('done.');

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
