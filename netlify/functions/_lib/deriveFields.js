// Shared math used by both the manual-entry endpoint and the scheduled
// auto-update function, so a manually logged day and an auto-fetched day
// always carry identical derived fields.

function weekdayShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function deriveFields({ d, o, h, l, c }, prevClose, source) {
  const gap = prevClose != null ? ((o - prevClose) / prevClose) * 100 : null;
  const intra = ((c - o) / o) * 100;
  const rangePts = h - l;
  const rangePct = (rangePts / o) * 100;
  const col = c >= o ? 'G' : 'R';
  return {
    d,
    wd: weekdayShort(d),
    o: Number(o),
    h: Number(h),
    l: Number(l),
    c: Number(c),
    pc: prevClose != null ? Number(prevClose) : null,
    gap: gap != null ? Number(gap.toFixed(3)) : null,
    intra: Number(intra.toFixed(3)),
    rangePts: Number(rangePts.toFixed(2)),
    rangePct: Number(rangePct.toFixed(3)),
    col,
    source, // 'seed' | 'manual' | 'auto'
  };
}

module.exports = { deriveFields, weekdayShort };
