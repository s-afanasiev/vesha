const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function existingParent(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return PROJECT_ROOT;
    current = parent;
  }
  return current;
}

function getStorageInfo(targetDir) {
  const target = existingParent(targetDir);
  try {
    const stat = fs.statfsSync(target);
    const blockSize = Number(stat.bsize);
    const totalBytes = blockSize * Number(stat.blocks);
    const freeBytes = blockSize * Number(stat.bavail ?? stat.bfree);
    return {
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      root: serverPath(targetDir),
    };
  } catch (err) {
    return {
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
      root: serverPath(targetDir),
      error: err.message,
    };
  }
}

function serverPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, path.resolve(filePath));
  return relative.split(path.sep).join('/');
}

module.exports = {
  getStorageInfo,
  serverPath,
};
