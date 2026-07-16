const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LOT_SIZE = 65; // NSE Nifty lot size, verify on your terminal — this changes periodically
let HIST = [];
let lastMatchContext = null;
let lastOptionChain = null;

function fmt(n, d=2){ return Number(n).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function pct(n, d=1){ return (n>=0?'+':'') + n.toFixed(d) + '%'; }
function roundTo(n, step){ return Math.round(n/step)*step; }

function gapBucket(absGapPct){
  if(absGapPct < 0.25) return '<0.25%';
  if(absGapPct < 0.50) return '0.25-0.50%';
  if(absGapPct < 1.00) return '0.50-1.00%';
  return '>1.00%';
}

function quantile(arr, q){
  const s = [...arr].sort((a,b)=>a-b);
  const pos = (s.length-1)*q;
  const base = Math.floor(pos), rest = pos-base;
  if(s[base+1]!==undefined) return s[base] + rest*(s[base+1]-s[base]);
  return s[base];
}

function summarize(rows){
  const n = rows.length;
  if(n===0) return null;
  const green = rows.filter(r=>r.col==='G').length;
  const avgIntra = rows.reduce((a,r)=>a+r.intra,0)/n;
  const avgRangePts = rows.reduce((a,r)=>a+r.rangePts,0)/n;
  const avgRangePct = rows.reduce((a,r)=>a+r.rangePct,0)/n;
  return { n, winPct: green/n*100, avgIntra, avgRangePts, avgRangePct,
           medRangePts: quantile(rows.map(r=>r.rangePts),0.5),
           p75RangePts: quantile(rows.map(r=>r.rangePts),0.75),
           p90RangePts: quantile(rows.map(r=>r.rangePts),0.9) };
}

function sampleTag(n){
  if(n < 10) return {label:'too small — context only', cls:'low'};
  if(n < 25) return {label:'small sample — treat cautiously', cls:'low'};
  return {label:'reasonable sample', cls:''};
}

// Log-gamma via Lanczos approximation, for computing exact binomial
// probabilities without overflowing on n choose k at n up to a few
// hundred.
function logGamma(x){
  const g = 7;
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if(x < 0.5) return Math.log(Math.PI/Math.sin(Math.PI*x)) - logGamma(1-x);
  x -= 1;
  let a = c[0];
  const t = x+g+0.5;
  for(let i=1;i<g+2;i++) a += c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI) + (x+0.5)*Math.log(t) - t + Math.log(a);
}

function logBinomPMF(k, n, p){
  if(p<=0) return k===0 ? 0 : -Infinity;
  if(p>=1) return k===n ? 0 : -Infinity;
  const logC = logGamma(n+1) - logGamma(k+1) - logGamma(n-k+1);
  return logC + k*Math.log(p) + (n-k)*Math.log(1-p);
}

// Exact two-sided binomial test, same method scipy.stats.binomtest uses
// for alternative='two-sided': sum the probability of every outcome at
// least as extreme (i.e. no more likely) than the one actually observed.
// Verified against scipy's output on this exact dataset before shipping —
// see the audit conversation for the cross-check.
function proportionPValue(k, n, p0){
  if(n===0) return null;
  const pmfs = [];
  for(let i=0;i<=n;i++) pmfs.push(Math.exp(logBinomPMF(i,n,p0)));
  const observed = pmfs[k];
  const threshold = observed * 1.0000001; // small tolerance for float noise
  let pvalue = 0;
  for(let i=0;i<=n;i++) if(pmfs[i] <= threshold) pvalue += pmfs[i];
  return Math.min(pvalue, 1);
}

// Honest confidence tier, accounting for how many simultaneous comparisons
// this stat was drawn from (5 weekdays, 4 gap buckets, etc.) — a raw
// p<0.05 across several tested categories is expected some of the time by
// chance alone, so the label reflects the corrected threshold, not the
// raw one. See the audit: none of the 5 weekday effects survived this.
function significanceLabel(pvalue, numComparisons){
  if(pvalue == null) return {tier:'na', text:'not enough data to test'};
  const corrected = 0.05 / numComparisons;
  if(pvalue < corrected) return {tier:'robust', text:`statistically robust even after correcting for testing ${numComparisons} categories at once (p=${pvalue.toFixed(4)})`};
  if(pvalue < 0.05) return {tier:'weak', text:`nominally p=${pvalue.toFixed(4)} but does not survive correction for testing ${numComparisons} categories at once — treat as a weak lean, not a proven edge`};
  return {tier:'none', text:`p=${pvalue.toFixed(4)} — not distinguishable from the baseline rate, no evidence of edge here`};
}

// True Range accounts for gaps (max of today's H-L, |H-prevClose|,
// |L-prevClose|) — matters here given how often NIFTY gaps. ATR uses
// Wilder's smoothing, the standard method every charting platform uses,
// not a plain moving average.
function trueRange(row){
  if(row.pc == null) return row.h - row.l;
  return Math.max(row.h - row.l, Math.abs(row.h - row.pc), Math.abs(row.l - row.pc));
}

function computeATR(rows, period){
  if(rows.length < period) return null;
  const tr = rows.map(trueRange);
  let atr = tr.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for(let i = period; i < tr.length; i++){
    atr = (atr*(period-1) + tr[i]) / period;
  }
  return atr;
}

function computeADR(rows, period){
  if(rows.length < period) return null;
  const recent = rows.slice(-period);
  return recent.reduce((a,r)=>a+r.rangePts,0) / period;
}

// Streaks use close vs PREVIOUS close (the standard "up day / down day"
// definition), not candle color (close vs that day's own open) — matches
// the original workbook's Sign/Streak columns exactly.
function computeStreaks(rows){
  const valid = rows.filter(r => r.pc != null);
  let currentLen = 0, currentDir = null;
  for(let i = valid.length-1; i>=0; i--){
    const r = valid[i];
    if(r.c === r.pc) break;
    const dir = r.c > r.pc ? 'up' : 'down';
    if(currentDir === null){ currentDir = dir; currentLen = 1; }
    else if(dir === currentDir){ currentLen++; }
    else break;
  }
  let maxUp=0, maxDown=0, runLen=0, runDir=null;
  for(const r of valid){
    if(r.c === r.pc){ runDir=null; runLen=0; continue; }
    const dir = r.c > r.pc ? 'up' : 'down';
    if(dir === runDir) runLen++; else { runDir = dir; runLen = 1; }
    if(dir === 'up') maxUp = Math.max(maxUp, runLen); else maxDown = Math.max(maxDown, runLen);
  }
  return { currentLen, currentDir, maxUp, maxDown };
}

