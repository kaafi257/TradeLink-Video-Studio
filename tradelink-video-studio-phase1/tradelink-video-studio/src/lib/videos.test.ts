import { describe, expect, it } from 'vitest';
import { availableActions, formatHashtags, isEditable, parseHashtags, parseSeconds, postText, sceneTotalMs, timeMatches, VIDEO_STATUSES } from './videos';

describe('video rules', () => {
  it('only drafts and failed videos are editable', () => {
    expect(VIDEO_STATUSES.filter(isEditable)).toEqual(['draft', 'failed']);
  });
  it('viewers get no actions; nobody can set Rendering or Ready by hand', () => {
    for (const s of VIDEO_STATUSES) expect(availableActions(s, false)).toEqual([]);
    for (const s of VIDEO_STATUSES) expect(availableActions(s, true)).not.toContain('ready');
    expect(availableActions('rendering', true)).toEqual([]);
    expect(availableActions('queued', true)).toEqual(['cancel']);
    expect(availableActions('ready_to_post', true)).toEqual(['markPublished', 'archive']);
  });
  it('checks scene time against the video length like the database', () => {
    const scenes = [{ duration_ms: 5000 }, { duration_ms: 10000 }, { duration_ms: 5400 }];
    expect(sceneTotalMs(scenes)).toBe(20400);
    expect(timeMatches(20400, 20)).toBe(true);
    expect(timeMatches(20600, 20)).toBe(false);
  });
  it('parses seconds', () => {
    expect(parseSeconds('5')).toBe(5000);
    expect(parseSeconds('2.5')).toBe(2500);
    for (const bad of ['', '0', '0.5', '16', '1.55', 'a', '-1']) expect(parseSeconds(bad)).toBeNull();
  });
  it('parses hashtags typed by the owner', () => {
    expect(parseHashtags('#trade, Wholesale  #trade')).toEqual(['trade', 'Wholesale']);
    expect(parseHashtags('')).toEqual([]);
    expect(parseHashtags('bad-tag')).toBe('invalid');
    expect(formatHashtags(['a', 'b'])).toBe('#a #b');
  });
  it('builds the text to paste', () => {
    expect(postText('Hello', ['a'])).toBe('Hello\n\n#a');
    expect(postText(null, [])).toBe('');
  });
});
