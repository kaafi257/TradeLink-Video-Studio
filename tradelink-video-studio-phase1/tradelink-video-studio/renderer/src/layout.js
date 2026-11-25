// Turns a scene from the frozen render plan into drawing instructions. Pure; no I/O.
import { hasEthiopic, measure, sanitizeText, wrapByWidth } from './text.js';
import { templateLayout } from './templates.js';

export const W = 1080;
export const H = 1920;
export const FPS = 30;
const MARGIN_LEFT = 90;
const MARGIN_RIGHT = 130; // TikTok buttons sit on the right
const USABLE = W - MARGIN_LEFT - MARGIN_RIGHT;
const BOTTOM_LIMIT = 1480; // keep clear of the TikTok caption area

export const STYLES = {
  premium: { band: '0x073256@0.80', accent: '0xe9a914', head: 'white', body: '0xf6c54a', hs: 76, bs: 44, bg: '0x073256', plainHead: 'white', plainBody: '0xf6c54a', price: '0xf6c54a' },
  dynamic: { band: '0xe9a914@0.95', accent: '0x073256', head: '0x073256', body: '0x163d5d', hs: 88, bs: 48, bg: '0x0b4f86', plainHead: 'white', plainBody: '0xf6c54a', price: '0xf6c54a' },
  minimal: { band: '0x000000@0.40', accent: null, head: 'white', body: 'white', hs: 68, bs: 42, bg: '0xf8f9fa', plainHead: '0x163d5d', plainBody: '0x687b76', price: '0x0b4f86' },
};

const lineHeight = (size) => Math.round(size * 1.28);

/** Largest listed size at which the text fits on ONE line; otherwise the smallest (it will then wrap). */
export function fitSize(text, sizes, widthPx = USABLE) {
  const t = sanitizeText(text);
  return sizes.find((sz) => measure(t, sz) <= widthPx) ?? sizes[sizes.length - 1];
}

function block(text, size, maxLines) {
  if (!text) return [];
  const t = sanitizeText(text);
  if (!t) return [];
  return wrapByWidth(t, size, USABLE, maxLines).map((line) => ({ text: line, size }));
}

/**
 * @param scene  {scene_type, duration_ms, headline, body, image_path, animation}
 * @param styleName premium | dynamic | minimal
 * @param templateId optional Phase 4 template id (layout tweaks only)
 * @returns {{hasImage:boolean, bg:string, boxes:Array, lines:Array, motion:string, textAnim:string, fades:boolean}}
 */
export function layoutScene(scene, styleName, hasImage, templateId = null) {
  const base = STYLES[styleName] ?? STYLES.premium;
  const tl = templateLayout(templateId);
  const st = { ...base, hs: base.hs + (tl.hsAdd ?? 0), bs: base.bs + (tl.bsAdd ?? 0) };
  const boxes = [];
  const lines = [];
  const type = scene.scene_type;
  const centered = !hasImage || type === 'price' || type === 'cta' || type === 'wholesale';

  const headSize = type === 'price' ? fitSize(scene.headline, tl.priceSizes ?? [130, 110, 92, 76])
    : type === 'cta' ? fitSize(scene.headline, tl.ctaSizes ?? [62, 54, 46])
    : centered ? fitSize(scene.headline, [st.hs, 66, 56])
    : st.hs;
  const head = block(scene.headline, headSize, hasImage && !centered ? 2 : 3);
  const bodyIsButton = type === 'wholesale' && !!scene.body;
  const body = bodyIsButton ? [] : block(scene.body, st.bs, hasImage && !centered ? 3 : 4);

  const headH = head.reduce((a, l) => a + lineHeight(l.size), 0);
  const bodyH = body.reduce((a, l) => a + lineHeight(l.size), 0);
  const gap = head.length && body.length ? 24 : 0;
  const total = headH + gap + bodyH;

  let top;
  if (centered) {
    top = Math.round(H * 0.44 - total / 2);
  } else {
    const bandH = total + 110;
    const bandTop = BOTTOM_LIMIT - bandH;
    boxes.push({ x: 0, y: bandTop, w: W, h: bandH, color: tl.bandAlpha === 'full' ? st.band.split('@')[0] : st.band });
    const accent = tl.accentColor ?? st.accent;
    if (accent) boxes.push({ x: 0, y: bandTop, w: W, h: tl.accentH ?? 8, color: accent });
    top = bandTop + 55;
  }

  const onBand = !centered;
  const headColor = onBand ? st.head : type === 'price' ? st.price : type === 'cta' ? '0x073256' : st.plainHead;
  const bodyColor = onBand ? st.body : st.plainBody;

  if (type === 'cta') {
    const boxH = total + 120;
    const boxTop = Math.round(H * 0.44 - boxH / 2);
    boxes.push({ x: MARGIN_LEFT - 20, y: boxTop, w: USABLE + 40, h: boxH, color: '0xe9a914' });
    top = boxTop + 60;
  }

  let y = top;
  for (const l of head) { lines.push({ ...l, y, color: headColor, kind: 'head' }); y += lineHeight(l.size); }
  y += gap;
  for (const l of body) { lines.push({ ...l, y, color: bodyColor, kind: 'body' }); y += lineHeight(l.size); }

  if (bodyIsButton) {
    const t = sanitizeText(scene.body);
    const size = tl.btnSize ?? 56;
    const btnTop = y + 70;
    const btnH = tl.btnH ?? 150;
    boxes.push({ x: MARGIN_LEFT - 20, y: btnTop, w: USABLE + 40, h: btnH, color: '0xe9a914' });
    lines.push({ text: t, size, y: btnTop + Math.round((btnH - size) / 2) - 10, color: '0x073256', kind: 'button' });
  }

  const motion = hasImage && ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'].includes(scene.animation) ? scene.animation : 'static';
  const textAnim = ['slide_up', 'slide_left', 'reveal', 'none'].includes(scene.animation) ? scene.animation : 'fade';
  return { hasImage, bg: st.bg, boxes, lines, motion, textAnim, fades: scene.animation !== 'none', fadeS: tl.fadeS ?? 0.3 };
}

export function wantsEthiopic(scenes) {
  return scenes.some((s) => hasEthiopic(`${s.headline ?? ''} ${s.body ?? ''}`));
}
