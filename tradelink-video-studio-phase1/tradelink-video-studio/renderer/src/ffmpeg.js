// Builds and runs the FFmpeg commands. Everything runs inside a private temp folder with RELATIVE file names,
// so Windows paths (drive letters, backslashes) never reach the filter syntax.
import { spawn } from 'node:child_process';
import { FPS, H, W, layoutScene } from './layout.js';

export class RenderError extends Error {}

export function run(bin, args, { cwd, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(bin, args, { cwd, windowsHide: true });
    } catch (e) {
      return reject(new RenderError(`Could not start ${bin}: ${e.message}`));
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new RenderError(`${bin} took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    child.on('error', (e) => { clearTimeout(timer); reject(new RenderError(e.code === 'ENOENT' ? `${bin} was not found. Install FFmpeg or set FFMPEG_PATH/FFPROBE_PATH.` : `Could not run ${bin}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new RenderError(`${bin} failed (exit ${code}): ${err.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300)}`));
    });
  });
}

/** One still picture: blurred full-height background + the product picture fitted in front, at 2x for smooth zoom. */
export function compositeArgs(srcName, destName) {
  const fg = 'scale=1700:1900:force_original_aspect_ratio=decrease';
  const bg = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},gblur=sigma=40,eq=brightness=-0.12`;
  return ['-y', '-v', 'error', '-i', srcName, '-filter_complex',
    `[0:v]split=2[a][b];[a]${bg}[bg];[b]${fg}[fg];[bg][fg]overlay=(W-w)/2:1320-h/2,format=rgb24`,
    '-frames:v', '1', destName];
}

/** A soft, brand-navy tinted, blurred copy of the product picture that fills the whole frame (backdrop for the text-only scenes). */
export function backdropArgs(srcName, destName) {
  return ['-y', '-v', 'error', '-i', srcName, '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=34,eq=brightness=-0.2:saturation=0.8,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x073256@0.8:t=fill,format=rgb24`,
    '-frames:v', '1', destName];
}

// Smooth ease-in-out (smoothstep) so zooms and pans start and stop gently instead of moving at a constant speed.
const ease = (p) => `((${p})*(${p})*(3-2*(${p})))`;

function zoompan(motion, n) {
  const N = Math.max(1, n);
  const e = ease(`on/${N}`);
  const cy = "y='ih/2-(ih/zoom/2)'";
  switch (motion) {
    case 'zoom_in': return `z='1+0.14*${e}':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'zoom_out': return `z='1.14-0.14*${e}':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'pan_left': return `z='1.15':x='(iw-iw/zoom)*(1-${e})':${cy}`;
    case 'pan_right': return `z='1.15':x='(iw-iw/zoom)*${e}':${cy}`;
    default: return "z='1':x='0':y='0'";
  }
}

const TRANSITIONS = ['slideleft', 'fade', 'slideup', 'fade', 'wipeleft'];
const TRANSITION_S = 0.35;

const q = (s) => `'${s}'`;

/**
 * @param scenes  scenes from the frozen plan
 * @param opts    { style, imageFiles: Map(image_path -> composite file name), fontFile }
 * @returns { args, textFiles: {name: content}, frames }
 */