async function loadHistory(){
  const res = await fetch('/api/get-history');
  const json = await res.json();
  HIST = json.rows || [];
  document.getElementById('sampleBadge').innerHTML = `Sample base: <b>${HIST.length}</b> trading days · ${HIST[0]?.d} → ${HIST[HIST.length-1]?.d}`;
  renderHistoryTable();
  renderVolatility();
  return json;
}

function renderVolatility(){
  const el = document.getElementById('volatilityWrap');
  if(!el) return;
  const lastClose = HIST.length ? HIST[HIST.length-1].c : null;
  const atr14 = computeATR(HIST, 14);
  const adr5 = computeADR(HIST, 5);
  const adr10 = computeADR(HIST, 10);
  const adr20 = computeADR(HIST, 20);
  const streaks = computeStreaks(HIST);

  const cell = (label, pts) => {
    if(pts == null) return `<div class="snap-cell"><div class="snap-label">${label}</div><div class="snap-val neutral">n/a</div></div>`;
    const pctVal = lastClose ? (pts/lastClose*100).toFixed(2) : null;
    return `<div class="snap-cell"><div class="snap-label">${label}</div><div class="snap-val">${pts.toFixed(0)} pts${pctVal?` <span style="font-size:11px;color:var(--text-dim);">(${pctVal}%)</span>`:''}</div></div>`;
  };

  const streakCell = streaks.currentLen
    ? `<div class="snap-cell"><div class="snap-label">Current Streak</div><div class="snap-val ${streaks.currentDir==='up'?'up':'down'}">${streaks.currentLen}${streaks.currentDir==='up'?'↑':'↓'} <span style="font-size:11px;color:var(--text-dim);">(max ${streaks.currentDir==='up'?streaks.maxUp:streaks.maxDown} in sample)</span></div></div>`
    : `<div class="snap-cell"><div class="snap-label">Current Streak</div><div class="snap-val neutral">n/a</div></div>`;

  el.innerHTML = cell('ATR (14, Wilder)', atr14) + cell('ADR (5)', adr5) + cell('ADR (10)', adr10) + cell('ADR (20)', adr20) + streakCell;
}

async function loadStatus(){
  try{
    const res = await fetch('/api/status');
    const meta = await res.json();
    renderFreshness(meta);
  }catch(e){
    renderFreshness(null);
  }
}

function renderFreshness(meta){
  const el = document.getElementById('freshnessBanner');
  const lastDate = HIST.length ? HIST[HIST.length-1].d : null;
  if(!meta || !meta.lastUpdated){
    el.className = 'freshness';
    el.textContent = `Data through ${lastDate || 'unknown'} (from bundled seed only — no auto-fetch has run yet).`;
    return;
  }
  const when = new Date(meta.lastUpdated);
  const stamp = when.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  if(meta.source === 'auto-failed'){
    el.className = 'freshness warn';
    el.textContent = `⚠ Auto-fetch last attempted ${stamp} and failed (${meta.lastAutoError || 'unknown error'}). Data still ends ${lastDate}. Use "Confirm Today's Close" below to enter it manually.`;
  } else if(meta.source === 'manual'){
    el.className = 'freshness ok';
    el.textContent = `Data through ${lastDate} — last entry confirmed manually on ${stamp}.`;
  } else if(meta.source && meta.source.startsWith('auto')){
    el.className = 'freshness ok';
    const via = meta.source.includes('nse') ? 'NSE' : meta.source.includes('yahoo') ? 'Yahoo' : 'auto-fetch';
    el.textContent = `Data through ${lastDate} — last auto-fetch (via ${via}) ran ${stamp}${meta.addedCount ? ` (added ${meta.addedCount} new day)` : ' (no new day found)'}.`;
  } else {
    el.className = 'freshness';
    el.textContent = `Data through ${lastDate}. Last update: ${stamp}.`;
  }
}

function renderHistoryTable(){
  const body = document.getElementById('historyBody');
  const recent = HIST.slice(-15).reverse();
  body.innerHTML = recent.map(r=>`
    <tr>
      <td>${r.d}</td><td>${r.wd}</td><td>${fmt(r.o)}</td><td>${fmt(r.h)}</td>
      <td>${fmt(r.l)}</td><td>${fmt(r.c)}</td>
      <td>${r.gap!=null ? pct(r.gap,2) : '—'}</td>
      <td>${r.source || 'seed'}</td>
    </tr>`).join('');
}

function localDateStr(d){
  // valueAsDate reads UTC calendar-day parts, which is wrong for IST users
  // between midnight and 5:30am (still "yesterday" in UTC) — build the
  // date string from local date parts instead, and set .value directly.
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function init(){
  const today = new Date();
  document.getElementById('inDate').value = localDateStr(today);
  document.getElementById('logDate').value = localDateStr(today);
  updateDateHint();
  document.getElementById('inDate').addEventListener('change', updateDateHint);
  document.getElementById('btnCalc').addEventListener('click', runMatch);
  document.getElementById('btnCaptureOpenNow').addEventListener('click', captureOpenNow);
  document.getElementById('btnLogSave').addEventListener('click', saveSession);
  document.getElementById('btnTriggerFetch').addEventListener('click', triggerFetch);
  document.getElementById('btnAddLevel').addEventListener('click', ()=> addLevelRow());
  document.getElementById('btnSuggestLevels').addEventListener('click', suggestLevels);
  document.getElementById('btnSavePlan').addEventListener('click', savePlan);
  document.getElementById('vixAlertToggle').addEventListener('change', toggleVixAlert);
  document.getElementById('btnLoadChain').addEventListener('click', loadOptionChain);
  seedDefaultLevels();

  loadHistory().then(()=>{
    const last = HIST[HIST.length-1];
    if(last) document.getElementById('inPrevClose').placeholder = `last on file: ${last.c} (${last.d})`;
    loadStatus();
    // Only safe to auto-fill + auto-run once HIST is actually populated —
    // prevClose and the pattern match both depend on it.
    loadCapturedOpen();
  });

  loadTrades();
  loadVixStatus();
  // Poll for trigger + VIX alerts every 60s while this tab is
  // open. This is the "in-platform" notification path — it only reaches
  // you if the tab's open; closed-tab alerts would need a separate
  // push-notification setup.
  setInterval(loadTrades, 60000);
  setInterval(loadVixStatus, 60000);
}

async function toggleVixAlert(){
  const enabled = document.getElementById('vixAlertToggle').checked;
  try{
    await fetch('/api/update-settings', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ vixAlertEnabled: enabled })
    });
  }catch(err){
    alert(`Could not save the toggle: ${err.message}`);
    document.getElementById('vixAlertToggle').checked = !enabled;
  }
  loadVixStatus();
}

