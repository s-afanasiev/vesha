const express = require('express');
const {
  probePandoc,
  processWithLlm,
  htmlToMarkdown,
  exportMarkdown,
} = require('../services/notesExport');
const config = require('../config');
const { runGuarded } = require('../services/llmGuard');

const router = express.Router();

function asciiFilename(name) {
  return String(name || 'conspect').replace(/[^\w.\-]+/g, '_') || 'conspect';
}

function contentDisposition(filename) {
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encoded}`;
}

router.get('/status', async (_req, res, next) => {
  try {
    const pandoc = await probePandoc();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      pandoc: {
        ok: pandoc.ok,
        version: pandoc.version || null,
        error: pandoc.error || null,
      },
      mock: Boolean(config.notesExportMock),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/llm', async (req, res, next) => {
  req.setTimeout(config.notesExportLlmTimeoutMs + 30 * 1000);
  res.setTimeout(config.notesExportLlmTimeoutMs + 30 * 1000);
  try {
    const { result, quota } = await runGuarded(req, async (quotaState) => {
      const llmResult = await processWithLlm({
        text: req.body && req.body.text,
        mode: req.body && req.body.mode,
        llm: req.body && req.body.llm,
      });
      return { result: llmResult, quota: quotaState };
    });
    res.setHeader('X-RateLimit-Limit', String(quota.limit));
    res.setHeader('X-RateLimit-Remaining', String(quota.remaining));
    res.json(result);
  } catch (err) {
    if (err.retryAfterSec) res.setHeader('Retry-After', String(err.retryAfterSec));
    next(err);
  }
});

router.post('/to-markdown', async (req, res, next) => {
  req.setTimeout(config.notesExportTimeoutMs + 15 * 1000);
  res.setTimeout(config.notesExportTimeoutMs + 15 * 1000);
  try {
    const markdown = await htmlToMarkdown(req.body && req.body.html);
    res.json({ markdown });
  } catch (err) {
    next(err);
  }
});

router.post('/export', async (req, res, next) => {
  req.setTimeout(config.notesExportTimeoutMs + 30 * 1000);
  res.setTimeout(config.notesExportTimeoutMs + 30 * 1000);
  try {
    const result = await exportMarkdown({
      markdown: req.body && req.body.markdown,
      format: req.body && req.body.format,
      title: req.body && req.body.title,
    });
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.setHeader('X-Notes-Export-Filename', encodeURIComponent(result.filename));
    res.send(result.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