export function buildRenderArgs(scenes, { style, imageFiles, fontFile, outName = 'out.mp4', templateId = null, logoFile = null, audio = null, closing = true, backdropFile = null, quality = 'high', transitions = true, progress = true }) {
  const inputs = [];
  const chains = [];
  const textFiles = { 'wm.txt': 'TradeLink' };
  let frames = 0;

  // Transitions overlap neighbouring scenes, so every scene except the last is drawn a little longer (by its transition
  // time); the overlaps then give back exactly the planned length. A scene without animation gets a one-frame cut.
  const useTrans = transitions !== false && scenes.length > 1 && scenes.every((x) => x.duration_ms >= 1500);
  const gap = (i) => (!useTrans || i >= scenes.length - 1 ? 0 : scenes[i + 1].animation === 'none' ? 0.04 : TRANSITION_S);
  const last = scenes.length - 1;
  const backdrop = backdropFile && style !== 'minimal' ? backdropFile : null;

  scenes.forEach((scene, i) => {
    const secs = scene.duration_ms / 1000;
    const secsExt = secs + gap(i);
    const n = Math.round(secsExt * FPS);
    frames += Math.round(secs * FPS);
    const imgFile = scene.image_path ? imageFiles.get(scene.image_path) : null;
    const lay = layoutScene(scene, style, !!imgFile, templateId);

    if (imgFile) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', secsExt.toFixed(3), '-i', imgFile);
    } else if (backdrop) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', secsExt.toFixed(3), '-i', backdrop);
    } else {
      inputs.push('-f', 'lavfi', '-t', secsExt.toFixed(3), '-i', `color=c=${lay.bg}:s=${W}x${H}:r=${FPS}`);
    }

    const f = [];
    if (imgFile) f.push(`zoompan=${zoompan(lay.motion, n)}:d=1:s=${W}x${H}:fps=${FPS}`, 'eq=contrast=1.04:saturation=1.1', 'unsharp=5:5:0.45:5:5:0');
    else if (backdrop) f.push(`zoompan=${zoompan('zoom_in', n)}:d=1:s=${W}x${H}:fps=${FPS}`);
    else if (style !== 'minimal') f.push('vignette=angle=1.15');
    f.push('format=yuv420p', 'setsar=1');

    for (const b of lay.boxes) f.push(`drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${b.color}:t=fill`);

    const a = lay.textAnim;
    lay.lines.forEach((l, k) => {
      const name = `t_${i}_${k}.txt`;
      textFiles[name] = l.text;
      const start = a === 'none' ? 0 : 0.25 + k * 0.08;
      const dur = a === 'reveal' ? 0.9 : 0.4;
      const alpha = a === 'none' ? '1' : `if(lt(t,${start}),0,min(1,(t-${start})/${dur}))`;
      const slide = `(1-min(1,max(0,t-${start})/0.5))`;
      const x = a === 'slide_left' ? `(w-text_w)/2-20+${slide}*140` : '(w-text_w)/2-20';
      const y = a === 'slide_up' ? `${l.y}+${slide}*70` : `${l.y}`;
      const onLight = l.color === '0x163d5d' || l.color === '0x687b76' || l.color === '0x0b4f86' || l.color === '0x073256';
      const shadow = onLight ? '' : ':shadowcolor=black@0.55:shadowx=3:shadowy=3';
      f.push(`drawtext=fontfile=${fontFile}:textfile=${name}:expansion=none:fontsize=${l.size}:fontcolor=${l.color}${shadow}:x=${q(x)}:y=${q(y)}:alpha=${q(alpha)}`);
    });

    if (lay.fades) {
      if (!useTrans || i === 0) f.push(`fade=t=in:st=0:d=${lay.fadeS}`);
      if (!useTrans || i === last) f.push(`fade=t=out:st=${Math.max(0, secs - lay.fadeS).toFixed(3)}:d=${lay.fadeS}`);
    }
    f.push(`fps=${FPS}`, `settb=1/${FPS}`);
    chains.push(`[${i}:v]${f.join(',')}[s${i}]`);
  });

  const total = scenes.reduce((s, x) => s + x.duration_ms, 0) / 1000;
  if (useTrans) {
    let acc = 's0';
    let cum = 0;
    for (let k = 0; k < last; k++) {
      cum += scenes[k].duration_ms / 1000;
      const d = gap(k);
      chains.push(`[${acc}][s${k + 1}]xfade=transition=${d < 0.1 ? 'fade' : TRANSITIONS[k % TRANSITIONS.length]}:duration=${d}:offset=${cum.toFixed(3)}[x${k}]`);
      acc = `x${k}`;
    }
    chains.push(`[${acc}]null[c]`);
  } else {
    chains.push(`${scenes.map((_, i) => `[s${i}]`).join('')}concat=n=${scenes.length}:v=1:a=0[c]`);
  }
  let next = scenes.length;
  let cur = 'c';
  // Closing frame: the last second fades to the brand colour and shows the logo (or the TradeLink wordmark).
  // It sits ON the last scene, so the video length never changes. Skipped when the last scene is shorter than 3 s,
  // so the contact line always stays readable first.
  const doClose = closing !== false && scenes[scenes.length - 1].duration_ms >= 3000;
  const t0 = (total - 1).toFixed(3);
  const tShow = (total - 0.85).toFixed(3);
  if (doClose) {
    inputs.push('-f', 'lavfi', '-t', '1.000', '-i', `color=c=0x073256:s=${W}x${H}:r=${FPS}`);
    chains.push(`[${next}:v]format=yuva420p,fade=t=in:st=0:d=0.3:alpha=1,setpts=PTS+${t0}/TB[cl]`);
    chains.push(`[${cur}][cl]overlay=eof_action=pass[cc]`);
    cur = 'cc';
    next++;
  }
  if (progress !== false) {
    inputs.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', `color=c=0xe9a914:s=${W}x8:r=${FPS}`);
    chains.push(`[${cur}][${next}:v]overlay=x='-w+w*t/${total.toFixed(3)}':y=0:eof_action=pass[cp]`);
    cur = 'cp';
    next++;
  }
  if (logoFile) {
    // Your own logo replaces the plain "TradeLink" text mark. It is scaled to fit, never stretched.
    inputs.push('-i', logoFile);
    if (doClose) {
      chains.push(`[${next}:v]split=2[l1][l2]`);
      chains.push('[l1]scale=w=300:h=96:force_original_aspect_ratio=decrease,format=rgba[lg]');
      chains.push('[l2]scale=w=720:h=300:force_original_aspect_ratio=decrease,format=rgba[lbig]');
      chains.push(`[${cur}][lbig]overlay=x=(W-w)/2:y=(H-h)/2:enable='gte(t,${tShow})'[cb]`);
      cur = 'cb';
    } else chains.push(`[${next}:v]scale=w=300:h=96:force_original_aspect_ratio=decrease,format=rgba[lg]`);
    chains.push(`[${cur}][lg]overlay=x=60:y=110,fps=${FPS},format=yuv420p[v]`);
    next++;
  } else {
    const big = doClose ? `drawtext=fontfile=${fontFile}:textfile=wm.txt:expansion=none:fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,${tShow}),0,min(1,(t-${tShow})/0.35))',` : '';
    chains.push(`[${cur}]${big}drawbox=x=40:y=104:w=290:h=84:color=black@0.38:t=fill,drawtext=fontfile=${fontFile}:textfile=wm.txt:expansion=none:fontsize=44:fontcolor=white@0.92:shadowcolor=black@0.6:shadowx=3:shadowy=3:x=60:y=130,fps=${FPS},format=yuv420p[v]`);
  }

  const out = ['-map', '[v]'];
  if (audio) {
    // Your own sound: looped if short, cut to the video length, faded in and out, at the volume you chose.
    inputs.push('-stream_loop', '-1', '-i', audio.file);
    const vol = Math.min(1, Math.max(0, audio.volume ?? 0.5));
    chains.push(`[${next}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5,volume=${vol}[a]`);
    out.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(3));
  } else out.push('-an');

  const args = ['-y', '-v', 'error', ...inputs, '-filter_complex', chains.join(';'), ...out,
    '-c:v', 'libx264', ...(quality === 'fast' ? ['-preset', 'veryfast', '-crf', '20'] : ['-preset', 'medium', '-crf', '17', '-profile:v', 'high']),
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', total.toFixed(3),
    '-movflags', '+faststart', outName];
  return { args, textFiles, frames };
}

export function coverArgs(videoName, coverName, atSeconds) {
  return ['-y', '-v', 'error', '-ss', String(atSeconds), '-i', videoName, '-frames:v', '1', '-q:v', '3', coverName];
}

/** Looks for black stretches (a broken or missing picture). Prints black_start/black_end lines on stderr. */
export function blackArgs(inputName, { image = false } = {}) {
  const pre = image ? ['-loop', '1', '-t', '2'] : [];
  return ['-hide_banner', '-nostats', ...pre, '-i', inputName, '-vf', `blackdetect=d=${image ? 1 : 1.5}:pix_th=0.10:picture_black_ratio_th=0.65`, '-an', '-f', 'null', '-'];
}

export function probeArgs(videoName) {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', videoName];
}
