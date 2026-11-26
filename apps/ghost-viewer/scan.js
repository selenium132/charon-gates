/**
 * @file Ghost Viewer "Live scan" screen glue (browser only).
 * Animates buildScanSteps() and ends with the gate's own verdict for the same evidence.
 */
import { judge } from '../../skeleton/core/index.js';
import { GATE_DEF, profile } from './gate.js';
import { makeCursedEvidence, makeCleanEvidence, makeNoAudioEvidence } from './reader.js';
import { buildScanSteps } from './scan-timeline.js';

const STEP_MS = 140;
const MAKERS = { cursed: makeCursedEvidence, clean: makeCleanEvidence, nosound: makeNoAudioEvidence };
const $ = (id) => document.getElementById(id);
let running = false;

function lane(id, n) {
  const el = $(id);
  el.innerHTML = '';
  for (let i = 0; i < n; i++) el.appendChild(Object.assign(document.createElement('div'), { className: 'cell' }));
  return [...el.children];
}

function setMeter(id, text, tripped) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('tripped', tripped);
}

async function scan(kind) {
  if (running) return;
  running = true;
  for (const b of ['s-cursed', 's-clean', 's-nosound']) $(b).disabled = true;
  $('final').textContent = '';
  const ev = MAKERS[kind]();
  const steps = buildScanSteps(ev);
  const black = lane('l-black', steps.length);
  const frozen = lane('l-frozen', steps.length);
  const silence = lane('l-silence', steps.length);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    for (const c of [black, frozen, silence]) c.forEach((x) => x.classList.remove('cur'));
    black[i].classList.add('on', 'cur');
    if (s.black) black[i].classList.add('bad');
    frozen[i].classList.add('on', 'cur');
    if (s.still) frozen[i].classList.add('bad');
    silence[i].classList.add('cur');
    if (s.silent === null) silence[i].classList.add('na');
    else { silence[i].classList.add('on'); if (s.silent) silence[i].classList.add('bad'); }
    $('clock').textContent = `t = ${s.time.toFixed(1)} s of ${ev.durationSec} s`;
    setMeter('m-black', `${(s.blackShare * 100).toFixed(0)}% so far (limit ${profile.blackFrameMaxShare * 100}%)`, s.tripped.includes('black-frames'));
    setMeter('m-frozen', `longest ${s.frozenMax.toFixed(1)} s`, s.tripped.includes('frozen-run'));
    setMeter('m-silence', s.silenceMax === null ? 'no audio track: HOLD' : `longest ${s.silenceMax.toFixed(1)} s`, s.tripped.includes('silence-run'));
    if (!reduce) await new Promise((r) => setTimeout(r, STEP_MS));
  }
  const v = await judge(GATE_DEF, ev, new TextEncoder().encode(`synthetic:${kind}`));
  const lines = v.findings.map((f) => `${f.passed ? 'PASS' : f.measured == null ? 'HOLD' : 'FAIL'}  ${f.checkId}  ${f.measured ?? 'n/a'} (limit ${f.threshold} ${f.unit})`);
  $('clock').textContent = 'Scan finished. The verdict comes from the numbers.';
  $('final').textContent = `${v.status}\n${lines.join('\n')}`;
  for (const b of ['s-cursed', 's-clean', 's-nosound']) $(b).disabled = false;
  running = false;
}

$('s-cursed').addEventListener('click', () => scan('cursed'));
$('s-clean').addEventListener('click', () => scan('clean'));
$('s-nosound').addEventListener('click', () => scan('nosound'));
