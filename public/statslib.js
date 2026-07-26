// Statistics module, separate from app.js since it's substantial and
// self-contained. Everything here computes from data already in HIST,
// nothing needs a new data source. Loaded before app.js.

// ---------- shared special functions (log-gamma already exists in
// app.js for the binomial test, duplicated here so this file has no
// load-order dependency on app.js) ----------
function _logGamma(x){
  const g = 7;
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if(x < 0.5) return Math.log(Math.PI/Math.sin(Math.PI*x)) - _logGamma(1-x);
  x -= 1;
  let a = c[0];
  const t = x+7+0.5;
  for(let i=1;i<9;i++) a += c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI) + (x+0.5)*Math.log(t) - t + Math.log(a);
}

// Regularized incomplete beta function I_x(a,b), via the continued
// fraction method (Numerical Recipes ch. 6.4). Needed for the Beta
// distribution's CDF, which is what a Beta-Binomial credible interval
// is built from.
function _betacf(x, a, b){
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  const qab = a+b, qap = a+1, qam = a-1;
  let c = 1, d = 1 - qab*x/qap;
  if(Math.abs(d) < FPMIN) d = FPMIN;
  d = 1/d;
  let h = d;
  for(let m=1; m<=MAXIT; m++){
    const m2 = 2*m;
    let aa = m*(b-m)*x/((qam+m2)*(a+m2));
    d = 1 + aa*d; if(Math.abs(d)<FPMIN) d=FPMIN;
    c = 1 + aa/c; if(Math.abs(c)<FPMIN) c=FPMIN;
    d = 1/d;
    h *= d*c;
    aa = -(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d = 1 + aa*d; if(Math.abs(d)<FPMIN) d=FPMIN;
    c = 1 + aa/c; if(Math.abs(c)<FPMIN) c=FPMIN;
    d = 1/d;
    const del = d*c;
    h *= del;
    if(Math.abs(del-1) < EPS) break;
  }
  return h;
}

function betaCDF(x, a, b){
  if(x <= 0) return 0;
  if(x >= 1) return 1;
  const logBt = -_logGamma(a) - _logGamma(b) + _logGamma(a+b) + a*Math.log(x) + b*Math.log(1-x);
  const bt = Math.exp(logBt);
  if(x < (a+1)/(a+b+2)) return bt*_betacf(x,a,b)/a;
  return 1 - bt*_betacf(1-x,b,a)/b;
}

// Inverts betaCDF via bisection, slower than Newton-Raphson but always
// converges given a monotonic CDF, preferred here for robustness in a
// financial tool over raw speed.
function betaQuantile(p, a, b){
  let lo = 0, hi = 1;
  for(let i=0;i<100;i++){
    const mid = (lo+hi)/2;
    if(betaCDF(mid,a,b) < p) lo = mid; else hi = mid;
  }
  return (lo+hi)/2;
}

// ---------- Bayesian Beta-Binomial credible interval ----------
// With a weak/uninformative Beta(1,1) prior (uniform), posterior is
// Beta(1+k, 1+n-k). Gives a full distribution on the hit rate rather
// than a single point estimate plus a pass/fail p-value, and handles
// small n more gracefully than a normal-approximation interval would.
function betaBinomialCredibleInterval(k, n, priorA, priorB, credMass){
  priorA = priorA == null ? 1 : priorA;
  priorB = priorB == null ? 1 : priorB;
  credMass = credMass == null ? 0.95 : credMass;
  const a = priorA + k, b = priorB + (n-k);
  const alphaTail = (1-credMass)/2;
  return {
    posteriorMean: a/(a+b),
    lower: betaQuantile(alphaTail, a, b),
    upper: betaQuantile(1-alphaTail, a, b),
    a, b,
  };
}

// ---------- Bootstrap resampling ----------
// Assumption-free confidence band: resample the actual observations with
// replacement many times, look at the spread of the resulting statistic.
// Cross-check against the Beta-Binomial and exact-binomial intervals,
// agreement across all three is a much stronger signal than any one alone.
function bootstrapWinRateCI(rows, resamples, confidence){
  resamples = resamples || 2000;
  confidence = confidence == null ? 0.95 : confidence;
  const n = rows.length;
  if(n === 0) return null;
  const wins = rows.map(r => r.col === 'G' ? 1 : 0);
  const stats = [];
  for(let i=0;i<resamples;i++){
    let sum = 0;
    for(let j=0;j<n;j++) sum += wins[Math.floor(Math.random()*n)];
    stats.push(sum/n);
  }
  stats.sort((a,b) => a-b);
  const lo = stats[Math.floor((1-confidence)/2*resamples)];
  const hi = stats[Math.floor((1-(1-confidence)/2)*resamples)];
  return { lower: lo, upper: hi, resamples };
}

// ---------- Autocorrelation function ----------
// Objective read on whether the series is trending or mean-reverting
// right now: positive ACF at lag k means today's move tends to repeat,
// negative means it tends to reverse.
function acf(series, maxLag){
  const n = series.length;
  const mean = series.reduce((a,b)=>a+b,0)/n;
  const c0 = series.reduce((a,x)=>a+(x-mean)*(x-mean),0)/n;
  const out = [];
  for(let lag=1; lag<=maxLag; lag++){
    let cov = 0;
    for(let t=0; t<n-lag; t++) cov += (series[t]-mean)*(series[t+lag]-mean);
    cov /= n;
    out.push({ lag, r: c0 === 0 ? 0 : cov/c0 });
  }
  return out;
}

// ---------- EWMA volatility (RiskMetrics-style) ----------
// Adaptive forward vol estimate: today's estimate blends yesterday's
// estimate with today's squared return, weighted by lambda. Simpler and
// more robust at this sample size than fitting GARCH(1,1), which needs
// numerical MLE and generally wants 500+ observations to be stable.
function ewmaVolatility(returns, lambda){
  lambda = lambda == null ? 0.94 : lambda;
  if(returns.length === 0) return null;
  let variance = returns[0]*returns[0];
  for(let i=1;i<returns.length;i++){
    variance = lambda*variance + (1-lambda)*returns[i]*returns[i];
  }
  const dailyVol = Math.sqrt(variance);
  return { dailyVolPct: dailyVol, annualizedPct: dailyVol*Math.sqrt(252) };
}

// ---------- Half-life of mean reversion (OU-style) ----------
// Fits range(t) - range(t-1) = theta*(mean - range(t-1)) + noise via
// simple OLS, then half-life = ln(2)/theta. Answers "how many sessions
// does an extreme range day typically take to normalize."
function halfLifeMeanReversion(series){
  const n = series.length;
  if(n < 10) return null;
  const mean = series.reduce((a,b)=>a+b,0)/n;
  const x = series.slice(0,-1).map(v => v-mean);
  const y = [];
  for(let i=1;i<n;i++) y.push(series[i]-series[i-1]);
  const xMean = x.reduce((a,b)=>a+b,0)/x.length;
  const yMean = y.reduce((a,b)=>a+b,0)/y.length;
  let num=0, den=0;
  for(let i=0;i<x.length;i++){ num += (x[i]-xMean)*(y[i]-yMean); den += (x[i]-xMean)*(x[i]-xMean); }
  const theta = den === 0 ? 0 : -(num/den);
  if(theta <= 0) return { theta, halfLifeDays: null }; // no mean reversion detected
  return { theta, halfLifeDays: Math.log(2)/theta };
}

// ---------- Markov transition matrices ----------
// Order-1: given today's direction, empirical P(tomorrow up). Order-2:
// given the last 2 days, empirical P(tomorrow up). Order-3 deliberately
// not built, 245 days split across 27 three-day states averages ~9
// observations per state, worse than any weekday-effect underpowering
// already documented, it would show "insufficient sample" everywhere.
function markovTransitionMatrix(directions, order){
  const counts = new Map(); // state -> {up: n, down: n}
  for(let i=order; i<directions.length; i++){
    const state = directions.slice(i-order, i).join('');
    const next = directions[i];
    if(next !== 'U' && next !== 'D') continue;
    if(!counts.has(state)) counts.set(state, {up:0, down:0});
    const c = counts.get(state);
    if(next === 'U') c.up++; else c.down++;
  }
  const result = [];
  for(const [state, c] of counts){
    const n = c.up + c.down;
    result.push({ state, n, pUp: n ? c.up/n : null });
  }
  result.sort((a,b) => a.state.localeCompare(b.state));
  return result;
}

// ---------- Z-score outlier flagging ----------
// Flags sessions where range or gap sits more than `threshold` standard
// deviations from the rolling mean, for separating extreme days from
// "normal" pattern stats rather than letting them silently distort the
// win-rate math. Flags, does not remove, removing data is a survivorship
// risk this project explicitly checked for and rejected.
function zScoreOutliers(rows, field, threshold){
  threshold = threshold == null ? 2.5 : threshold;
  const values = rows.map(r => r[field]).filter(v => v != null);
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  const sd = Math.sqrt(values.reduce((a,v)=>a+(v-mean)*(v-mean),0)/values.length);
  return rows.map(r => {
    const v = r[field];
    const z = (v != null && sd > 0) ? (v-mean)/sd : 0;
    return { ...r, zScore: z, isOutlier: Math.abs(z) > threshold };
  });
}

// ---------- Level-touch histogram (support/resistance) ----------
// Frequency histogram of price levels touched by High or Low, binned,
// deliberately not k-means clustering, per the project's own "no
// black-box scoring" constraint, a histogram is fully auditable, you can
// see exactly why a level is flagged.
function levelTouchHistogram(rows, binSize){
  binSize = binSize || 50;
  const bins = new Map();
  for(const r of rows){
    const hBin = Math.round(r.h/binSize)*binSize;
    const lBin = Math.round(r.l/binSize)*binSize;
    bins.set(hBin, (bins.get(hBin)||0)+1);
    bins.set(lBin, (bins.get(lBin)||0)+1);
  }
  return [...bins.entries()]
    .map(([level, touches]) => ({level, touches}))
    .sort((a,b) => b.touches - a.touches);
}
