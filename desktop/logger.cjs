const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = path.join(os.tmpdir(), 'openfs-logs');
const LOG_FILE = path.join(LOG_DIR, 'openfs.log');
const MAX_RING_ENTRIES = 150;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

const ringBuffer = [];

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    process.stderr.write(`[OpenFS] Impossible de créer le dossier de logs : ${err.message}\n`);
  }
}

function appendLine(level, scope, message, detail) {
  const timestamp = new Date().toISOString();
  const detailStr =
    detail instanceof Error
      ? detail.message
      : detail !== undefined && detail !== null
        ? typeof detail === 'string'
          ? detail
          : JSON.stringify(detail)
        : '';

  const entry = {
    timestamp,
    level,
    scope: String(scope || 'core'),
    message: String(message || ''),
    detail: detailStr || undefined,
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_RING_ENTRIES) {
    ringBuffer.shift();
  }

  const line = `[${timestamp}] [${level.toUpperCase()}] [${entry.scope}] ${entry.message}${
    detailStr ? ` | ${detailStr}` : ''
  }\n`;

  try {
    ensureLogDir();
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const rotated = path.join(LOG_DIR, 'openfs.prev.log');
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(LOG_FILE, rotated);
    }
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    process.stderr.write(`[OpenFS] Erreur d'écriture de log : ${err.message}\n`);
  }

  return entry;
}

function logInfo(scope, message, detail) {
  return appendLine('info', scope, message, detail);
}

function logWarn(scope, message, detail) {
  return appendLine('warn', scope, message, detail);
}

function logError(scope, message, detail) {
  return appendLine('error', scope, message, detail);
}

function getRecentLogs() {
  return [...ringBuffer];
}

function getLogFilePath() {
  ensureLogDir();
  return LOG_FILE;
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  getRecentLogs,
  getLogFilePath,
};
