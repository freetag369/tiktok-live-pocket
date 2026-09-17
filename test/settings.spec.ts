import { describe, expect, it } from 'vitest';
import { normalizeUniqueId, sanitize, DEFAULT_SETTINGS } from '../src/lib/settings';

describe('normalizeUniqueId', () => {
  it('@ や URL を剥がす', () => {
    expect(normalizeUniqueId('@metafact8')).toBe('metafact8');
    expect(normalizeUniqueId('https://www.tiktok.com/@metafact8/live')).toBe('metafact8');
    expect(normalizeUniqueId('  nanacorobi915_ ')).toBe('nanacorobi915_');
    expect(normalizeUniqueId('')).toBe('');
  });
});

describe('sanitize', () => {
  it('壊れた値は既定に戻す', () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, fontSize: 'huge' as never, bigGiftDiamonds: -5, wsUrl: 'http://x' });
    expect(s.fontSize).toBe('medium');
    expect(s.bigGiftDiamonds).toBe(100);
    expect(s.wsUrl).toBe(DEFAULT_SETTINGS.wsUrl);
  });

  it('followPopup は未設定(古い保存データ)なら ON、false は保つ', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, followPopup: undefined as never }).followPopup).toBe(true);
    expect(sanitize({ ...DEFAULT_SETTINGS, followPopup: false }).followPopup).toBe(false);
  });

  it('アーカイブの保持数は 1〜500 に丸め、不正なら既定', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, archiveKeepStreams: 0 }).archiveKeepStreams).toBe(1);
    expect(sanitize({ ...DEFAULT_SETTINGS, archiveKeepStreams: 9999 }).archiveKeepStreams).toBe(500);
    expect(sanitize({ ...DEFAULT_SETTINGS, archiveKeepStreams: 12.7 }).archiveKeepStreams).toBe(12);
    expect(sanitize({ ...DEFAULT_SETTINGS, archiveKeepStreams: NaN }).archiveKeepStreams).toBe(30);
    expect(sanitize({ ...DEFAULT_SETTINGS, archiveEnabled: undefined as never }).archiveEnabled).toBe(true);
  });

  it('likePopup は既定 true、boolean 以外は true に戻す', () => {
    expect(DEFAULT_SETTINGS.likePopup).toBe(true);
    expect(sanitize({ ...DEFAULT_SETTINGS, likePopup: 'yes' as never }).likePopup).toBe(true);
    expect(sanitize({ ...DEFAULT_SETTINGS, likePopup: false }).likePopup).toBe(false);
  });
});
