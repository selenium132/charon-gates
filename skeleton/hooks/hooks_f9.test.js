/**
 * @file Ferryman F9 regression: other spellings of a ledger write or an override
 * must be blocked by the PreToolUse hook (exit 2).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(fileURLToPath(new URL('.', import.meta.url)), 'pre-release.js');

function run(cwd, command) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { cwd });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.write(JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'execute_bash',
      tool_input: { command },
    }));
    child.stdin.end();
  });
}

describe('F9: spellings that route around the hook', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'charon-f9-'));
    await writeFile(join(dir, 'charon-hook.json'), JSON.stringify({
      ledgerPath: '.charon/ledger.jsonl', artifactPath: 'a.bin', gatePath: 'g.js',
    }));
  });

  const blocked = [
    'echo x > ./.charon/ledger.jsonl',
    'echo x >> ".charon/ledger.jsonl"',
    "echo x > '.charon/ledger.jsonl'",
    'echo x | tee .charon/ledger.jsonl',
    'cp /tmp/fake.jsonl .charon/ledger.jsonl',
    'mv /tmp/fake.jsonl ./.charon/ledger.jsonl',
    "sed -i '' 's/FAIL/PASS/' .charon/ledger.jsonl",
    'dd if=/tmp/x of=.charon/ledger.jsonl',
    'truncate -s 0 .charon/ledger.jsonl',
    'node -e "require(\'fs\').writeFileSync(\'.charon/ledger.jsonl\',\'\')"',
    'node charon.js override .charon/ledger.jsonl --reason x --human me',
    'node ch""aron.js ove""rride .charon/ledger.jsonl',
    'c=char; node ${c}on.js over${x}ride l',
  ];
  for (const cmd of blocked) {
    it(`blocks: ${cmd}`, async () => {
      const r = await run(dir, cmd);
      assert.equal(r.code, 2, r.stderr);
    });
  }

  it('still allows reading the ledger', async () => {
    const r = await run(dir, 'cat .charon/ledger.jsonl');
    assert.equal(r.code, 0, r.stderr);
  });
});
