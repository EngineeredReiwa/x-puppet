#!/usr/bin/env node
// Simulates an LLM creating a note.com draft WITHOUT site-specific recipe knowledge.
//
// 3 non-obvious pitfalls the blind LLM will hit:
//   1. /notes/new redirects cross-origin to editor.note.com
//   2. Title textarea is React-controlled (naive .value = ... doesn't reflect)
//   3. Body is ProseMirror (innerHTML doesn't work; needs paste event)
//
// Hints (graduated):
//   Hint 1: "Editor is on editor.note.com. Title is <textarea>, body is .ProseMirror contenteditable"
//   Hint 2: "React textarea: use nativeSetter + _valueTracker reset. ProseMirror: ClipboardEvent paste with text/html"
//   Hint 3: Full code snippet

const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

const trialNum = parseInt(process.argv[2] || '1');
const port = parseInt(process.env.CDP_PORT || '9222');

const logFile = path.join(__dirname, 'results', `L-note-draft-trial${trialNum}.jsonl`);
fs.writeFileSync(logFile, '');

const startTime = Date.now();
let toolCallCount = 0;
let totalBytes = 0;
let domInspections = 0;
let hintLevel = 0;

const TARGET_TITLE = 'テスト投稿';
const TARGET_BODY_HTML = '<h2>見出しテスト</h2><p>これは<strong>太字</strong>を含むテスト段落です。recipe vs low-level DOM 操作の比較実験で使っています。</p><p>これは2つ目の段落。特別な意味はありません。</p>';

function logStep(tool, description, bytes, preview) {
  toolCallCount++;
  totalBytes += bytes;
  const entry = {
    trial: trialNum,
    step: toolCallCount,
    elapsed_ms: Date.now() - startTime,
    tool,
    description,
    bytes,
    hint_level: hintLevel,
    preview: typeof preview === 'string' ? preview.slice(0, 150) : preview,
  };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  console.log(`[${toolCallCount}] ${tool} — ${description} — ${bytes}B (hint=${hintLevel})`);
}

async function evalWithLog(client, expression, description, isInspection = false) {
  if (isInspection) domInspections++;
  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const err = (result.exceptionDetails.text || '') + ' | ' + (result.exceptionDetails.exception?.description || '');
    logStep('Runtime.evaluate', `${description} [EXCEPTION]`, err.length, err);
    return null;
  }
  const value = result.result.value;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized || '', 'utf8');
  logStep('Runtime.evaluate', description, bytes, serialized);
  return value;
}

async function verifySuccess(client) {
  // Check if editor has the expected title and body
  const r = await client.Runtime.evaluate({
    expression: `JSON.stringify({
      title: document.querySelector('textarea[placeholder="記事タイトル"]')?.value,
      bodyText: document.querySelector('.ProseMirror')?.textContent?.slice(0, 200),
      h2Count: document.querySelector('.ProseMirror')?.querySelectorAll('h2')?.length || 0,
      strongCount: document.querySelector('.ProseMirror')?.querySelectorAll('strong')?.length || 0,
    })`,
    returnByValue: true,
  });
  if (r.exceptionDetails) return { title: null, bodyText: '', h2Count: 0, strongCount: 0 };
  return JSON.parse(r.result.value || '{}');
}

