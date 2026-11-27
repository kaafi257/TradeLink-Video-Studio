// Layout tweaks for the nine templates. The template sets WHERE and HOW BIG things are, never WHAT they say.
// Unknown or missing template ids behave exactly like Phase 3 (the style alone decides).
export const TEMPLATE_LAYOUT = {
  clean_product: {},
  bold_sale: { priceSizes: [150, 130, 110, 92], accentH: 16, accentColor: '0xe9a914', bandAlpha: 'full', fadeS: 0.25 },
  wholesale_offer: { btnH: 170, btnSize: 60, accentH: 10 },
  supplier_spotlight: { hsAdd: -4, bsAdd: 4, accentH: 10 },
  campaign_banner: { hsAdd: 8, accentH: 14, accentColor: '0xe9a914', fadeS: 0.25 },
  story_quick: { ctaSizes: [70, 62, 54], fadeS: 0.2, hsAdd: 4 },
  minimal_product: { fadeS: 0.4, hsAdd: -4 },
  wholesale_bold: { btnH: 190, btnSize: 64, accentH: 14, accentColor: '0xe9a914', fadeS: 0.25 },
  campaign_minimal: { fadeS: 0.4, hsAdd: -4 },
};

export function templateLayout(id) {
  return (typeof id === 'string' && Object.hasOwn(TEMPLATE_LAYOUT, id) && TEMPLATE_LAYOUT[id]) || {};
}
