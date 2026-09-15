import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '../components/TopBar.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';
import Dropzone from '../components/Dropzone.jsx';
import Card from '../components/Card.jsx';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { hasAnyKey, providerKeysOf } from '../providers.js';

let uidCounter = 0;

// Images sent per /generate request. Gemini is billed/limited per request, not
// per image, so batching multiplies the free-tier quota (~1000 req/day ≈
// ~6000 images/day). Keep in sync with server GEMINI_BATCH_SIZE (default 6).
const BATCH_SIZE = 6;

// Classify which rasterization path a file takes.
function classifyFile(file) {
  const n = file.name.toLowerCase();
  if (/\.ai$/.test(n)) return 'ai';
  if (/\.eps$/.test(n)) return 'eps';
  if (/^image\/svg\+xml$/.test(file.type) || /\.svg$/.test(n)) return 'svg';
  return 'raster';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// Browsers can rasterize SVGs onto a canvas, so we convert to PNG (Gemini
// needs a raster format). AI/EPS cannot be rendered client-side.
async function svgToPng(file, maxDim = 1280) {
  const img = await loadImage(file);
  let { width, height } = img;
  if (!width || !height) { width = 800; height = 800; }
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  return { base64, mimeType: 'image/png' };
}

function resizeToBase64(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Build the payload Gemini needs for a given file kind.
async function toAnalyzePayload(file, kind, maxDim = 1280) {
  if (kind === 'svg') return svgToPng(file, maxDim);
  if (kind === 'ai' || kind === 'eps') {
    throw new Error('AI/EPS files can\u2019t be converted in the browser. Export as SVG, PNG or JPEG first.');
  }
  return { base64: await resizeToBase64(file, maxDim), mimeType: 'image/jpeg' };
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({
    provider: 'gemini', model: 'gemini-2.5-flash', assetType: 'photo', kwCount: 45, titleMin: 10, titleMax: 16, concurrency: 3,
  });
  const [generating, setGenerating] = useState(false);
  // Live per-key usage + which key is serving requests right now, refreshed from
  // the server (polled while generating, one-shot otherwise).
  const [keyStats, setKeyStats] = useState({});
  const [statsMeta, setStatsMeta] = useState({ secondsUntilReset: 0 });
  const [lastUsedKey, setLastUsedKey] = useState(null);

  const doneCount = useMemo(() => items.filter((i) => i.status === 'done').length, [items]);
  const errorCount = useMemo(() => items.filter((i) => i.status === 'error').length, [items]);

  const refreshKeyStats = useCallback(async () => {
    try {
      const res = await api.keyStats(settings.model);
      setKeyStats(res.apiKeys || {});
      setStatsMeta({ secondsUntilReset: res.secondsUntilReset || 0, dayKey: res.dayKey });
    } catch {
      // a failed poll just leaves the last known numbers on screen
    }
  }, [settings.model]);

  // One-shot on mount / whenever the saved keys change (add, remove, replace).
  useEffect(() => {
    refreshKeyStats();
  }, [refreshKeyStats, user?.apiKeys]);

  // While generating, poll so the key that is currently in use blinks and its
  // usage bar moves without waiting for the whole run to finish.
  useEffect(() => {
    if (!generating) return undefined;
    const id = setInterval(refreshKeyStats, 2000);
    return () => clearInterval(id);
  }, [generating, refreshKeyStats]);

  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) =>
      /^image\/(jpeg|png|webp|svg\+xml)$/.test(f.type) ||
      /\.(svg|ai|eps)$/i.test(f.name)
    );
    const next = files.map((file) => ({
      id: ++uidCounter,
      file,
      kind: classifyFile(file),
      url: URL.createObjectURL(file),
      status: 'pending',
      title: '',
      keywords: [],
      category: 13,
      error: '',
    }));
    setItems((prev) => [...prev, ...next]);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id, patch) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function processBatch(batch) {
    const ids = batch.map((i) => i.id);
    batch.forEach((i) => updateItem(i.id, { status: 'processing', error: '' }));
    // Prepare all images first; a single unreadable file shouldn't fail the rest.
    const prep = await Promise.allSettled(batch.map((i) => toAnalyzePayload(i.file, i.kind)));
    const okIdx = [];
    const images = [];
    prep.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        okIdx.push(idx);
        images.push({ imageBase64: r.value.base64, mimeType: r.value.mimeType });
      } else {
        updateItem(ids[idx], { status: 'error', error: r.reason?.message || 'Could not read this file.' });
      }
    });
    if (!images.length) return;
    try {
      const result = await api.generate({
        provider: settings.provider,
        images,
        model: settings.model,
        assetType: settings.assetType,
        kwCount: settings.kwCount,
        titleMin: settings.titleMin,
        titleMax: settings.titleMax,
      });
      // The server reports which key served the batch and the updated per-key
      // counters, so Settings can blink that key and move its usage bar at once.
      if (result.usedKey) setLastUsedKey(result.usedKey);
      if (result.apiKeys) setKeyStats(result.apiKeys);
      if (result.secondsUntilReset) setStatsMeta({ secondsUntilReset: result.secondsUntilReset });
      (result.results || []).forEach((r, k) => {
        const id = ids[okIdx[k]];
        if (!id) return;
        if (r && r.ok && r.title) {
          updateItem(id, { status: 'done', title: r.title, keywords: r.keywords, category: r.category });
        } else {
          updateItem(id, { status: 'error', error: r?.error || 'Generation failed.' });
        }
      });
    } catch (err) {
      batch.forEach((i) => updateItem(i.id, { status: 'error', error: err.message }));
    }
  }

  async function processOne(item) {
    await processBatch([item]);
  }

  async function generateAll() {
    if (!hasAnyKey(user?.apiKeys)) return;
    setGenerating(true);
    const queue = items.filter((i) => i.status === 'pending' || i.status === 'error');
    // Group the queue into batches: each batch = ONE Gemini request.
    const batches = [];
    for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));
    const limit = Math.max(1, Math.min(4, settings.concurrency));
    let cursor = 0;

    async function worker() {
      while (cursor < batches.length) {
        await processBatch(batches[cursor++]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, batches.length) }, worker));
    setGenerating(false);
    refreshKeyStats(); // final count once every batch has landed
  }

  function downloadCsv() {
    const rows = [['Filename', 'Title', 'Keywords']];
    items.filter((i) => i.status === 'done').forEach((i) => {
      rows.push([i.file.name, i.title, i.keywords.join(', ')]);
    });
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adobe-stock-metadata-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const hasItems = items.length > 0;
  // Overall generation progress: processed images (done + error) / total.
  const progressPercent = hasItems
    ? Math.round(((doneCount + errorCount) / items.length) * 100)
    : 0;

  // Which key is on the wire right now (from the polled stats), or the last key
  // that served a batch — shown in the footer next to the overall progress. The
  // number is the key's position in the Settings list, so both always agree.
  const providerKeys = providerKeysOf(keyStats, settings.provider);
  const busyKeys = providerKeys.map((k, i) => (k.inFlight > 0 ? i + 1 : 0)).filter(Boolean);
  const lastUsedPosition = (() => {
    if (!lastUsedKey) return 0;
    const i = providerKeys.findIndex((k) => k.id === lastUsedKey.id);
    return i >= 0 ? i + 1 : lastUsedKey.position;
  })();
  const activeKeyText = busyKeys.length
    ? `key ${busyKeys.join('+')} in use`
    : generating && lastUsedPosition
      ? `key ${lastUsedPosition} in use`
      : '';

  return (
    <div className="app">
      <TopBar />

      <Dropzone onFiles={addFiles} />

      <header className="top">
        <div className="brand">
          <h1>Adobe Stock metadata, from a folder of images</h1>
          <p>Drop your images, generate titles, keywords and categories with your saved Gemini key, then export a CSV ready for Adobe Stock Contributor.</p>
        </div>
        <SettingsPanel
          settings={settings}
          setSettings={setSettings}
          keyStats={keyStats}
          statsMeta={statsMeta}
          onRefreshStats={refreshKeyStats}
        />
      </header>

      {hasItems && (
        <div className="addmore">
          <div className="stats mono">
            <b>{items.length}</b> images &nbsp;·&nbsp; <b>{doneCount}</b> done &nbsp;·&nbsp; <b>{errorCount}</b> failed
          </div>
          <div className="actions">
            <button className="btn-ghost" type="button" onClick={() => setItems([])}>clear all</button>
          </div>
        </div>
      )}

      {!hasItems ? (
        <p className="empty-note">No images yet — drop some above to start.</p>
      ) : (
        <div className="card-list">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              onRemove={() => removeItem(item.id)}
              onRetry={() => processOne(item)}
              onChange={(patch) => updateItem(item.id, patch)}
            />
          ))}
        </div>
      )}

      <div className="bar">
        <div className="bar-inner">
          <div className="progress mono">
            {!hasAnyKey(user?.apiKeys)
              ? 'Add an API key in settings to generate'
              : hasItems
                ? `${doneCount} / ${items.length} generated${activeKeyText ? ` · ${activeKeyText}` : ''}`
                : '0 images loaded'}
          </div>
          <div className="buttons">
            <div className="gen-progress" aria-label={`${progressPercent}% complete`}>
              <div className="gen-progress-track">
                <div
                  className="gen-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="gen-progress-label mono">{progressPercent}%</span>
            </div>
            <button
              className="btn btn-generate" type="button" onClick={generateAll}
              disabled={!hasAnyKey(user?.apiKeys) || !hasItems || generating}
            >
              <span className="gen-dot" aria-hidden="true" />
              {generating ? 'Generating…' : 'Generate all'}
            </button>
            <button
              className="btn btn-secondary" type="button" onClick={downloadCsv}
              disabled={doneCount === 0}
            >
              Download CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
