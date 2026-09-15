import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PROVIDERS, PROVIDER_IDS, providerKeysOf } from '../providers.js';

// "6h 24m" — countdown to the next Pacific-midnight quota reset.
function formatReset(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function shorten(text, max = 72) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// One key's daily quota: how many requests this app sent today against the
// key's limit. The limit comes from the provider itself once it has said so in a
// 429 payload ("learned"); before that it's an estimate, shown with "~". With no
// limit at all we just print the raw count.
function KeyUsage({ stat, resetIn }) {
  const uses = stat?.uses || 0;
  const limit = stat?.limit || 0;
  const percent = limit > 0 ? Math.min(100, Math.round((uses / limit) * 100)) : 0;
  const level = percent >= 100 ? 'full' : percent >= 80 ? 'high' : percent >= 50 ? 'mid' : 'low';
  const width = limit > 0 ? percent : uses > 0 ? 4 : 0;

  return (
    <div className="key-usage">
      <div className="key-usage-head mono">
        <span>
          {limit > 0
            ? `${uses} / ${stat.limitSource === 'estimated' ? '~' : ''}${limit} req today · ${percent}%`
            : `${uses} req today`}
        </span>
        <span>
          {stat?.failures > 0 ? `${stat.failures} failed · ` : ''}
          {resetIn > 0 ? `resets in ${formatReset(resetIn)}` : 'resets midnight PT'}
        </span>
      </div>
      <div className="key-usage-track">
        <div className={`key-usage-fill ${level}`} style={{ width: `${width}%` }} />
      </div>
      {stat?.exhausted && (
        <div className="key-usage-note mono">
          Daily quota spent — generation auto-switches to the next key.
        </div>
      )}
      {!stat?.exhausted && stat?.failures > 0 && stat?.lastError && (
        <div className="key-usage-note mono" title={stat.lastError}>
          last error: {shorten(stat.lastError)}
        </div>
      )}
    </div>
  );
}

// `keyStats`/`statsMeta` come from Dashboard (polled from /user/key-stats while
// generating): they carry per-key usage and which key is in flight right now.
export default function SettingsPanel({ settings, setSettings, keyStats, statsMeta, onRefreshStats }) {
  const { user, setUser } = useAuth();
  const providerId = settings.provider || 'gemini';
  const p = PROVIDERS[providerId] || PROVIDERS.gemini;
  const savedKeys = user?.apiKeys || {};
  const keyInfo = savedKeys[providerId] || { count: 0, ids: [] };
  const hasKey = (keyInfo.count || 0) > 0;
  const stats = providerKeysOf(keyStats, providerId);
  // Live stats when we have them, otherwise fall back to the saved key ids (so
  // the list renders before the first poll finishes).
  const listedKeys = stats.length
    ? stats
    : (keyInfo.ids || []).length
      ? (keyInfo.ids || []).map((id, index) => ({ id, index, legacy: false }))
      : hasKey
        ? [{ id: 'legacy', index: null, legacy: true }]
        : [];
  const busyKeys = listedKeys
    .map((k, i) => (k.inFlight > 0 ? i + 1 : 0))
    .filter(Boolean);
  const resetIn = statsMeta?.secondsUntilReset || 0;
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false); // collapse/expand the panel body

  function syncFromServer(apiKeys) {
    setUser((u) => ({ ...u, apiKeys }));
    const current = apiKeys?.[providerId] || { count: 0 };
    if ((current.count || 0) === 0) setEditing(true);
    onRefreshStats?.(); // re-pull live stats so a new/removed key shows up at once
  }

  function switchProvider(nextId) {
    const next = PROVIDERS[nextId] || PROVIDERS.gemini;
    const patch = { ...settings, provider: nextId };
    if (!next.models.includes(settings.model)) patch.model = next.defaultModel;
    setSettings(patch);
    setEditing(false);
    setKeyInput('');
    setMsg('');
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await api.saveApiKey(providerId, keyInput.trim());
      syncFromServer(res.apiKeys);
      setEditing(false);
      setKeyInput('');
      setMsg('Saved.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeKey(keyId) {
    setSaving(true);
    setMsg('');
    try {
      const res = await api.removeApiKey(providerId, keyId);
      syncFromServer(res.apiKeys);
      setMsg('Removed.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Plaintext keys never leave the server, so "edit/replace" is: remove the
  // old entry, then open the input to paste the new key (one-click flow).
  async function replaceKey(keyId) {
    await removeKey(keyId);
    setKeyInput('');
    setEditing(true);
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <div className="settings-head-info">
          <span className="settings-name">SETTINGS</span>
          <span className="settings-summary mono">
            {p.label} · {settings.model} · {settings.kwCount} kw
          </span>
        </div>
        <button
          type="button"
          className="settings-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span>{open ? 'hide' : 'show'}</span>
          <span className={`settings-caret ${open ? 'open' : ''}`}>⌄</span>
        </button>
      </div>

      {open && (
        <>
      <div className="row">
        <label>PROVIDER</label>
        <select value={providerId} onChange={(e) => switchProvider(e.target.value)}>
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>{PROVIDERS[id].label}</option>
          ))}
        </select>
        <span className="settings-hint">{p.freeNote}</span>
      </div>

      <div className="row">
        <label className="gemini-label">
          <span>{p.label.toUpperCase()} API KEYS ({keyInfo.count || 0})</span>
          <span className={hasKey ? 'conn-chip on' : 'conn-chip'}>
            {hasKey ? '✓ CONNECTED' : 'NOT SET'}
          </span>
        </label>

        {hasKey && !editing && (
          <>
            <div className="gemini-status">
              <span className="gemini-badge">{p.label}</span>
              <div className="gemini-meta">
                <span className="gemini-title">{keyInfo.count || 0} {keyInfo.count === 1 ? 'key' : 'keys'} saved</span>
                <span className="gemini-sub">
                  encrypted · pooled · auto-switches when a key hits its limit
                  {resetIn > 0 ? ` · quota resets in ${formatReset(resetIn)}` : ''}
                </span>
              </div>
              {busyKeys.length > 0 && (
                <span className="key-tag live">
                  KEY {busyKeys.join('+')} IN USE
                </span>
              )}
            </div>

            <ul className="key-list">
              {listedKeys.map((k, i) => (
                <li
                  key={k.id}
                  className={`key-item${k.inFlight > 0 ? ' in-use' : ''}${k.exhausted ? ' spent' : ''}`}
                >
                  <div className="key-item-top">
                    <span className="key-item-label">
                      Key {i + 1}
                      {k.legacy && <span className="key-item-legacy">legacy</span>}
                    </span>
                    <span className="key-item-tags">
                      {k.inFlight > 0 && <span className="key-tag live">IN USE</span>}
                      {k.inFlight === 0 && k.exhausted && <span className="key-tag spent">LIMIT REACHED</span>}
                    </span>
                    <span className="key-item-actions">
                      <button
                        className="mini-btn" type="button"
                        onClick={() => replaceKey(k.legacy ? undefined : k.id)}
                        disabled={saving}
                      >
                        Replace
                      </button>
                      <button
                        className="mini-btn danger" type="button"
                        onClick={() => removeKey(k.legacy ? undefined : k.id)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                  <KeyUsage stat={k} resetIn={resetIn} />
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" type="button" onClick={() => { setEditing(true); setKeyInput(''); }} disabled={saving}>
                add another key
              </button>
            </div>
          </>
        )}

        {(editing || !hasKey) && (
          <>
            <div className="keyrow">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder={providerId === 'gemini' ? 'AIza...' : 'key...'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoComplete="off"
              />
              <button className="btn-ghost" type="button" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'hide' : 'show'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-ghost"
                type="button" onClick={saveKey}
                disabled={saving || !keyInput.trim()}
              >
                {hasKey ? 'add another key' : 'save key'}
              </button>
              {hasKey && (
                <button className="btn-ghost" type="button" onClick={() => { setEditing(false); setKeyInput(''); }} disabled={saving}>
                  done
                </button>
              )}
            </div>
          </>
        )}

        <small>
          Keys are encrypted and only decrypted server-side. Add keys from separate
          projects to multiply your quota — {p.keyHint}. {msg && <b style={{ color: 'var(--accent)' }}>{msg}</b>}
        </small>
      </div>

      <div className="row">
        <label>ASSET TYPE</label>
        <select value={settings.assetType} onChange={(e) => setSettings({ ...settings, assetType: e.target.value })}>
          <option value="photo">Photo</option>
          <option value="icon">Icon / Vector graphic</option>
        </select>
        <span className="settings-hint">Icon mode rewrites titles/tags for icon searches (e.g. "calendar icon flat").</span>
      </div>

      {settings.assetType === 'icon' && (
        <div className="icon-seo-badge">
          <div className="icon-seo-badge-header">
            <span className="icon-seo-badge-icon">✦</span>
            <span className="icon-seo-badge-title">Adobe Stock Max Rank Mode</span>
          </div>
          <ul className="icon-seo-badge-list">
            <li>
              <span className="icon-seo-badge-dot"></span>
              <span><b>Title</b>: ~70 chars · subject first · "[subject] icon [style]" format</span>
            </li>
            <li>
              <span className="icon-seo-badge-dot"></span>
              <span><b>Top 10 keywords</b>: algorithm-weighted · title words in slots 1–3</span>
            </li>
            <li>
              <span className="icon-seo-badge-dot"></span>
              <span><b>35 keywords</b> · research-proven Adobe Stock sweet spot (50 dilutes ranking)</span>
            </li>
          </ul>
        </div>
      )}

      <div className="row two-col">
        <div>
          <label>MODEL</label>
          <select value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>
            {p.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label>KEYWORDS</label>
          <input
            type="number" min={10} max={49}
            value={settings.kwCount}
            onChange={(e) => setSettings({ ...settings, kwCount: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row two-col">
        <div>
          <label>TITLE WORDS (MIN)</label>
          <input
            type="number" min={5} max={30}
            value={settings.titleMin}
            onChange={(e) => setSettings({ ...settings, titleMin: Number(e.target.value) })}
          />
        </div>
        <div>
          <label>TITLE WORDS (MAX)</label>
          <input
            type="number" min={5} max={40}
            value={settings.titleMax}
            onChange={(e) => setSettings({ ...settings, titleMax: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <label>CONCURRENT BATCHES</label>
        <input
          type="number" min={1} max={4}
          value={settings.concurrency}
          onChange={(e) => setSettings({ ...settings, concurrency: Number(e.target.value) })}
        />
        <span className="settings-hint">Each batch = 6 images in one request, so this many requests run in parallel.</span>
      </div>
        </>
      )}
    </div>
  );
}
