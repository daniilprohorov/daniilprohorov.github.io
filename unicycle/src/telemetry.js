export class Telemetry {
  constructor(logEndpoint = null) {
    this.logEndpoint = logEndpoint;
    this.log = []; // samples of the whole session; `run` column separates attempts
    this.sent = 0;
  }

  /** Begin streaming at game start, preserving the session's timestamp and cursor reset. */
  startSession() {
    if (!this.logEndpoint) return;
    this.sent = 0;
    this.session = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  record(s, input, run, levelIndex) {
    this.log.push({
      run,
      t: +s.t.toFixed(4), input, x: +s.x.toFixed(4), v: +s.v.toFixed(4), acc: +s.acc.toFixed(3),
      y: +s.y.toFixed(4), vy: +s.vy.toFixed(4), wheelOmega: +s.wheelOmega.toFixed(4),
      airborne: s.airborne ? 1 : 0, charge: +s.charge.toFixed(4), level: levelIndex,
      thetaDeg: +(s.theta * 180 / Math.PI).toFixed(3), omega: +s.omega.toFixed(4),
      alpha: +s.alpha.toFixed(3), tau: +s.tau.toFixed(2),
      torsoThetaDeg: +(s.torsoTheta * 180 / Math.PI).toFixed(3),
      torsoOmega: +s.torsoOmega.toFixed(4), torsoAlpha: +s.torsoAlpha.toFixed(3),
      hipAngleDeg: +((s.torsoTheta - s.theta) * 180 / Math.PI).toFixed(3),
      hipOmega: +(s.torsoOmega - s.omega).toFixed(4), hipTau: +s.hipTau.toFixed(2),
    });
  }

  /** CSV of the whole session (all attempts). */
  exportLog() {
    return toCsv(this.log, true);
  }

  /** Send rows recorded since the last flush (appended server-side). */
  flushLog(beacon = false) {
    if (!this.logEndpoint || this.sent === this.log.length) return;
    const body = toCsv(this.log.slice(this.sent), this.sent === 0) + '\n';
    this.sent = this.log.length;
    const url = `${this.logEndpoint}?session=${this.session}`;
    if (beacon) navigator.sendBeacon(url, body);
    else fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  }

  downloadLog() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.exportLog()], { type: 'text/csv' }));
    a.download = `unicycle-session-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

const LOG_COLS = ['run', 't', 'input', 'x', 'v', 'acc', 'thetaDeg', 'omega', 'alpha', 'tau', 'torsoThetaDeg', 'torsoOmega', 'torsoAlpha', 'hipAngleDeg', 'hipOmega', 'hipTau', 'y', 'vy', 'wheelOmega', 'airborne', 'charge', 'level'];
function toCsv(rows, header) {
  const lines = rows.map((r) => LOG_COLS.map((c) => r[c]).join(','));
  return (header ? [LOG_COLS.join(','), ...lines] : lines).join('\n');
}
