const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LOT_SIZE = 65; // NSE Nifty lot size, verify on your terminal — this changes periodically
let HIST = [];

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

async function loadHistory(){
  const res = await fetch('/api/get-history');
  const json = await res.json();
  HIST = json.rows || [];
  document.getElementById('sampleBadge').innerHTML = `Sample base: <b>${HIST.length}</b> trading days · ${HIST[0]?.d} → ${HIST[HIST.length-1]?.d}`;
  renderHistoryTable();
  return json;
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

function init(){
  const today = new Date();
  document.getElementById('inDate').valueAsDate = today;
  document.getElementById('logDate').valueAsDate = today;
  updateDateHint();
  document.getElementById('inDate').addEventListener('change', updateDateHint);
  document.getElementById('btnCalc').addEventListener('click', runMatch);
  document.getElementById('btnLogSave').addEventListener('click', saveSession);
  document.getElementById('btnTriggerFetch').addEventListener('click', triggerFetch);

  loadHistory().then(()=>{
    const last = HIST[HIST.length-1];
    if(last) document.getElementById('inPrevClose').placeholder = `last on file: ${last.c} (${last.d})`;
    loadStatus();
  });
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

  renderMatches({wdRows, gapRows, combinedRows, wd, bucket, dir, isWeekday});
  renderRangePanel({open, gapRows});
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

function barRow(name, rows){
  const s = summarize(rows);
  if(!s) return `<div class="match-row"><div class="match-head"><div class="match-name">${name}</div><div class="match-n low">n = 0</div></div><div class="hint">No historical sessions match this exact condition.</div></div>`;
  const tag = sampleTag(s.n);
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
    </div>`;
}

function renderMatches({wdRows, gapRows, combinedRows, wd, bucket, dir, isWeekday}){
  let html = `<div class="grid"><div class="panel">
    <p class="panel-title">Historical Pattern Match</p>
    <p class="panel-desc">Each row is one dimension checked separately against the full sample. They're shown apart on purpose — combining weekday + gap size shrinks the sample fast and starts fitting noise, not signal.</p>`;

  if(isWeekday){
    html += barRow(`All ${wd}s`, wdRows);
  } else {
    html += `<div class="match-row"><div class="hint">Not a Mon–Fri session by the date entered — weekday stats skipped.</div></div>`;
  }
  html += barRow(`All gap-${dir} days, ${bucket}`, gapRows);

  if(isWeekday && combinedRows.length >= 12){
    html += barRow(`${wd} + gap-${dir} ${bucket} (combined)`, combinedRows);
  } else if(isWeekday){
    html += `<div class="warn-inline">Combined weekday+gap slice has only ${combinedRows.length} historical matches — too thin to show separately, folded into the two rows above instead.</div>`;
  }

  html += `</div><div class="panel" id="rangePanel"><p class="panel-title">Expected Range &amp; Strike Context</p><p class="panel-desc">Loading…</p></div></div>`;
  document.getElementById('resultsWrap').innerHTML = html;
}

function renderRangePanel({open, gapRows}){
  const base = gapRows.length >= 20 ? gapRows : HIST;
  const usedLabel = gapRows.length >= 20 ? `gap-matched days (n=${gapRows.length})` : `full ${HIST.length}-day sample (gap slice too thin)`;
  const s = summarize(base);

  const tiers = [
    {name:'Tight', pts: s.medRangePts/2},
    {name:'Median', pts: s.medRangePts},
    {name:'Wide (75th pct)', pts: s.p75RangePts},
    {name:'Very wide (90th pct)', pts: s.p90RangePts},
  ];

  const rows = tiers.map(t=>{
    const half = t.pts/2;
    const callStrike = roundTo(open+half, 50);
    const putStrike = roundTo(open-half, 50);
    return `<div class="tier">
      <div class="tier-name">${t.name}</div>
      <div class="tier-strikes"><span class="put">${putStrike}</span> &nbsp;–&nbsp; <span class="call">${callStrike}</span></div>
      <div class="tier-pct">±${half.toFixed(0)} pts</div>
    </div>`;
  }).join('');

  document.getElementById('rangePanel').innerHTML = `
    <p class="panel-title">Expected Range &amp; Strike Context</p>
    <p class="panel-desc">Based on ${usedLabel}. Distance from today's open where day's High/Low historically landed — use as a reference for how far OTM to sell, not as a guarantee price won't go further.</p>
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

init();
