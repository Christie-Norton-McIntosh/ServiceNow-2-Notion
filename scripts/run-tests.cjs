#!/usr/bin/env node
/*
 Minimal test runner for ad-hoc scripts
 - Discovers test files matching test-*.cjs in tests/ and server/tests/
 - Runs them sequentially, reports pass/fail, sets exit code
 - Optional: --list to only list tests
 - Optional: --with-server to start local proxy before running tests
 - Optional: custom patterns as args (e.g., tests/test-*.cjs server/tests/test-*.cjs)
*/

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function toRegexFromGlob(glob) {
  // Handles simple patterns like test-*.cjs
  const escaped = glob.replace(/[.+^${}()|\[\]\\]/g, '\\$&');
  const re = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(re);
}

function listDirFiles(dir) {
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function findTests(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    // Expect patterns like "tests/test-*.cjs" or "server/tests/test-*.cjs"
    const parts = pattern.split('/');
    const fileGlob = parts.pop();
    const dir = path.join(repoRoot, parts.join('/'));
    const rx = toRegexFromGlob(fileGlob || 'test-*.cjs');
    for (const f of listDirFiles(dir)) {
      const base = path.basename(f);
      if (rx.test(base) && f.endsWith('.cjs')) {
        files.add(path.relative(repoRoot, f));
      }
    }
  }
  return Array.from(files).sort();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runNode(file, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => resolve({ file, code, signal }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  // Ensure tests run in test mode so code paths that rely on NODE_ENV === 'test'
  // (for example, marker stripping in servicenow.cjs) are executed during the
  // full-suite runner. Some CI or npm-run invocations don't set NODE_ENV.
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const listOnly = args.includes('--list');
  const withServer = args.includes('--with-server');
  const bail = args.includes('--bail');

  // Remove flags from patterns
  const patterns = args.filter((a) => !a.startsWith('--'));
  const defaultPatterns = ['tests/test-*.cjs', 'server/tests/test-*.cjs'];
  const searchPatterns = patterns.length ? patterns : defaultPatterns;

  const tests = findTests(searchPatterns);
  if (listOnly) {
    if (tests.length === 0) {
      console.log('No tests found for patterns:', searchPatterns.join(', '));
      return process.exit(0);
    }
    console.log('Discovered tests:');
    tests.forEach((t, i) => console.log(`${String(i + 1).padStart(2, '0')}. ${t}`));
    return process.exit(0);
  }

  if (tests.length === 0) {
    console.log('No tests found for patterns:', searchPatterns.join(', '));
    return process.exit(0);
  }

  let serverProc = null;
  if (withServer) {
    console.log('Starting local proxy server (node server/sn2n-proxy.cjs)...');
    serverProc = spawn(process.execPath, ['server/sn2n-proxy.cjs'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    // Give it a moment to start
    await sleep(1500);
  }

  console.log(`Running ${tests.length} test(s)...\n`);
  const results = [];
  for (const file of tests) {
    console.log(`▶ ${file}`);
    const res = await runNode(file);
    const status = res.code === 0 ? 'PASS' : 'FAIL';
    console.log(`⟵ ${status} ${file}\n`);
    results.push({ ...res, status });
    if (bail && res.code !== 0) break;
  }

  if (withServer && serverProc) {
    try { serverProc.kill('SIGINT'); } catch {}
  }

  const passed = results.filter((r) => r.code === 0).length;
  const failed = results.filter((r) => r.code !== 0).length;
  console.log('Summary:');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${results.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Runner error:', err);
  process.exit(1);
});
