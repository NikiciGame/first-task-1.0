/* Prototype heuristics: deterministic and deliberately easy to calibrate on
   labeled moderation outcomes. Nothing here knows where reviews came from. */
const WEIGHTS = { text: 0.65, clinic: 0.15, date: 0.10, source: 0.05, rating: 0.05, procedure: 0.05 };
const THRESHOLDS = { likely: 0.82, manual: 0.63 };
const STOP_WORDS = new Set('a an the and or but for to of in on at with from by is are was were be been being it its this that they their them i we you he she had have has as after before very overall also said reported reviewer patient'.split(' '));

function normal(value) { return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function tokens(text) { return normal(text).split(' ').filter(word => word.length > 1 && !STOP_WORDS.has(word)); }
function cosine(a, b, idf) {
  const vector = text => { const counts = new Map(); tokens(text).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); return counts; };
  const av = vector(a), bv = vector(b); let dot = 0, an = 0, bn = 0;
  for (const [term, count] of av) { const v = count * (idf.get(term) || 1); an += v * v; dot += v * (bv.get(term) || 0) * (idf.get(term) || 1); }
  for (const [term, count] of bv) { const v = count * (idf.get(term) || 1); bn += v * v; }
  return an && bn ? dot / Math.sqrt(an * bn) : 0;
}
function buildIdf(reviews) { const docs = reviews.map(r => new Set(tokens(r.translated_text || r.original_text))); const idf = new Map(); docs.forEach(doc => doc.forEach(t => idf.set(t, (idf.get(t) || 0) + 1))); for (const [t, count] of idf) idf.set(t, Math.log((docs.length + 1) / (count + 1)) + 1); return idf; }
function dateSignal(a, b) { if (!a || !b) return null; const days = Math.abs(new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000; return days === 0 ? 1 : days <= 2 ? 0.6 : 0; }
function same(a, b) { return a != null && b != null ? Number(normal(a) === normal(b)) : null; }
function scorePair(left, right, idf) {
  const components = { text: cosine(left.translated_text || left.original_text || '', right.translated_text || right.original_text || '', idf), clinic: same(left.clinic, right.clinic), date: dateSignal(left.date, right.date), source: same(left.source, right.source), rating: same(left.rating, right.rating), procedure: same(left.procedure, right.procedure) };
  let sum = 0, available = 0;
  Object.entries(components).forEach(([key, value]) => { if (value !== null) { sum += value * WEIGHTS[key]; available += WEIGHTS[key]; } });
  const score = available ? sum / available : 0;
  const classification = score >= THRESHOLDS.likely ? 'likely' : score >= THRESHOLDS.manual ? 'manual' : 'distinct';
  return { left, right, score, classification, components };
}
function findPairs(reviews) { const idf = buildIdf(reviews), pairs = []; for (let i = 0; i < reviews.length; i++) for (let j = i + 1; j < reviews.length; j++) pairs.push(scorePair(reviews[i], reviews[j], idf)); return pairs.sort((a, b) => b.score - a.score); }

// Lightweight regression checks for core, source-agnostic behavior.
(function runTests() { const idf = buildIdf([{ translated_text: 'nose surgery smooth recovery' }, { translated_text: 'unrelated skin treatment waiting room' }]); const base = { clinic:'A', source:'S', date:'2026-01-01', rating:5, translated_text:'nose surgery smooth recovery' }; console.assert(scorePair(base, {...base}, idf).score > .95, 'identical review should score highly'); console.assert(scorePair(base, {...base, translated_text:'unrelated skin treatment waiting room'}, idf).score < THRESHOLDS.likely, 'same metadata alone is insufficient'); console.assert(Number.isFinite(scorePair({translated_text:'nose surgery'}, {translated_text:'nose surgery'}, idf).score), 'missing metadata still scores'); })();

const labels = { likely: 'Likely duplicate', manual: 'Review manually' };
const state = { filter: 'likely', pairs: [] };
const $ = id => document.getElementById(id);
function metadata(review) { return [review.clinic, review.source, review.date, review.rating != null ? `${review.rating} ★` : null, review.procedure].filter(Boolean); }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function renderReview(review, side) { const article = el('article', 'review'); article.append(el('p', 'review-label', `Review ${side}`)); const meta = el('div', 'meta'); metadata(review).forEach(value => meta.append(el('span', '', value))); article.append(meta, el('p', 'review-text', review.translated_text || review.original_text || 'No review text available.')); return article; }
function render() { const list = state.pairs.filter(p => state.filter === 'all' ? p.classification !== 'distinct' : p.classification === state.filter); $('result-count').textContent = `${list.length} candidate${list.length === 1 ? '' : 's'} shown`; const root = $('candidates'); root.replaceChildren(); if (!list.length) { root.append(el('p', 'empty', 'No candidates in this filter.')); return; }
  list.forEach(pair => { const card = el('article', 'card'); const top = el('div', 'card-top'); const score = el('div', 'score'); score.append(el('strong', '', `${Math.round(pair.score * 100)}%`), el('span', `badge ${pair.classification}`, labels[pair.classification])); const status = el('div', 'status'); status.append(el('small', '', 'Example moderator outcomes')); const outcomes = el('div', 'outcomes'); ['Duplicate', 'Distinct', 'Unsure'].forEach(outcome => outcomes.append(el('span', 'outcome-chip', outcome))); status.append(outcomes); top.append(score, status); const grid = el('div', 'review-grid'); grid.append(renderReview(pair.left, 'A'), renderReview(pair.right, 'B')); const details = el('details'); const summary = el('summary', '', 'Why this score?'); details.append(summary); const breakdown = el('div', 'breakdown'); Object.entries(pair.components).forEach(([key, value]) => { if (value !== null) breakdown.append(el('span', '', `${key}: ${Math.round(value * 100)}%`)); }); details.append(breakdown); card.append(top, grid, details); root.append(card); }); }
async function init() { try { const reviews = await fetch('data/reviews.json').then(r => { if (!r.ok) throw new Error('snapshot unavailable'); return r.json(); }); state.pairs = findPairs(reviews); const candidates = state.pairs.filter(p => p.classification !== 'distinct'); $('review-count').textContent = reviews.length; $('pair-count').textContent = state.pairs.length.toLocaleString(); $('likely-count').textContent = state.pairs.filter(p => p.classification === 'likely').length; $('manual-count').textContent = state.pairs.filter(p => p.classification === 'manual').length; document.querySelectorAll('.filter').forEach(b => b.onclick = () => { state.filter = b.dataset.filter; document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b)); render(); }); render(); } catch (error) { $('candidates').append(el('p', 'empty', `Could not load demo snapshot: ${error.message}`)); } }
init();