(async () => {
  let client;
  let success = false;
  let failureReason = null;

  try {
    // Create a new tab for the editor (matches R condition's approach)
    const tmpClient = await CDP({ port });
    await tmpClient.Target.createTarget({ url: 'https://note.com/notes/new' });
    await tmpClient.close();
    await new Promise((r) => setTimeout(r, 5000));
    logStep('Target.createTarget', 'create new tab at /notes/new', 100, 'created');

    // Find the editor tab (a blind LLM would look for the tab they just opened)
    const targets = await CDP.List({ port });
    const editorTab =
      targets.find((t) => t.type === 'page' && t.url.includes('editor.note.com')) ||
      targets.find((t) => t.type === 'page' && t.url.includes('note.com/notes/new'));

    if (!editorTab) {
      failureReason = 'editor_tab_not_found';
      throw new Error('editor tab not found');
    }

    client = await CDP({ port, target: editorTab });
    await client.Runtime.enable();

    // Note: a blind LLM might be surprised that the URL is editor.note.com not note.com
    await evalWithLog(client, `window.location.href`, 'check URL after redirect');

    // ====== PHASE 1: Explore page structure ======
    await evalWithLog(
      client,
      `document.title`,
      'check page title',
    );
    await evalWithLog(
      client,
      `JSON.stringify({
        inputs: document.querySelectorAll('input').length,
        textareas: document.querySelectorAll('textarea').length,
        contentEditables: document.querySelectorAll('[contenteditable="true"]').length,
      })`,
      'probe input elements',
      true
    );

    // Try to find title element
    await evalWithLog(
      client,
      `JSON.stringify(Array.from(document.querySelectorAll('textarea')).map(t => ({
        placeholder: t.placeholder,
        name: t.name,
      })))`,
      'list all textareas',
      true
    );

    // ====== PHASE 2: Naive title input attempt ======
    // A blind LLM would try the most obvious approach: set .value
    await evalWithLog(
      client,
      `(() => {
        const t = document.querySelector('textarea[placeholder="記事タイトル"]');
        if (!t) return 'no textarea found';
        t.value = '${TARGET_TITLE}';
        return 'set value to: ' + t.value;
      })()`,
      'naive title set: t.value = ...'
    );

    // Check if it worked
    const check1 = await verifySuccess(client);
    logStep('Runtime.evaluate', 'verify title after naive set', 100, JSON.stringify(check1));

    if (check1.title === TARGET_TITLE) {
      // Unlikely but possible
    }

    // Try dispatching input event
    await evalWithLog(
      client,
      `(() => {
        const t = document.querySelector('textarea[placeholder="記事タイトル"]');
        t.value = '${TARGET_TITLE}';
        t.dispatchEvent(new Event('input', { bubbles: true }));
        return t.value;
      })()`,
      'try setting value + dispatch input event'
    );

    const check2 = await verifySuccess(client);
    logStep('Runtime.evaluate', 'verify after input event', 100, JSON.stringify(check2));

    // ====== PHASE 3: Explore body editor ======
    await evalWithLog(
      client,
      `JSON.stringify({
        contentEditables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(e => ({
          tag: e.tagName,
          className: e.className?.slice(0, 80),
        })),
      })`,
      'inspect contenteditable elements',
      true
    );

    // Naive body input: try innerHTML
    await evalWithLog(
      client,
      `(() => {
        const editor = document.querySelector('.ProseMirror');
        if (!editor) return 'no prosemirror';
        editor.innerHTML = \`${TARGET_BODY_HTML.replace(/`/g, '\\`')}\`;
        return 'set innerHTML, length: ' + editor.innerHTML.length;
      })()`,
      'naive body: editor.innerHTML = ...'
    );

    const check3 = await verifySuccess(client);
    logStep('Runtime.evaluate', 'verify after innerHTML', 100, JSON.stringify(check3));

    // Even if innerHTML appears to work, React/ProseMirror may overwrite it on next tick.
    // Give it a moment and re-check.
    await new Promise((r) => setTimeout(r, 1500));
    const check4 = await verifySuccess(client);
    logStep('Runtime.evaluate', 'verify after wait (ProseMirror may reset)', 100, JSON.stringify(check4));

    // At this point, it's very likely we're still failing on the title (React control)
    if (check4.title === TARGET_TITLE && check4.h2Count > 0 && check4.strongCount > 0) {
      success = true;
    } else {
      // ====== PHASE 4 (HINT 1): Editor structure ======
      hintLevel = 1;
      console.log(`\n>>> HINT 1: Editor on editor.note.com. Title is <textarea placeholder="記事タイトル">, body is .ProseMirror contenteditable. React controls the textarea.\n`);

      // With hint 1, the LLM knows React is involved but may not know the exact trick.
      // It might try execCommand, dispatchEvent with InputEvent, or force-focus + type.
      await evalWithLog(
        client,
        `(() => {
          const t = document.querySelector('textarea[placeholder="記事タイトル"]');
          t.focus();
          document.execCommand('insertText', false, '${TARGET_TITLE}');
          return t.value;
        })()`,
        'try execCommand insertText on title'
      );

      const check5 = await verifySuccess(client);
      logStep('Runtime.evaluate', 'verify after execCommand', 100, JSON.stringify(check5));

      // Still likely failing. Try ProseMirror with paste event (guessed from "contenteditable")
      await evalWithLog(
        client,
        `(() => {
          const editor = document.querySelector('.ProseMirror');
          editor.focus();
          const cd = new DataTransfer();
          cd.setData('text/html', \`${TARGET_BODY_HTML.replace(/`/g, '\\`')}\`);
          editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: cd, bubbles: true, cancelable: true }));
          return 'paste dispatched';
        })()`,
        'try ClipboardEvent paste on ProseMirror (hint 1 guess)'
      );

      await new Promise((r) => setTimeout(r, 1500));
      const check6 = await verifySuccess(client);
      logStep('Runtime.evaluate', 'verify after paste', 100, JSON.stringify(check6));

      if (check6.title === TARGET_TITLE && check6.h2Count > 0 && check6.strongCount > 0) {
        success = true;
      } else if (check6.h2Count > 0 && check6.strongCount > 0) {
        // Body worked, title still broken
        // ====== PHASE 5 (HINT 2): React textarea trick ======
        hintLevel = 2;
        console.log(`\n>>> HINT 2: React textarea needs nativeSetter + _valueTracker reset to accept programmatic values.\n`);

        await evalWithLog(
          client,
          `(() => {
            const t = document.querySelector('textarea[placeholder="記事タイトル"]');
            const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            if (t._valueTracker) t._valueTracker.setValue('');
            ns.call(t, '${TARGET_TITLE}');
            t.dispatchEvent(new Event('input', { bubbles: true }));
            return t.value;
          })()`,
          'nativeSetter + valueTracker reset (hint 2)'
        );

        const check7 = await verifySuccess(client);
        logStep('Runtime.evaluate', 'verify after hint 2', 100, JSON.stringify(check7));

        if (check7.title === TARGET_TITLE && check7.h2Count > 0 && check7.strongCount > 0) {
          success = true;
        }
      }

      if (!success) {
        // ====== PHASE 6 (HINT 3): Full code ======
        hintLevel = 3;
        console.log(`\n>>> HINT 3: Full recipe code from platforms/note.js\n`);

        // Title
        await evalWithLog(
          client,
          `(() => {
            const t = document.querySelector('textarea[placeholder="記事タイトル"]');
            const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            if (t._valueTracker) t._valueTracker.setValue('');
            ns.call(t, '${TARGET_TITLE}');
            t.dispatchEvent(new Event('input', { bubbles: true }));
          })()`,
          'hint 3: apply exact title recipe'
        );

        // Body
        await evalWithLog(
          client,
          `(() => {
            const editor = document.querySelector('.ProseMirror');
            editor.focus();
            const cd = new DataTransfer();
            cd.setData('text/html', \`${TARGET_BODY_HTML.replace(/`/g, '\\`')}\`);
            cd.setData('text/plain', '');
            editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: cd, bubbles: true, cancelable: true }));
          })()`,
          'hint 3: apply exact body recipe'
        );

        await new Promise((r) => setTimeout(r, 1500));
        const check8 = await verifySuccess(client);
        logStep('Runtime.evaluate', 'verify after hint 3', 100, JSON.stringify(check8));

        if (check8.title === TARGET_TITLE && check8.h2Count > 0 && check8.strongCount > 0) {
          success = true;
        } else {
          failureReason = 'failed_even_with_hint_3';
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
    task_id: 'note-draft',
    trial: trialNum,
    success,
    failure_reason: failureReason,
    wall_time_ms: wallTimeMs,
    tool_calls: toolCallCount,
    bytes_in_context: totalBytes,
    dom_inspections: domInspections,
    retries: 0,
    hint_level_used: hintLevel,
  };

  const summaryFile = path.join(__dirname, 'results', `L-note-draft-trial${trialNum}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log(`\n=== L-note-draft trial${trialNum} ===`);
  console.log(`success: ${success} (hint_level=${hintLevel})`);
  console.log(`tool_calls: ${toolCallCount}`);
  console.log(`bytes_in_context: ${totalBytes}`);
  console.log(`wall_time_ms: ${wallTimeMs}`);
  console.log(`dom_inspections: ${domInspections}`);

  // Force exit because CDP can hang
  setTimeout(() => process.exit(success ? 0 : 2), 500);
})();
