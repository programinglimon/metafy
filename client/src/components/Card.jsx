import React, { useState } from 'react';
import { CATEGORIES } from '../categories.js';

const STATUS_LABEL = { pending: 'queued', processing: 'generating…', done: 'done', error: 'failed' };

export default function Card({ item, onRemove, onRetry, onChange }) {
  const [kwInput, setKwInput] = useState('');

  function addKeyword() {
    const v = kwInput.trim().toLowerCase();
    if (!v) return;
    onChange({ ...item, keywords: [...item.keywords, v] });
    setKwInput('');
  }

  function removeKeyword(idx) {
    const next = item.keywords.slice();
    next.splice(idx, 1);
    onChange({ ...item, keywords: next });
  }

  return (
    <div className="card-row">
      {/* left column: preview + original filename */}
      <div className="card-thumb-col">
        <div className="row-thumb">
          {item.kind === 'ai' || item.kind === 'eps' ? (
            <div className="vec-placeholder">{item.kind.toUpperCase()}</div>
          ) : (
            <img src={item.url} alt="" />
          )}
          <span className={`status ${item.status}`}>{STATUS_LABEL[item.status]}</span>
          <button className="remove" type="button" aria-label="Remove" onClick={onRemove}>×</button>
        </div>
        <div className="row-filename" title={item.file.name}>{item.file.name}</div>
      </div>

      {/* right column: generated title on top, tags below */}
      <div className="card-info-col">
        {item.status === 'error' ? (
          <div className="err-block">
            <div className="errormsg">{item.error || 'Generation failed.'}</div>
            <button className="retry" type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : (
          <>
            <div className="field">
              <label>TITLE <span>{(item.title || '').length}/200</span></label>
              <textarea
                className="title-input"
                placeholder={item.status === 'processing' ? 'generating…' : 'generated title will appear here'}
                value={item.title || ''}
                onChange={(e) => onChange({ ...item, title: e.target.value })}
              />
            </div>

            <div className="field">
              <label>KEYWORDS · tags</label>
              <div className="kwbox">
                {item.keywords.map((k, idx) => (
                  <span className="kw" key={idx}>
                    {k}
                    <button type="button" onClick={() => removeKeyword(idx)}>×</button>
                  </span>
                ))}
                <input
                  className="kw-input"
                  type="text"
                  placeholder="+ add tag"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                />
              </div>
            </div>

            <div className="field cat-row">
              <label>CATEGORY</label>
              <select
                className="cat-select"
                value={item.category}
                onChange={(e) => onChange({ ...item, category: Number(e.target.value) })}
              >
                {CATEGORIES.map(([n, name]) => (
                  <option key={n} value={n}>{n} — {name}</option>
                ))}
              </select>
              <span className="kwcount">{item.keywords.length} tags</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
