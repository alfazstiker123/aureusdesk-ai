// Regresi: mengetik di kolom Pengaturan tidak boleh merebut fokus (efek panel hanya bergantung pada `open`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/SettingsSheet.js', import.meta.url), 'utf8');
const effect = src.slice(src.indexOf('useEffect(() => {'), src.indexOf('if (!open) return null;'));

test('efek panel Pengaturan hanya bergantung pada [open], bukan onClose (identitas berubah tiap render)', () => {
  assert.match(effect, /\}, \[open\]\);/);
  assert.doesNotMatch(effect, /\[open, onClose\]/);
});
test('onClose dibaca lewat ref terbaru (Escape tetap menutup panel)', () => {
  assert.match(src, /const onCloseRef = useRef\(onClose\);/);
  assert.match(src, /onCloseRef\.current = onClose;/);
  assert.match(effect, /onCloseRef\.current\?\.\(\)/);
});
test('focus() panel hanya ada di dalam efek yang bergantung pada open', () => {
  const all = [...src.matchAll(/\.focus\(\)/g)].length;
  assert.equal(all, 1);
  assert.ok(effect.includes('panelRef.current?.focus()'));
});
test('modal lain tidak memakai pola dependensi onClose + focus', () => {
  for (const f of ['PairPicker', 'ChatBox', 'HistoryPanel', 'PinGate', 'Uploader', 'ZoneCards', 'MarkdownView']) {
    const t = readFileSync(new URL(`../components/${f}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /\[open, onClose\]|\[onClose\]/, f);
  }
});
