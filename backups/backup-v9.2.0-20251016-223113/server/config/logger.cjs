/**
 * Lightweight logger with level support; mirrors existing log() behavior
 * but allows central control.
 *
 * Levels: error, warn, info, debug
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const levelName = (process.env.SN2N_LOG_LEVEL || 'info').toLowerCase();
const current = LEVELS[levelName] ?? LEVELS.info;

function fmt(args) {
  // Keep original console behavior while adding timestamp + tag
  const ts = new Date().toISOString();
  return [`${ts} [SN2N]`, ...args];
}

module.exports = {
  error: (...args) => { if (current >= LEVELS.error) console.error(...fmt(args)); },
  warn:  (...args) => { if (current >= LEVELS.warn)  console.warn(...fmt(args)); },
  info:  (...args) => { if (current >= LEVELS.info)  console.log(...fmt(args)); },
  debug: (...args) => { if (current >= LEVELS.debug) console.log(...fmt(args)); },
  log:   (...args) => console.log(...fmt(args)), // compatibility
};