let lastSeenVixEventCount = 0;

async function loadVixStatus(){
  try{
    const res = await fetch('/api/get-vix-status');
    const json = await res.json();
    document.getElementById('vixAlertToggle').checked = !!json.vixAlertEnabled;

    const log = json.log || {};
    const readings = log.readings || [];
    const latest = readings.length ? readings[readings.length-1].vix : null;
    const openVix = log.openVix;
    const pctChange = (latest != null && openVix) ? ((latest-openVix)/openVix*100) : null;

    const wrap = document.getElementById('vixWrap');
    if(latest == null){
      wrap.innerHTML = `<div class="snap-cell"><div class="snap-label">India VIX</div><div class="snap-val neutral">Not tracked yet — turn on below</div></div>`;
    } else {
      const dirClass = pctChange >= 0 ? 'up' : 'down';
      wrap.innerHTML = `
        <div class="snap-cell"><div class="snap-label">VIX Now</div><div class="snap-val">${latest.toFixed(2)}</div></div>
        <div class="snap-cell"><div class="snap-label">Today's Open</div><div class="snap-val neutral">${openVix!=null?openVix.toFixed(2):'—'}</div></div>
        <div class="snap-cell"><div class="snap-label">Change Since Open</div><div class="snap-val ${dirClass}">${pctChange!=null?pct(pctChange,1):'—'}</div></div>`;
    }

    const el = document.getElementById('vixStatus');
    if(!json.vixAlertEnabled){
      el.textContent = `Off — VIX isn't being checked.`;
    } else {
      const events = log.events || [];
      const fired = events.map(e => `${e.direction==='up'?'up':'down'} ${Math.abs(e.pctChange)}% (${e.openVix} → ${e.vix})`).join('; ');
      el.textContent = fired
        ? `On — today already: ${fired}.`
        : `On — watching, no ±10% move yet today.`;

      if(events.length > lastSeenVixEventCount){
        const newest = events[events.length-1];
        showAlertBanner(`⚠ India VIX moved ${newest.direction} ${Math.abs(newest.pctChange)}% from today's open (${newest.openVix} → ${newest.vix})`);
        playAlertSound();
      }
      lastSeenVixEventCount = events.length;
    }
  }catch(err){
    document.getElementById('vixStatus').textContent = `Could not load VIX status: ${err.message}`;
  }
}

async function loadOptionChain(){
  const btn = document.getElementById('btnLoadChain');
  const statusEl = document.getElementById('chainStatus');
  btn.disabled = true; btn.textContent = 'Loading…';
  try{
    const res = await fetch('/api/get-option-chain');
    const json = await res.json();
    if(!res.ok || !json.ok){
      statusEl.textContent = `Could not load option chain: ${json.error || 'unknown error'}. NSE may be blocking this request right now — try again in a bit.`;
      statusEl.style.color = 'var(--red)';
      lastOptionChain = null;
    } else {
      lastOptionChain = json;
      const wrap = document.getElementById('chainWrap');
      wrap.innerHTML = `
        <div class="snap-cell"><div class="snap-label">Spot</div><div class="snap-val">${fmt(json.spot,0)}</div></div>
        <div class="snap-cell"><div class="snap-label">ATM IV</div><div class="snap-val neutral">${json.atmIV!=null?json.atmIV.toFixed(1)+'%':'—'}</div></div>
        <div class="snap-cell"><div class="snap-label">PCR</div><div class="snap-val neutral">${json.pcr!=null?json.pcr.toFixed(2):'—'}</div></div>
        <div class="snap-cell"><div class="snap-label">Max Pain</div><div class="snap-val neutral">${fmt(json.maxPain,0)}</div></div>
        <div class="snap-cell"><div class="snap-label">Call OI Wall</div><div class="snap-val down">${fmt(json.callWall,0)}</div></div>
        <div class="snap-cell"><div class="snap-label">Put OI Wall</div><div class="snap-val up">${fmt(json.putWall,0)}</div></div>`;
      const stamp = new Date(json.asOf).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      statusEl.innerHTML = `Loaded at ${stamp}, expiry ${json.expiry}. <span style="color:var(--teal);">Will be used in "Suggest a full plan" below.</span>`;
      statusEl.style.color = '';
    }
  }catch(err){
    statusEl.textContent = `Option chain request failed: ${err.message}`;
    statusEl.style.color = 'var(--red)';
    lastOptionChain = null;
  }
  btn.disabled = false; btn.textContent = 'Load option chain';
}


function updateDateHint(){
  const d = new Date(document.getElementById('inDate').value + 'T00:00:00');
  const wd = WEEKDAYS[d.getDay()];
  const hint = document.getElementById('dateHint');
  if(wd==='Sat' || wd==='Sun'){
    hint.textContent = `${wd} — NSE is normally closed. (Special Sunday sessions do happen, e.g. Budget day — override if this is one.)`;
  } else {
    hint.textContent = `Detected weekday: ${wd}`;
  }
}

