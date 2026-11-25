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

function zoompan(motion, n) {
  const N = Math.max(1, n);
  const cy = "y='ih/2-(ih/zoom/2)'";
  switch (motion) {
    case 'zoom_in': return `z='1+0.14*on/${N}':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'zoom_out': return `z='1.14-0.14*on/${N}':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'pan_left': return `z='1.15':x='(iw-iw/zoom)*(1-on/${N})':${cy}`;
    case 'pan_right': return `z='1.15':x='(iw-iw/zoom)*on/${N}':${cy}`;
    default: return "z='1':x='0':y='0'";
  }
}

const q = (s) => `'${s}'`;

/**
 * @param scenes  scenes from the frozen plan
 * @param opts    { style, imageFiles: Map(image_path -> composite file name), fontFile }
 * @returns { args, textFiles: {name: content}, frames }
 */
export function buildRenderArgs(scenes, { style, imageFiles, fontFile, outName = 'out.mp4', templateId = null }) {
  const inputs = [];
  const chains = [];
  const textFiles = { 'wm.txt': 'TradeLink' };
  let frames = 0;

  scenes.forEach((scene, i) => {
    const secs = scene.duration_ms / 1000;
    const n = Math.round(secs * FPS);
    frames += n;
    const imgFile = scene.image_path ? imageFiles.get(scene.image_path) : null;
    const lay = layoutScene(scene, style, !!imgFile, templateId);

    if (imgFile) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', secs.toFixed(3), '-i', imgFile);
    } else {
      inputs.push('-f', 'lavfi', '-t', secs.toFixed(3), '-i', `color=c=${lay.bg}:s=${W}x${H}:r=${FPS}`);
    }

    const f = [];
    f.push(imgFile ? `zoompan=${zoompan(lay.motion, n)}:d=1:s=${W}x${H}:fps=${FPS}` : 'null');
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
      f.push(`fade=t=in:st=0:d=${lay.fadeS}`);
      f.push(`fade=t=out:st=${Math.max(0, secs - lay.fadeS).toFixed(3)}:d=${lay.fadeS}`);
    }
    chains.push(`[${i}:v]${f.join(',')}[s${i}]`);
  });

  const labels = scenes.map((_, i) => `[s${i}]`).join('');
  chains.push(`${labels}concat=n=${scenes.length}:v=1:a=0[c]`);
  chains.push(`[c]drawbox=x=40:y=104:w=290:h=84:color=black@0.38:t=fill,drawtext=fontfile=${fontFile}:textfile=wm.txt:expansion=none:fontsize=44:fontcolor=white@0.92:shadowcolor=black@0.6:shadowx=3:shadowy=3:x=60:y=130,fps=${FPS},format=yuv420p[v]`);

  const args = ['-y', '-v', 'error', ...inputs, '-filter_complex', chains.join(';'), '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart', '-an', outName];
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
