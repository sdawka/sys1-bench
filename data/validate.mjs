#!/usr/bin/env node
// Validates data/categories/*.json against SPEC.md. Exit non-zero on any error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'categories');
const DIFFS = ['easy', 'medium', 'hard', 'edge'];
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const REQ = norm('Respond with ONLY a JSON object: {"decision": <value>, "confidence": <0..1>, "reason": "<one sentence>"}');
const CAP = 500;

let totalErr = 0, totalWarn = 0;
const summary = [];

function combos(vars) {
  const names = Object.keys(vars);
  const domains = names.map((n) => {
    const v = vars[n];
    if (v.type === 'choice') return v.options;
    const span = v.max - v.min + 1;
    const k = Math.min(span, 12);
    const set = new Set();
    for (let i = 0; i < k; i++) set.add(v.min + Math.round((i * (span - 1)) / Math.max(1, k - 1)));
    return [...set];
  });
  let total = domains.reduce((a, d) => a * d.length, 1);
  const out = [];
  if (total <= CAP) {
    const rec = (i, cur) => {
      if (i === names.length) return out.push({ ...cur });
      for (const x of domains[i]) { cur[names[i]] = x; rec(i + 1, cur); }
    };
    rec(0, {});
  } else {
    // deterministic pseudo-random sample of CAP combos
    let s = 12345;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < CAP; n++) {
      const c = {};
      names.forEach((nm, i) => (c[nm] = domains[i][Math.floor(rnd() * domains[i].length)]));
      out.push(c);
    }
  }
  return { list: out, total, sampled: total > CAP };
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const errs = [], warns = [];
  const E = (m) => errs.push(m), W = (m) => warns.push(m);
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { totalErr++; console.log(`FAIL ${f}: invalid JSON ${e.message}`); continue; }

  const base = f.replace(/\.json$/, '');
  if (d.id !== base) E(`id "${d.id}" != filename`);
  if (!/^[a-z][a-z0-9_]*$/.test(d.id || '')) E('id not snake_case');
  for (const k of ['name', 'description', 'system_prompt']) if (!d[k] || typeof d[k] !== 'string') E(`missing ${k}`);
  if (d.system_prompt && !norm(d.system_prompt).endsWith(REQ)) {
    if (norm(d.system_prompt).includes('Respond with ONLY a JSON object')) W('system_prompt ending deviates from required sentence');
    else E('system_prompt lacks required output sentence');
  }
  const o = d.output || {};
  if (o.type === 'enum') {
    if (!Array.isArray(o.options) || !o.options.length) E('enum options empty');
  } else if (o.type === 'number') {
    for (const k of ['min', 'max', 'tolerance']) if (typeof o[k] !== 'number') E(`number output missing ${k}`);
  } else E(`bad output.type ${o.type}`);

  // decision block (SPEC: System One / Decisions API)
  const dec = d.decision;
  const decOk = dec && typeof dec === 'object';
  if (!decOk) E('missing decision block');
  else {
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const str = (x) => typeof x === 'string' && x.trim().length > 0;
    if (!str(dec.instructions)) E('decision.instructions missing');
    else {
      if (/respond with only|json object|"decision"\s*:/i.test(dec.instructions)) E('decision.instructions contains JSON-output boilerplate');
      if (dec.instructions.length > 1500) W(`decision.instructions is ${dec.instructions.length} chars (>1500)`);
    }
    const opts = o.type === 'enum' ? (o.options || []) : null;
    if (dec.primitive === 'choice') {
      if (!opts) E('decision choice requires enum output');
      else if (!isObj(dec.criteria)) E('decision.criteria must be an object for choice');
      else {
        const keys = Object.keys(dec.criteria);
        const missing = opts.filter((x) => !keys.includes(x)), extra = keys.filter((k) => !opts.includes(k));
        if (missing.length || extra.length) E(`decision choice keys != output.options (missing: ${missing.join(',') || '-'}; extra: ${extra.join(',') || '-'})`);
        for (const k of keys) if (!str(dec.criteria[k])) E(`decision.criteria.${k} empty`);
      }
    } else if (dec.primitive === 'noul') {
      if (!opts) E('decision noul requires enum output');
      if (!isObj(dec.criteria) || !str(dec.criteria.true) || !str(dec.criteria.false)) E('decision noul needs criteria.true and criteria.false');
      else if (Object.keys(dec.criteria).length !== 2) E('decision noul criteria must have only true/false');
      if (opts) {
        if (!opts.includes(dec.true_option)) E(`decision.true_option "${dec.true_option}" not in options`);
        if (!opts.includes(dec.false_option)) E(`decision.false_option "${dec.false_option}" not in options`);
        if (dec.true_option === dec.false_option) E('decision true_option == false_option');
        if (opts.length !== 2) W(`noul over ${opts.length} options: options other than true/false_option are unreachable`);
      }
    } else if (dec.primitive === 'score') {
      const lv = dec.level_values;
      if (!Array.isArray(dec.criteria) || dec.criteria.length < 2 || dec.criteria.length > 10) E('decision score criteria must be an array of 2..10 levels');
      else dec.criteria.forEach((c, i) => { if (!str(c)) E(`decision.criteria[${i}] empty`); });
      if (!Array.isArray(lv) || !Array.isArray(dec.criteria) || lv.length !== dec.criteria.length) E('decision.level_values length != criteria length');
      else if (new Set(lv.map(String)).size !== lv.length) E('decision.level_values has duplicates');
      else if (opts) { for (const v of lv) if (!opts.includes(v)) E(`decision.level_values "${v}" not in options`); }
      else if (o.type === 'number') { for (const v of lv) if (typeof v !== 'number' || v < o.min || v > o.max) E(`decision.level_values ${v} outside [${o.min},${o.max}]`); }
    } else E(`decision.primitive "${dec.primitive}" not one of choice|noul|score`);
  }
  // reachable expected values, checked against the decision block after the case loop
  const reach = new Map(); // String(value) -> value
  const addReach = (v) => reach.set(String(v), v);

  const cases = Array.isArray(d.cases) ? d.cases : [];
  if (cases.length < 10) E(`${cases.length} cases (need >= 10)`);
  const ids = new Set();
  let edge = 0, templated = 0;
  const idRe = /^[a-z]+_\d{2}$/;
  let prefix = null;
  for (const c of cases) {
    const p = c.id || '?';
    const e = (m) => E(`${p}: ${m}`), w = (m) => W(`${p}: ${m}`);
    if (!idRe.test(p)) e('id pattern'); else {
      const pre = p.split('_')[0];
      if (prefix && pre !== prefix) e(`prefix ${pre} differs from ${prefix}`);
      prefix = prefix || pre;
    }
    if (ids.has(p)) e('duplicate id'); ids.add(p);
    if (!DIFFS.includes(c.difficulty)) e(`bad difficulty ${c.difficulty}`);
    if (c.difficulty === 'edge') edge++;
    for (const k of ['title', 'input', 'rationale']) if (typeof c[k] !== 'string' || !c[k].trim()) e(`missing ${k}`);
    if (!Array.isArray(c.tags)) e('tags not array');
    const hasE = 'expected' in c, hasX = 'expected_expr' in c;
    if (hasE === hasX) e('must have exactly one of expected / expected_expr');
    const vars = c.vars && Object.keys(c.vars).length ? c.vars : null;
    if (vars) templated++;
    if (vars && hasE) w('has vars but literal expected');
    if (!vars && hasX) w('expected_expr but no vars');
    // placeholders
    if (/\{%|\{\{[^}]*[^\w.}\s][^}]*\}\}/.test(c.input || '')) e('input uses template logic ({% %} or {{expr}}); only plain {{var}} is supported');
    const ph = new Set([...(c.input || '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]));
    for (const n of ph) if (!vars || !(n in vars)) e(`placeholder {{${n}}} has no var`);
    if (vars) for (const n of Object.keys(vars)) if (!ph.has(n)) e(`var ${n} unused in input`);
    // var defs
    let varsOk = true;
    if (vars) for (const [n, v] of Object.entries(vars)) {
      if (v.type === 'int') {
        if (!Number.isInteger(v.min) || !Number.isInteger(v.max) || v.min > v.max) { e(`var ${n} bad int range`); varsOk = false; }
      } else if (v.type === 'choice') {
        if (!Array.isArray(v.options) || v.options.length < 2) { e(`var ${n} choice needs >=2 options`); varsOk = false; }
      } else { e(`var ${n} bad type`); varsOk = false; }
    }
    // value checks
    const check = (val, ctx) => {
      if (o.type === 'enum') { if (!(o.options || []).includes(val)) return `${ctx}: "${val}" not in options`; }
      else if (o.type === 'number') { if (typeof val !== 'number' || !(val >= o.min && val <= o.max)) return `${ctx}: ${val} outside [${o.min},${o.max}]`; }
      return null;
    };
    if (hasE && !hasX) { const r = check(c.expected, 'expected'); if (r) e(r); addReach(c.expected); }
    if (hasX && !hasE) {
      let fn;
      try { fn = new Function('vars', `"use strict"; return (${c.expected_expr});`); }
      catch (x) { e(`expected_expr syntax: ${x.message}`); }
      if (fn && varsOk) {
        const { list } = vars ? combos(vars) : { list: [{}] };
        const seen = new Set(); let bad = 0, firstBad = null;
        for (const v of list) {
          try { const r = fn(v); seen.add(String(r)); addReach(r); const m = check(r, JSON.stringify(v)); if (m) { bad++; firstBad = firstBad || m; } }
          catch (x) { bad++; firstBad = firstBad || `throws ${x.message}`; }
        }
        if (bad) e(`expected_expr invalid for ${bad}/${list.length} combos, e.g. ${firstBad}`);
        if (vars && seen.size === 1) w(`expected_expr constant (${[...seen][0]}) across all combos`);
      }
    }
  }
  if (edge < 2) E(`only ${edge} edge cases`);
  if (decOk) {
    const vals = [...reach.values()];
    const bad = [];
    if (dec.primitive === 'noul') { for (const v of vals) if (v !== dec.true_option && v !== dec.false_option) bad.push(v); }
    else if (dec.primitive === 'choice' && dec.criteria && typeof dec.criteria === 'object') { for (const v of vals) if (!(String(v) in dec.criteria)) bad.push(v); }
    else if (dec.primitive === 'score' && Array.isArray(dec.level_values)) {
      const lv = dec.level_values;
      if (o.type === 'number') { const lo = Math.min(...lv), hi = Math.max(...lv); for (const v of vals) if (typeof v !== 'number' || v < lo || v > hi) bad.push(v); }
      else for (const v of vals) if (!lv.includes(v)) bad.push(v);
    }
    if (bad.length) E(`decision cannot express expected value(s): ${bad.slice(0, 5).join(', ')}`);
  }
  totalErr += errs.length; totalWarn += warns.length;
  summary.push({ f, templated });
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${base}  ${decOk ? dec.primitive : 'NO-DECISION'} cases=${cases.length} edge=${edge} templated=${templated} err=${errs.length} warn=${warns.length}`);
  errs.forEach((m) => console.log('   ERR  ' + m));
  warns.forEach((m) => console.log('   warn ' + m));
}
console.log(`\nTotal errors=${totalErr} warnings=${totalWarn}`);
process.exit(totalErr ? 1 : 0);
