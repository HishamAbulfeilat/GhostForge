'use strict';
/**
 * Shared child-process output limit. Node's default maxBuffer for
 * execFileSync/spawnSync is 1 MiB; anything larger kills the child and fails
 * with a bare "spawnSync git ENOBUFS". Every spawn that captures output
 * (outside boss.mjs, which has its own wrapper) should pass MAX_BUFFER.
 * CommonJS so both scripts/test.js and the ESM agent scripts can load it.
 */

const MAX_BUFFER = 256 * 1024 * 1024;

/** True when `err` is Node's "output exceeded maxBuffer" failure. */
function isEnobufs(err) {
  return !!err && (err.code === 'ENOBUFS' || /ENOBUFS|maxBuffer/i.test(String(err.message)));
}

/** Rewrite an ENOBUFS error so it names the command and the limit; others pass through. */
function explainEnobufs(err, label) {
  if (!isEnobufs(err)) return err;
  const out = new Error(
    `${label} produced more than ${MAX_BUFFER / (1024 * 1024)} MiB of output (ENOBUFS, maxBuffer exceeded)`
  );
  out.code = 'ENOBUFS';
  out.cause = err;
  out.stdout = err.stdout;
  out.stderr = err.stderr;
  return out;
}

module.exports = { MAX_BUFFER, isEnobufs, explainEnobufs };