async function captureOpenNow(){
  const btn = document.getElementById('btnCaptureOpenNow');
  const statusEl = document.getElementById('capturedOpenStatus');
  btn.disabled = true; btn.textContent = 'Capturing…';
  try{
    const res = await fetch('/api/trigger-capture-open', { method: 'POST' });
    const json = await res.json();
    if(!res.ok || !json.ok){
      statusEl.textContent = `Manual capture failed: ${json.error || 'unknown error'}. Type the open in yourself instead.`;
      statusEl.style.color = 'var(--red)';
    } else {
      statusEl.style.color = '';
      // This overwrites today's stored capture (same as the docs for
      // trigger-capture-open say) — worth knowing the 9:10am scheduled
      // job will then skip, since it only runs if nothing's captured yet.
      // Fine for testing; just means today's value is whatever this
      // button grabbed, not necessarily the 9:10am one.
      //
      // Clear the field first: loadCapturedOpen() only auto-fills and
      // auto-runs when the field is empty (so it never clobbers manual
      // typing on page load) — but a deliberate click on this button is
      // an explicit request to refresh, so it should always take effect.
      document.getElementById('inOpen').value = '';
      await loadCapturedOpen();
    }
  }catch(err){
    statusEl.textContent = `Manual capture request failed: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
  btn.disabled = false; btn.textContent = 'Capture open now';
}

async function loadCapturedOpen(){
  const statusEl = document.getElementById('capturedOpenStatus');
  try{
    const res = await fetch('/api/get-captured-open');
    const json = await res.json();
    const rec = json.captured;
    if(!rec){
      statusEl.textContent = `Auto-captured open: none yet today — runs once at 9:10am IST on weekdays, or type the open in yourself.`;
      return;
    }
    const openField = document.getElementById('inOpen');
    const wasEmpty = !openField.value;
    if(wasEmpty){
      openField.value = rec.open;
    }
    const stamp = new Date(rec.capturedAt).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
    statusEl.innerHTML = `Auto-captured open: <b>${fmt(rec.open)}</b> via ${rec.source} at ${stamp}. Pre-open matching can still be settling this early — double-check against your broker before relying on it, and overwrite the field above if it looks off.`;

    // Only auto-run the analysis if we just did the fill ourselves — never
    // steamroll something you were already typing into the field. This
    // stops at "here's the suggested plan" — starting to actually track
    // one still needs your click on "Start tracking this plan."
    if(wasEmpty){
      statusEl.innerHTML += ` <span style="color:var(--teal);">Running pattern match and building a suggested plan automatically…</span>`;
      runMatch();
      await suggestLevels();
      statusEl.innerHTML = statusEl.innerHTML.replace(
        /<span style="color:var\(--teal\);">.*?<\/span>/,
        `<span style="color:var(--green);">Pattern match and suggested plan ready below — review before tracking anything.</span>`
      );
    }
  }catch(err){
    statusEl.textContent = `Could not check for an auto-captured open: ${err.message}`;
  }
}

function runMatch(){
  const open = parseFloat(document.getElementById('inOpen').value);
  let prevClose = parseFloat(document.getElementById('inPrevClose').value);
  const dateVal = document.getElementById('inDate').value;
  if(!prevClose && HIST.length){
    prevClose = HIST[HIST.length-1].c;
  }
  if(!open || !prevClose || !dateVal){
    document.getElementById('resultsWrap').innerHTML = '<div class="placeholder">Fill in the date and open (previous close auto-fills from history if left blank).</div>';
    return;
  }
  const d = new Date(dateVal+'T00:00:00');
  const wd = WEEKDAYS[d.getDay()];
  const gapPts = open - prevClose;
  const gapPct = gapPts/prevClose*100;
  const bucket = gapBucket(Math.abs(gapPct));
  const dir = gapPct >= 0 ? 'up' : 'down';

  renderSnapshot({open, prevClose, gapPts, gapPct, wd, bucket, dir});

  const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(wd);
  const wdRows = isWeekday ? HIST.filter(r=>r.wd===wd) : [];
  const gapRows = HIST.filter(r => r.gap!=null && gapBucket(Math.abs(r.gap))===bucket && (r.gap>=0)===(gapPct>=0));
  const combinedRows = isWeekday ? HIST.filter(r => r.wd===wd && r.gap!=null && gapBucket(Math.abs(r.gap))===bucket && (r.gap>=0)===(gapPct>=0)) : [];

  renderMatches({wdRows, gapRows, combinedRows, wd, bucket, dir, isWeekday, open});
  renderRangePanel({open, gapRows});

  lastMatchContext = { open, prevClose, wd, bucket, dir, isWeekday, wdRows, gapRows };
  const suggestBtn = document.getElementById('btnSuggestLevels');
  if(suggestBtn) suggestBtn.disabled = false;
}

function renderSnapshot(s){
  const dirClass = s.gapPct>=0 ? 'up' : 'down';
  document.getElementById('snapshotWrap').innerHTML = `
    <div class="snapshot">
      <div class="snap-cell"><div class="snap-label">Weekday</div><div class="snap-val neutral">${s.wd}</div></div>
      <div class="snap-cell"><div class="snap-label">Open</div><div class="snap-val">${fmt(s.open)}</div></div>
      <div class="snap-cell"><div class="snap-label">Prev Close</div><div class="snap-val">${fmt(s.prevClose)}</div></div>
      <div class="snap-cell"><div class="snap-label">Gap</div><div class="snap-val ${dirClass}">${s.gapPts>=0?'+':''}${fmt(s.gapPts)} pts</div></div>
      <div class="snap-cell"><div class="snap-label">Gap %</div><div class="snap-val ${dirClass}">${pct(s.gapPct,2)}</div></div>
      <div class="snap-cell"><div class="snap-label">Gap Bucket</div><div class="snap-val neutral">${s.bucket}</div></div>
    </div>`;
}

function barRow(name, rows, open, baseline, numComparisons){
  const s = summarize(rows);
  if(!s) return `<div class="match-row"><div class="match-head"><div class="match-name">${name}</div><div class="match-n low">n = 0</div></div><div class="hint">No historical sessions match this exact condition.</div></div>`;
  const tag = sampleTag(s.n);

  let sigHtml = '';
  if(baseline != null && numComparisons){
    const k = Math.round(s.winPct/100 * s.n);
    const pvalue = proportionPValue(k, s.n, baseline);
    const sig = significanceLabel(pvalue, numComparisons);
    const color = sig.tier==='robust' ? 'var(--green)' : sig.tier==='weak' ? 'var(--amber)' : 'var(--text-faint)';
    sigHtml = `<div class="hint" style="color:${color}; margin-top:4px;">${sig.text}</div>`;
  }

  let projection = '';
  if(open){
    // Project a close range from the avg move and its spread, and a
    // high/low band from the median day range — centered where the data
    // actually centers (avg move), not just symmetric around open.
    const closeMid = open * (1 + s.avgIntra/100);
    const halfRange = s.medRangePts/2;
    projection = `
      <div class="match-stats" style="margin-top:6px; padding-top:6px; border-top:1px dashed var(--line-soft);">
        <span>Projected close: <b>~${fmt(closeMid,0)}</b></span>
        <span>Projected High/Low band: <b>${fmt(closeMid-halfRange,0)} – ${fmt(closeMid+halfRange,0)}</b></span>
      </div>`;
  }

  return `
    <div class="match-row">
      <div class="match-head">
        <div class="match-name">${name}</div>
        <div class="match-n ${tag.cls}">n = ${s.n} (${tag.label})</div>
      </div>
      <div class="bar-track"><div class="bar-green" style="width:${s.winPct.toFixed(1)}%"></div></div>
      <div class="match-stats">
        <span>Closed above open: <b>${s.winPct.toFixed(0)}%</b></span>
        <span>Avg open→close: <b>${pct(s.avgIntra,2)}</b></span>
        <span>Avg day range: <b>${s.avgRangePts.toFixed(0)} pts</b> (${s.avgRangePct.toFixed(2)}%)</span>
      </div>
      ${sigHtml}
      ${projection}
    </div>`;
}

function computeBaselineWinRate(hist){
  const valid = hist.filter(r => r.col === 'G' || r.col === 'R');
  if(!valid.length) return null;
  return valid.filter(r => r.col==='G').length / valid.length;
}

function renderMatches({wdRows, gapRows, combinedRows, wd, bucket, dir, isWeekday, open}){
  const baseline = computeBaselineWinRate(HIST);
  let html = `<div class="grid"><div class="panel">
    <p class="panel-title">Historical Pattern Match</p>
    <p class="panel-desc">Each row is one dimension checked separately against the full sample, with a significance check against the baseline win rate (${baseline!=null?(baseline*100).toFixed(1):'?'}%) — corrected for testing several categories at once, not just a raw p-value. A projection built on n=1 or n=2, or one that doesn't survive that correction, is noise wearing a percentage sign, not a guess worth trusting.</p>`;

  if(isWeekday){
    html += barRow(`All ${wd}s`, wdRows, open, baseline, 5);
  } else {
    html += `<div class="match-row"><div class="hint">Not a Mon–Fri session by the date entered — weekday stats skipped.</div></div>`;
  }
  html += barRow(`All gap-${dir} days, ${bucket}`, gapRows, open, baseline, 4);

  if(isWeekday && combinedRows.length >= 12){
    html += barRow(`${wd} + gap-${dir} ${bucket} (combined)`, combinedRows, open, baseline, 20);
  } else if(isWeekday){
    html += `<div class="warn-inline">Combined weekday+gap slice has only ${combinedRows.length} historical matches (some cells in this dataset run as low as n=1) — too thin to project anything from on its own, folded into the two single-dimension rows above instead.</div>`;
  }

  html += `</div><div class="panel" id="rangePanel"><p class="panel-title">Expected Range &amp; Strike Context</p><p class="panel-desc">Loading…</p></div></div>`;
  document.getElementById('resultsWrap').innerHTML = html;
}

function renderRangePanel({open, gapRows}){
  const base = gapRows.length >= 20 ? gapRows : HIST;
  const usedLabel = gapRows.length >= 20 ? `gap-matched days (n=${gapRows.length})` : `full ${HIST.length}-day sample (gap slice too thin)`;
  const s = summarize(base);
  const atr14 = computeATR(HIST, 14);

  const tiers = [
    {name:'Tight', pts: s.medRangePts/2},
    {name:'Median', pts: s.medRangePts},
    {name:'Wide (75th pct)', pts: s.p75RangePts},
    {name:'Very wide (90th pct)', pts: s.p90RangePts},
  ];
  if(atr14) tiers.push({name:'ATR (14)', pts: atr14, isAtr: true});

  const rows = tiers.map(t=>{
    const half = t.pts/2;
    const callStrike = roundTo(open+half, 50);
    const putStrike = roundTo(open-half, 50);
    return `<div class="tier" ${t.isAtr ? 'style="border-color:var(--teal);"' : ''}>
      <div class="tier-name">${t.name}</div>
      <div class="tier-strikes"><span class="put">${putStrike}</span> &nbsp;–&nbsp; <span class="call">${callStrike}</span></div>
      <div class="tier-pct">±${half.toFixed(0)} pts</div>
      <button class="btn secondary track-btn" data-put="${putStrike}" data-call="${callStrike}" data-tier="${t.name}">Track</button>
    </div>`;
  }).join('');

  document.getElementById('rangePanel').innerHTML = `
    <p class="panel-title">Expected Range &amp; Strike Context</p>
    <p class="panel-desc">Based on ${usedLabel}, plus a full-history ATR(14) row for a gap-aware reference alongside the percentile-based ones. Distance from today's open where day's High/Low historically landed — use as a reference for how far OTM to sell, not as a guarantee price won't go further.</p>
    <div class="range-tiers">${rows}</div>
    <div class="hint" style="margin-top:10px;">Strikes rounded to nearest 50. Lot size assumed ${LOT_SIZE} — confirm current lot size on your broker terminal before sizing.</div>
    <div class="event-toggle">
      <input type="checkbox" id="eventFlag">
      <label for="eventFlag">Elevated event risk today (active news, VIX spike, war/rate/earnings headline)</label>
    </div>
    <div class="event-banner" id="eventBanner">
      Historical ranges above are unconditional averages — they do not know about today's news. On flagged days, consider: wider strikes than the table suggests, smaller size, and defined-risk spreads over naked positions so a single gap can't take more than your planned max loss.
    </div>`;
  document.getElementById('eventFlag').addEventListener('change', function(){
    document.getElementById('eventBanner').classList.toggle('show', this.checked);
  });
  wireTrackButtons();
}

async function saveSession(){
  const d = document.getElementById('logDate').value;
  const o = parseFloat(document.getElementById('logOpen').value);
  const h = parseFloat(document.getElementById('logHigh').value);
  const l = parseFloat(document.getElementById('logLow').value);
  const c = parseFloat(document.getElementById('logClose').value);
  const statusEl = document.getElementById('logStatus');

  if(!d || !o || !h || !l || !c){
    statusEl.textContent = 'Fill in date, open, high, low and close first.';
    statusEl.style.color = 'var(--red)';
    return;
  }
  statusEl.textContent = 'Saving…';
  statusEl.style.color = '';
  try{
    const res = await fetch('/api/log-session', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ d, o, h, l, c })
    });
    const json = await res.json();
    if(!res.ok) throw new Error(json.error || 'Save failed');
    statusEl.textContent = `Saved ${d}. History now includes it — re-run the pattern match to use it.`;
    statusEl.style.color = 'var(--green)';
    await loadHistory();
    await loadStatus();
  }catch(err){
    statusEl.textContent = `Save failed: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
}

async function triggerFetch(){
  const btn = document.getElementById('btnTriggerFetch');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  try{
    const res = await fetch('/api/trigger-update', { method:'POST' });
    const json = await res.json();
    await loadHistory();
    await loadStatus();
    if(!res.ok || !json.ok){
      alert(`Auto-fetch failed: ${json.error || 'unknown error'}. Use "Confirm Today's Close" to enter it manually instead.`);
    }
  }catch(err){
    alert(`Auto-fetch request failed: ${err.message}`);
  }
  btn.disabled = false;
  btn.textContent = 'Run auto-fetch now';
}

// ---------- Trade plan tracking (multi-level) ----------
let lastSeenHitIds = new Set(JSON.parse(sessionStorage.getItem('seenHits') || '[]'));
let levelRowCount = 0;

function markSeen(key){
  lastSeenHitIds.add(key);
  sessionStorage.setItem('seenHits', JSON.stringify([...lastSeenHitIds]));
}

function addLevelRow(prefill){
  const wrap = document.getElementById('planLevelsWrap');
  const rowId = `lvlrow_${levelRowCount++}`;
  const div = document.createElement('div');
  div.className = 'level-row';
  div.id = rowId;
  const p = prefill || {};
  div.innerHTML = `
    <select class="lvl-type">
      <option value="entry" ${p.type==='entry'?'selected':''}>Entry</option>
      <option value="target" ${p.type==='target'?'selected':''}>Target</option>
      <option value="stop" ${p.type==='stop'?'selected':''}>Stop</option>
      <option value="flip" ${p.type==='flip'?'selected':''}>Flip (bi-dir)</option>
      <option value="note" ${(!p.type||p.type==='note')?'selected':''}>Note</option>
    </select>
    <select class="lvl-dir">
      <option value="above" ${p.direction!=='below'?'selected':''}>Above</option>
      <option value="below" ${p.direction==='below'?'selected':''}>Below</option>
    </select>
    <input type="number" class="lvl-price" step="1" placeholder="Level" value="${p.price!=null?p.price:''}">
    <input type="text" class="lvl-note" placeholder="What to do (e.g. Sell 24250 CE / buy 24350 CE hedge)" value="${p.note||''}">
    <select class="lvl-depends"><option value="">No dependency</option></select>
    <button class="level-remove" title="Remove">✕</button>
  `;
  div.querySelector('.level-remove').addEventListener('click', ()=>{ div.remove(); refreshDependsOnOptions(); });
  div.querySelector('.lvl-type').addEventListener('change', refreshDependsOnOptions);
  wrap.appendChild(div);
  refreshDependsOnOptions();
  if(p._dependsOnRowIndex != null){
    // set after options exist for this new row
    const rows = [...document.querySelectorAll('.level-row')];
    const sel = div.querySelector('.lvl-depends');
    if(sel) sel.value = String(p._dependsOnRowIndex);
  }
}

function refreshDependsOnOptions(){
  const rows = [...document.querySelectorAll('.level-row')];
  rows.forEach((row, idx) => {
    const sel = row.querySelector('.lvl-depends');
    const prevValue = sel.value;
    const typeLabel = row.querySelector('.lvl-type').selectedOptions[0].textContent;
    sel.innerHTML = '<option value="">No dependency</option>' + rows
      .map((r, i) => i === idx ? null : `<option value="${i}">After Level ${i+1} (${r.querySelector('.lvl-type').selectedOptions[0].textContent})</option>`)
      .filter(Boolean).join('');
    if(prevValue && rows[Number(prevValue)]) sel.value = prevValue;
  });
}

function readLevelRows(){
  const rows = [...document.querySelectorAll('.level-row')];
  return rows.map((row) => {
    const dependsVal = row.querySelector('.lvl-depends').value;
    return {
      type: row.querySelector('.lvl-type').value,
      direction: row.querySelector('.lvl-dir').value,
      price: parseFloat(row.querySelector('.lvl-price').value),
      note: row.querySelector('.lvl-note').value.trim(),
      dependsOnIndex: dependsVal === '' ? null : Number(dependsVal),
    };
  }).filter(l => !isNaN(l.price));
}

async function loadTrades(){
  try{
    const res = await fetch('/api/list-trades');
    const json = await res.json();
    renderTrades(json.trades || []);
    checkForNewHits(json.trades || []);
  }catch(err){
    document.getElementById('tradesList').innerHTML = `<div class="tracker-empty">Could not load trades: ${err.message}</div>`;
  }
}

function renderTrades(trades){
  const el = document.getElementById('tradesList');
  const visible = trades.filter(t => t.status !== 'closed');
  if(visible.length === 0){
    el.innerHTML = '<div class="tracker-empty">Nothing tracked right now.</div>';
    return;
  }
  el.innerHTML = visible.map(t => {
    const levelItems = (t.levels||[]).map(lvl => {
      const dirWord = lvl.direction === 'above' ? 'crosses above' : 'falls below';
      const hitInfo = lvl.status === 'hit'
        ? ` — hit at ${fmt(lvl.hitPrice,2)}, ${new Date(lvl.hitAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`
        : '';
      return `<div class="level-item ${lvl.status}">
        <span class="level-check">${lvl.status==='hit'?'✅':'⬜'}</span>
        <div>
          <span class="type-chip ${lvl.type}">${lvl.type}</span>
          <span> ${dirWord} ${fmt(lvl.price,0)}${hitInfo}</span>
          ${lvl.note ? `<div class="level-note">${lvl.note}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    return `
      <div class="trade-row" style="flex-direction:column; align-items:stretch;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="trade-label">${t.label}</div>
          <button class="btn secondary" style="width:auto; padding:6px 10px; font-size:10.5px;" onclick="closeTrade('${t.id}')">Close plan</button>
        </div>
        <div class="level-checklist">${levelItems}</div>
      </div>`;
  }).join('');
}

function checkForNewHits(trades){
  for(const t of trades){
    for(const lvl of (t.levels||[])){
      if(lvl.status !== 'hit') continue;
      const key = lvl.id + '_' + lvl.hitAt;
      if(lastSeenHitIds.has(key)) continue;
      showAlertBanner(`⚠ "${t.label}" — ${lvl.type.toUpperCase()} ${lvl.direction} ${fmt(lvl.price,0)} hit at ${fmt(lvl.hitPrice,2)}${lvl.note ? ' — ' + lvl.note : ''}`);
      markSeen(key);
      playAlertSound();
      return; // one banner at a time, next poll will surface any others
    }
  }
}

function showAlertBanner(text){
  const el = document.getElementById('alertBanner');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(()=> el.classList.remove('show'), 15000);
}

function playAlertSound(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }catch(e){ /* audio not available, banner still shows */ }
}

async function createTradePlan(label, levels){
  const res = await fetch('/api/track-trade', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ label, levels })
  });
  const json = await res.json();
  if(!res.ok) throw new Error(json.error || 'Could not create plan');
  await loadTrades();
}

async function closeTrade(id){
  await fetch('/api/update-trade', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id, action:'close'}) });
  await loadTrades();
}

function wireTrackButtons(){
  document.querySelectorAll('.track-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const put = parseFloat(btn.dataset.put);
      const call = parseFloat(btn.dataset.call);
      const tier = btn.dataset.tier;
      btn.disabled = true; btn.textContent = '…';
      try{
        await createTradePlan(`${tier} strangle`, [
          { type:'target', direction:'above', price: call, note: 'Call side breached — consider booking / adjusting' },
          { type:'target', direction:'below', price: put, note: 'Put side breached — consider booking / adjusting' },
        ]);
        btn.textContent = 'Tracked ✓';
      }catch(err){
        alert(`Could not track: ${err.message}`);
        btn.disabled = false; btn.textContent = 'Track';
      }
    });
  });
}

async function savePlan(){
  const label = document.getElementById('planLabel').value.trim();
  const levels = readLevelRows();
  const statusEl = document.getElementById('planStatus');
  if(!label || levels.length === 0){
    statusEl.textContent = 'Add a label and at least one level with a price.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  // Safety check: a level already on the "wrong" side of the last known
  // price will fire the moment the next 30-min check runs, not on a real
  // future move. Compare against the last recorded close as a rough guide
  // (not live — good enough to catch an obvious mistake) and ask before
  // saving anything that looks already-triggered.
  const lastClose = HIST.length ? HIST[HIST.length-1].c : null;
  if(lastClose != null){
    const alreadyPast = levels.filter(l =>
      (l.direction==='above' && lastClose >= l.price) ||
      (l.direction==='below' && lastClose <= l.price)
    );
    if(alreadyPast.length){
      const list = alreadyPast.map(l => `${l.type} ${l.direction} ${l.price}`).join(', ');
      const proceed = confirm(`These levels are already past the last known price (${fmt(lastClose)}) and will likely alert immediately: ${list}. Save anyway?`);
      if(!proceed) return;
    }
  }

  try{
    await createTradePlan(label, levels);
    statusEl.textContent = `Tracking "${label}" — ${levels.length} level(s).`;
    statusEl.style.color = 'var(--green)';
    document.getElementById('planLabel').value = '';
    document.getElementById('planLevelsWrap').innerHTML = '';
    seedDefaultLevels();
  }catch(err){
    statusEl.textContent = `Could not save: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
}

function seedDefaultLevels(){
  addLevelRow({type:'entry', direction:'above', price:'', note:''});
  addLevelRow({type:'target', direction:'above', price:'', note:''});
  addLevelRow({type:'stop', direction:'below', price:'', note:''});
}

// ---------- Suggest a full plan ----------
// Standard floor pivots off the previous session's H/L/C, in the same
// bullish-entry / profit-booking / rejection-flip / stop sequence worked
// through in the 15-Jul retrospective — with the notes pulling real numbers
// from the pattern match above (sample size and all), not invented ones.
async function suggestLevels(){
  if(!lastMatchContext){
    alert('Run a pattern match above first — the plan uses its numbers.');
    return;
  }
  const prevRow = HIST[HIST.length-1];
  if(!prevRow){ alert('No history loaded yet.'); return; }

  const btn = document.getElementById('btnSuggestLevels');
  btn.disabled = true; btn.textContent = 'Building…';

  const { open, wd, wdRows, gapRows, bucket, dir, isWeekday } = lastMatchContext;
  const P = (prevRow.h + prevRow.l + prevRow.c) / 3;
  const R1 = roundTo(2*P - prevRow.l, 1);
  const R2 = roundTo(P + (prevRow.h - prevRow.l), 1);
  const S1 = roundTo(2*P - prevRow.h, 1);
  const S2 = roundTo(P - (prevRow.h - prevRow.l), 1);
  const pivot = roundTo(P, 1);
  const prevHigh = prevRow.h;
  const prevLow = prevRow.l;

  // --- Gather every signal the app has ---
  const wdStats = isWeekday ? summarize(wdRows) : null;
  const gapStats = summarize(gapRows);
  const atr14 = computeATR(HIST, 14);
  const streaks = computeStreaks(HIST);
  const entryToStop = R1 - pivot;

  let vixInfo = null;
  try{
    const res = await fetch('/api/get-vix-status');
    const json = await res.json();
    if(json.vixAlertEnabled && json.log && json.log.readings && json.log.readings.length){
      const latest = json.log.readings[json.log.readings.length-1].vix;
      const openVix = json.log.openVix;
      vixInfo = { latest, openVix, pctChange: openVix ? ((latest-openVix)/openVix*100) : null };
    }
  }catch(e){ /* VIX context is optional, plan still works without it */ }

  // --- Build the notes using real numbers, not invented ones ---
  const baseline = computeBaselineWinRate(HIST);
  const wdSig = wdStats && baseline!=null ? significanceLabel(proportionPValue(Math.round(wdStats.winPct/100*wdStats.n), wdStats.n, baseline), 5) : null;
  const gapSig = gapStats && baseline!=null ? significanceLabel(proportionPValue(Math.round(gapStats.winPct/100*gapStats.n), gapStats.n, baseline), 4) : null;
  const wdNote = wdStats
    ? `${wdStats.n} ${wd}s in sample closed above open ${wdStats.winPct.toFixed(0)}% of the time, avg move ${pct(wdStats.avgIntra,2)} (${sampleTag(wdStats.n).label}). ${wdSig ? wdSig.text : ''}`
    : 'No weekday sample available for this date.';
  const gapNote = gapStats
    ? `${gapStats.n} historical gap-${dir} days in the ${bucket} bucket closed above open ${gapStats.winPct.toFixed(0)}% of the time, avg move ${pct(gapStats.avgIntra,2)} (${sampleTag(gapStats.n).label}). ${gapSig ? gapSig.text : ''}`
    : 'No gap-bucket sample available.';
  const streakNote = streaks.currentLen
    ? `Currently on a ${streaks.currentLen}-day ${streaks.currentDir} streak (close vs prior close). Historical max in this sample: ${streaks.maxUp}-day up, ${streaks.maxDown}-day down — not a reason to expect reversal or continuation on its own, just where today sits in that context.`
    : 'No current streak data.';
  const atrNote = atr14
    ? `ATR(14) is ${atr14.toFixed(0)} pts. Entry-to-stop distance here is ${Math.abs(entryToStop).toFixed(0)} pts (${(Math.abs(entryToStop)/atr14*100).toFixed(0)}% of ATR)${Math.abs(entryToStop) < atr14*0.3 ? " — tight relative to a typical day's range, a normal-volatility session could round-trip through entry and stop without any real directional move" : ''}.`
    : 'ATR(14) not available yet (needs 14+ days of history).';
  const vixNote = vixInfo
    ? `India VIX currently ${vixInfo.latest.toFixed(2)}, ${vixInfo.pctChange>=0?'+':''}${vixInfo.pctChange.toFixed(1)}% since today's open.`
    : 'VIX intraday tracking is off (or no reading yet) — turn it on in the India VIX panel above for live context here.';

  let chainNote = 'Option chain not loaded — click "Load option chain" above for IV, PCR, Max Pain and OI-wall context here.';
  if(lastOptionChain){
    const oc = lastOptionChain;
    const parts = [];
    if(oc.atmIV != null && atr14){
      const annualizedRV = (atr14/open) * Math.sqrt(252) * 100;
      const spread = oc.atmIV - annualizedRV;
      parts.push(`ATM IV ${oc.atmIV.toFixed(1)}% vs ATR(14)-based annualized realized vol ${annualizedRV.toFixed(1)}% — spread of ${spread>=0?'+':''}${spread.toFixed(1)} points (${spread>0?'IV running above recent realized vol, the traditional condition favoring premium selling':'IV running below recent realized vol, premium may not be compensating for actual movement'}). Single-day snapshot, not a backtested signal — no historical IV percentile exists yet to know if this spread itself is wide or narrow for this market.`);
    }
    if(oc.pcr != null) parts.push(`PCR ${oc.pcr.toFixed(2)} (>1.2 typically read as put-heavy/bullish positioning, <0.7 call-heavy/bearish — descriptive only, not validated on this dataset).`);
    if(oc.callWall != null) parts.push(`Call OI wall at ${fmt(oc.callWall,0)} (${(oc.callWall-R2)>=0?'+':''}${(oc.callWall-R2).toFixed(0)} pts vs this plan's R2 target ${fmt(R2,0)}).`);
    if(oc.putWall != null) parts.push(`Put OI wall at ${fmt(oc.putWall,0)} (${(oc.putWall-S1)>=0?'+':''}${(oc.putWall-S1).toFixed(0)} pts vs this plan's S1 target ${fmt(S1,0)}).`);
    if(oc.maxPain != null) parts.push(`Max Pain ${fmt(oc.maxPain,0)}.`);
    chainNote = parts.join(' ');
  }

  document.getElementById('planLabel').value = `${wd} plan — ${document.getElementById('inDate').value}`;

  document.getElementById('planContext').innerHTML = `
    <div class="plan-context">
      <div class="plan-context-title">Plan Context — every signal this plan is built from</div>
      <div class="plan-context-row"><span>Weekday (${wd})</span><b>${wdNote}</b></div>
      <div class="plan-context-row"><span>Gap (${dir}, ${bucket})</span><b>${gapNote}</b></div>
      <div class="plan-context-row"><span>Streak</span><b>${streakNote}</b></div>
      <div class="plan-context-row"><span>ATR check</span><b class="${Math.abs(entryToStop) < (atr14||0)*0.3 ? 'plan-context-flag' : ''}">${atrNote}</b></div>
      <div class="plan-context-row"><span>VIX</span><b>${vixNote}</b></div>
      <div class="plan-context-row"><span>Option chain</span><b>${chainNote}</b></div>
    </div>`;

  document.getElementById('planLevelsWrap').innerHTML = '';

  // 0: Entry — confirmed break of R1
  addLevelRow({type:'entry', direction:'above', price:R1,
    note:`Break + hold above R1 pivot resistance. ${wdNote} ${gapNote}`});
  // 1: Target 1 — previous session high
  addLevelRow({type:'target', direction:'above', price:roundTo(prevHigh,1),
    note:`Previous session high — consider booking 25-40%.`});
  // 2: Target 2 — R2 pivot resistance
  addLevelRow({type:'target', direction:'above', price:R2,
    note:`R2 pivot resistance — consider booking most of the remaining bullish position here.`});
  // 3: Stop — loses central pivot
  addLevelRow({type:'stop', direction:'below', price:pivot,
    note:`Falls back below the central pivot — bullish setup invalidated, exit the bullish leg. ${atrNote}`});
  // 4: Flip — depends on Target 2 (index 2) being hit first, mirrors "only flip after rejection"
  addLevelRow({type:'flip', direction:'below', price:R1, _dependsOnRowIndex:2,
    note:`Only checked after R2 is reached — rejection back below R1 after testing R2 is the bearish-flip trigger. Consider selling a call spread here. ${vixInfo ? vixNote : ''}`});
  // 5: Bearish target — S1
  addLevelRow({type:'target', direction:'below', price:S1, _dependsOnRowIndex:4,
    note:`S1 pivot support — bearish-flip target, checked only after the flip level above is hit.`});

  document.getElementById('planStatus').textContent =
    `Suggested from ${wd} pivots (P ${fmt(pivot,0)} · R1 ${fmt(R1,0)} · R2 ${fmt(R2,0)} · S1 ${fmt(S1,0)} · S2 ${fmt(S2,0)}), weighted with gap/streak/ATR/VIX context above — review every level and note before saving.`;
  document.getElementById('planStatus').style.color = 'var(--teal)';

  btn.disabled = false; btn.textContent = 'Suggest a full plan';
}

init();
