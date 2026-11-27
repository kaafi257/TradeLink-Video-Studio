import { describe, expect, it } from 'vitest';
import { isTemplateId, TEMPLATE_IDS, TEMPLATES, templateFits, templatesFor } from './templates';
import { DURATIONS, STYLES, VIDEO_TYPES } from './scenes';

describe('templates', () => {
  it('there are exactly the six approved templates', () => {
    expect([...TEMPLATE_IDS].sort()).toEqual(['bold_sale', 'campaign_banner', 'campaign_minimal', 'clean_product', 'minimal_product', 'story_quick', 'supplier_spotlight', 'wholesale_bold', 'wholesale_offer']);
    for (const id of TEMPLATE_IDS) expect(TEMPLATES[id].id).toBe(id);
  });
  it('each template is well formed', () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(STYLES).toContain(t.style);
      expect(t.durations.length).toBeGreaterThan(0);
      expect(t.durations).toContain(t.defaultDuration);
      for (const d of t.durations) expect(DURATIONS).toContain(d);
      for (const v of t.videoTypes) expect(VIDEO_TYPES).toContain(v);
      for (const w of Object.values(t.weights)) expect(w).toBeGreaterThan(0);
      expect(t.animations.image.length).toBeGreaterThan(0);
    }
  });
  it('every video type has at least one template', () => {
    for (const v of VIDEO_TYPES) expect(templatesFor(v).length).toBeGreaterThan(0);
  });
  it('fit rules', () => {
    expect(templateFits('story_quick', 'product_showcase', 15)).toBe(true);
    expect(templateFits('story_quick', 'product_showcase', 30)).toBe(false);
    expect(templateFits('wholesale_offer', 'product_showcase', 20)).toBe(false);
  });
  it('recognises template ids from the database', () => {
    expect(isTemplateId('bold_sale')).toBe(true);
    expect(isTemplateId('nope')).toBe(false);
    expect(isTemplateId(null)).toBe(false);
  });
});
