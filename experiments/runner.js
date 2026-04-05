#!/usr/bin/env node
// Runner for the "R (recipe あり)" condition.
// Spawns a pupplet subprocess, measures wall time and stdout bytes,
// writes a JSON result to experiments/results/.
//
// Usage:
//   node experiments/runner.js <task-id> <trial-num> -- <pupplet-args...>
//
// Example:
//   node experiments/runner.js reddit-feed 1 -- reddit feed 10 javascript
//   node experiments/runner.js note-draft  1 -- note post experiments/tasks/sample.md

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const sepIdx = args.indexOf('--');
if (sepIdx < 0) {
  console.error('Usage: node runner.js <task-id> <trial-num> -- <pupplet-args...>');
  process.exit(1);
}

const taskId = args[0];
const trialNum = parseInt(args[1]);
const puppletArgs = args.slice(sepIdx + 1);

const startTime = Date.now();
const startIso = new Date().toISOString();

let stdoutBytes = 0;
let stderrBytes = 0;
let stdoutBuffer = '';
let stderrBuffer = '';

const puppletBin = path.join(__dirname, '..', 'pupplet.js');
const proc = spawn('node', [puppletBin, ...puppletArgs], {
  cwd: path.join(__dirname, '..'),
});

proc.stdout.on('data', (chunk) => {
  stdoutBytes += chunk.length;
  stdoutBuffer += chunk.toString();
});
proc.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
  stderrBuffer += chunk.toString();
});

// Some pupplet commands (e.g., note post) succeed but then hang on client.close().
// Detect success from stdout and force-exit if we see the success marker.
const SUCCESS_MARKERS = [/✅/, /Draft created/, /^📝 \d+ articles/m, /\[\d+\]/];
let successDetected = false;
let successCheckInterval = setInterval(() => {
  if (!successDetected && SUCCESS_MARKERS.some((m) => m.test(stdoutBuffer))) {
    successDetected = true;
    // Give it 2s grace period to finish cleanly, then force kill
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGTERM');
    }, 2000);
    clearInterval(successCheckInterval);
  }
}, 200);

// Hard timeout: 30s for any task
const hardTimeout = setTimeout(() => {
  if (!proc.killed) proc.kill('SIGKILL');
}, 30000);

proc.on('close', (exitCode) => {
  clearInterval(successCheckInterval);
  clearTimeout(hardTimeout);
  const endTime = Date.now();
  const wallTimeMs = endTime - startTime;

  // In the R condition, the LLM issues exactly 1 tool call (the bash/shell invocation).
  // The "context in" is the combined stdout + stderr that the LLM would see.
  const bytesInContext = stdoutBytes + stderrBytes;

  // Success determined from stdout markers, not exit code (CDP close can hang)
  const success =
    successDetected ||
    (exitCode === 0 && !stdoutBuffer.includes('❌') && !stderrBuffer.includes('❌'));
  const failureReason = success
    ? null
    : detectFailureReason(stdoutBuffer + stderrBuffer, exitCode);

  const result = {
    condition: 'R',
    task_id: taskId,
    trial: trialNum,
    started_at: startIso,
    wall_time_ms: wallTimeMs,
    tool_calls: 1,
    bytes_in_context: bytesInContext,
    dom_inspections: 0, // Recipe encapsulates this — LLM doesn't see DOM
    retries: 0,
    success,
    failure_reason: failureReason,
    exit_code: exitCode,
    command: ['node', 'pupplet.js', ...puppletArgs].join(' '),
    stdout_preview: stdoutBuffer.slice(0, 500),
    stderr_preview: stderrBuffer.slice(0, 500),
  };

  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const filename = `R-${taskId}-trial${trialNum}.json`;
  const outPath = path.join(resultsDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`[runner] ${filename} — ${wallTimeMs}ms, ${bytesInContext}B, success=${success}`);
  process.exit(success ? 0 : 2);
});

function detectFailureReason(output, exitCode) {
  if (exitCode !== 0 && output.length === 0) return 'process_crash';
  if (/ECONNREFUSED/i.test(output)) return 'cdp_not_running';
  if (/Editor not found|Editor not loaded/.test(output)) return 'editor_not_found';
  if (/not found/i.test(output)) return 'element_not_found';
  if (/timeout/i.test(output)) return 'timeout';
  if (/❌/.test(output)) return 'explicit_error';
  if (exitCode !== 0) return `exit_${exitCode}`;
  return 'unknown';
}
