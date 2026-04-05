#!/usr/bin/env node
// Simulates an LLM discovering how to scrape r/javascript top 10 posts
// WITHOUT any site-specific recipe knowledge.
//
// Implements the 3-hint graduated assistance protocol:
//   Phase 1: DOM exploration (no hints)
//   Phase 2: Aggressive scrolling + re-extraction
//   Phase 3 (Hint 1): "Reddit has a JSON API via .json suffix"
//   Phase 4 (Hint 2): "Endpoint: /r/javascript/.json?limit=10, data at .data.children[*].data"
//   Phase 5 (Hint 3): exact one-liner
//
// Each Runtime.evaluate = 1 "tool call" from the LLM's perspective.

const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

const trialNum = parseInt(process.argv[2] || '1');
const port = parseInt(process.env.CDP_PORT || '9222');

const logFile = path.join(__dirname, 'results', `L-reddit-feed-trial${trialNum}.jsonl`);
fs.writeFileSync(logFile, '');

const startTime = Date.now();
let toolCallCount = 0;
let totalBytes = 0;
let domInspections = 0;
let hintLevel = 0;

function logStep(step, description, bytes, dataPreview) {
  toolCallCount++;
  totalBytes += bytes;
  const entry = {
    trial: trialNum,
    step: toolCallCount,
    elapsed_ms: Date.now() - startTime,
    tool: step,
    description,
    bytes,
    hint_level: hintLevel,
    preview: typeof dataPreview === 'string' ? dataPreview.slice(0, 120) : dataPreview,
  };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  console.log(`[${toolCallCount}] ${step} — ${description} — ${bytes}B (hint=${hintLevel})`);
}

async function evalWithLog(client, expression, description, isInspection = false) {
  if (isInspection) domInspections++;
  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const err = result.exceptionDetails.text || 'eval error';
    logStep('Runtime.evaluate', `${description} [ERROR]`, err.length, err);
    return null;
  }
  const value = result.result.value;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized || '', 'utf8');
  logStep('Runtime.evaluate', description, bytes, serialized);
  return value;
}

