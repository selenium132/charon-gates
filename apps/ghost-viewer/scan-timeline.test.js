import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../../skeleton/core/index.js';
import { GATE_DEF } from './gate.js';
import { makeCursedEvidence, makeCleanEvidence, makeNoAudioEvidence } from './reader.js';
import { buildScanSteps } from './scan-timeline.js';

const find = (v, id) => v.findings.find((f) => f.checkId === id);

describe('scan timeline equals the gate', () => {
  for (const [name, mk] of [['cursed', makeCursedEvidence], ['clean', makeCleanEvidence]]) {
    it(`${name}: last step matches the gate's numbers`, async () => {
      const ev = mk();
      const steps = buildScanSteps(ev);
      const last = steps[steps.length - 1];
      const v = await judge(GATE_DEF, ev, new Uint8Array([1]));
      assert.equal(steps.length, ev.frames.length);
      assert.equal(+last.blackShare.toFixed(4), find(v, 'black-frames').measured);
      assert.equal(+last.frozenMax.toFixed(2), find(v, 'frozen-run').measured);
      assert.equal(+last.silenceMax.toFixed(2), find(v, 'silence-run').measured);
      for (const id of ['black-frames', 'frozen-run', 'silence-run']) {
        assert.equal(last.tripped.includes(id), !find(v, id).passed, id);
      }
    });
  }
  it('no audio: silence is null (HOLD), never zero', () => {
    const last = buildScanSteps(makeNoAudioEvidence()).at(-1);
    assert.equal(last.silenceMax, null);
    assert.equal(last.tripped.includes('silence-run'), false);
  });
  it('the cursed sample trips frozen-run before the end of the clip', () => {
    const steps = buildScanSteps(makeCursedEvidence());
    const first = steps.findIndex((s) => s.tripped.includes('frozen-run'));
    assert.ok(first >= 0 && first < steps.length - 1);
  });
});