(async () => {
  let client;
  let success = false;
  let failureReason = null;
  let result = null;

  try {
    // Prefer an existing reddit tab (matches R condition behavior)
    const targets = await CDP.List({ port });
    const tab =
      targets.find((t) => t.type === 'page' && t.url.includes('reddit.com')) ||
      targets.find((t) => t.type === 'page');
    client = await CDP({ port, target: tab });
    await client.Runtime.enable();
    await client.Page.enable();

    // ====== PHASE 1: DOM exploration (no hints) ======
    await client.Page.navigate({ url: 'https://www.reddit.com/r/javascript' });
    try { await client.Page.loadEventFired(); } catch {}
    await new Promise((r) => setTimeout(r, 3000));
    await client.Runtime.enable();
    logStep('Page.navigate', 'navigate to /r/javascript', 100, 'navigation complete');

    await evalWithLog(client, `window.location.href`, 'check current URL');
    await evalWithLog(
      client,
      `document.body.innerText.slice(0, 5000)`,
      'read page text (first 5KB)',
      true
    );
    await evalWithLog(
      client,
      `({
        articles: document.querySelectorAll('article').length,
        shredditPosts: document.querySelectorAll('shreddit-post').length,
      })`,
      'probe common selectors',
      true
    );
    await evalWithLog(
      client,
      `document.querySelector('shreddit-post')?.outerHTML?.slice(0, 2000)`,
      'inspect shreddit-post structure',
      true
    );

    // Attempt extraction from initially-loaded DOM
    async function extractShreddit(label) {
      const raw = await evalWithLog(
        client,
        `JSON.stringify(Array.from(document.querySelectorAll('shreddit-post')).map(p => ({
          title: p.getAttribute('post-title'),
          link: 'https://reddit.com' + p.getAttribute('permalink'),
        })).filter(p => p.title && p.link))`,
        label,
        true
      );
      return raw ? JSON.parse(raw) : [];
    }

    let posts = await extractShreddit('extract shreddit-post attributes');
    if (posts.length >= 10) {
      result = posts.slice(0, 10);
      success = true;
    } else {
      // ====== PHASE 2: Aggressive scrolling to trigger lazy loading ======
      for (let i = 0; i < 4; i++) {
        await evalWithLog(
          client,
          `window.scrollTo(0, document.body.scrollHeight); 'scrolled ${i + 1}'`,
          `scroll attempt ${i + 1}`
        );
        await new Promise((r) => setTimeout(r, 1500));
        posts = await extractShreddit(`re-extract after scroll ${i + 1}`);
        if (posts.length >= 10) break;
      }

      if (posts.length >= 10) {
        result = posts.slice(0, 10);
        success = true;
      } else {
        // ====== PHASE 3 (HINT 1): JSON API exists ======
        hintLevel = 1;
        console.log(`\n>>> HINT 1 GIVEN: Reddit has a JSON API accessible by appending .json to any URL.\n`);

        // The blind LLM now tries to use fetch with .json suffix
        await evalWithLog(
          client,
          `fetch('/r/javascript.json').then(r => r.status).catch(e => 'error: ' + e.message)`,
          'try fetch /r/javascript.json (hint 1)'
        );

        // Try parsing — LLM would guess structure
        const guess1 = await evalWithLog(
          client,
          `fetch('/r/javascript.json').then(r => r.json()).then(d => JSON.stringify(d).slice(0, 500)).catch(e => 'err: ' + e.message)`,
          'fetch and inspect JSON shape',
          true
        );

        // Try common paths: data.children
        const guess2 = await evalWithLog(
          client,
          `fetch('/r/javascript.json').then(r => r.json()).then(d => JSON.stringify(Object.keys(d))).catch(e => 'err')`,
          'inspect top-level keys'
        );

        // Try mapping data.children
        const attempt = await evalWithLog(
          client,
          `fetch('/r/javascript.json').then(r => r.json()).then(d =>
            JSON.stringify((d.data?.children || []).slice(0, 10).map(c => ({
              title: c.data?.title,
              link: c.data?.url,
            })))
          ).catch(e => '[]')`,
          'extract via data.children[*].data',
          true
        );

        const parsed = attempt ? JSON.parse(attempt) : [];
        const valid = parsed.filter((p) => p.title && p.link);

        if (valid.length >= 10) {
          result = valid;
          success = true;
        } else {
          // ====== PHASE 4 (HINT 2): Specific endpoint with limit ======
          hintLevel = 2;
          console.log(`\n>>> HINT 2 GIVEN: Use /r/javascript/.json?limit=10, data is at d.data.children[*].data\n`);

          const attempt2 = await evalWithLog(
            client,
            `fetch('/r/javascript/.json?limit=10').then(r => r.json()).then(d =>
              JSON.stringify(d.data.children.map(c => ({
                title: c.data.title,
                link: 'https://reddit.com' + c.data.permalink,
              })))
            ).catch(e => 'err: ' + e.message)`,
            'fetch with limit param (hint 2)',
            true
          );
          const parsed2 = attempt2 ? JSON.parse(attempt2) : [];
          const valid2 = Array.isArray(parsed2) ? parsed2.filter((p) => p.title && p.link) : [];

          if (valid2.length >= 10) {
            result = valid2;
            success = true;
          } else {
            // ====== PHASE 5 (HINT 3): Full one-liner ======
            hintLevel = 3;
            console.log(`\n>>> HINT 3 GIVEN: full command.\n`);

            const attempt3 = await evalWithLog(
              client,
              `await fetch('https://www.reddit.com/r/javascript/.json?limit=10').then(r=>r.json()).then(d=>JSON.stringify(d.data.children.map(c=>({title:c.data.title, url:'https://reddit.com'+c.data.permalink}))))`,
              'full recipe from hint 3',
              true
            );
            const parsed3 = attempt3 ? JSON.parse(attempt3) : [];
            const valid3 = Array.isArray(parsed3) ? parsed3.filter((p) => p.title && p.url) : [];
            if (valid3.length >= 10) {
              result = valid3;
              success = true;
            } else {
              failureReason = 'failed_even_with_hint_3';
            }
          }
        }
      }
    }
  } catch (e) {
    failureReason = `error: ${e.message.slice(0, 100)}`;
    console.error('Error:', e.message);
  } finally {
    if (client) {
      try { await client.close(); } catch {}
    }
  }

  const wallTimeMs = Date.now() - startTime;

  const summary = {
    condition: 'L',
    task_id: 'reddit-feed',
    trial: trialNum,
    success,
    failure_reason: failureReason,
    wall_time_ms: wallTimeMs,
    tool_calls: toolCallCount,
    bytes_in_context: totalBytes,
    dom_inspections: domInspections,
    retries: 0,
    result_count: result ? result.length : 0,
    hint_level_used: hintLevel,
  };

  const summaryFile = path.join(__dirname, 'results', `L-reddit-feed-trial${trialNum}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log(`\n=== L-reddit-feed trial${trialNum} ===`);
  console.log(`success: ${success} (hint_level=${hintLevel})`);
  console.log(`tool_calls: ${toolCallCount}`);
  console.log(`bytes_in_context: ${totalBytes}`);
  console.log(`wall_time_ms: ${wallTimeMs}`);
  console.log(`dom_inspections: ${domInspections}`);
  console.log(`result_count: ${result ? result.length : 0}`);

  process.exit(success ? 0 : 2);
})();
