(function () {
  'use strict';

  /* ---------------- 数据 ---------------- */
  const tracks = Array.isArray(window.PLAYLIST) ? window.PLAYLIST.filter(t => t && t.file) : [];
  const durations = new Array(tracks.length).fill(0);
  const STORE = 'besuguru.player.v2';

  const $ = id => document.getElementById(id);
  const audio = $('audio');

  const el = {
    rows: $('rows'),
    listMeta: $('listMeta'),
    empty: $('empty'),
    playAll: $('btnPlayAll'),

    nowTitle: $('nowTitle'),
    nowCur: $('nowCur'),
    nowDur: $('nowDur'),
    nowSeekBar: $('nowSeekBar'),
    nowSeekFill: $('nowSeekFill'),
    vizNow: $('vizNow'),
    vizFull: $('vizFull'),

    cur: $('cur'),
    dur: $('dur'),
    seekBar: $('seekBar'),
    seekFill: $('seekFill'),
    vol: $('vol'),

    miniTitle: $('miniTitle'),
    miniArtist: $('miniArtist'),

    btnPlay: $('btnPlay'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnShuffle: $('btnShuffle'),
    btnRepeat: $('btnRepeat'),
    repeatBadge: $('repeatBadge'),
    btnMute: $('btnMute'),

    immersive: $('immersive'),
    imTitle: $('imTitle'),
    imCur: $('imCur'),
    imDur: $('imDur'),
    imSeekBar: $('imSeekBar'),
    imSeekFill: $('imSeekFill'),
    imPlay: $('imPlay'),
    imPrev: $('imPrev'),
    imNext: $('imNext'),
    imClose: $('imClose')
  };

  const state = {
    index: -1,
    shuffle: false,
    repeat: 'all',
    muted: false,
    volume: 0.8
  };

  /* ---------------- 工具 ---------------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  function hueOf(t) {
    return hash(t.title + t.file) % 360;
  }

  function glyphOf(t) {
    const s = (t.title || '').trim();
    if (!s) return '♪';
    if (/^[A-Za-z0-9]/.test(s)) {
      const w = s.split(/\s+/)[0];
      return (w.length > 2 ? w.slice(0, 2) : w).toUpperCase();
    }
    return s.slice(0, 1);
  }

  function artistOf(t) {
    return (t.artist && t.artist.trim()) || '未知艺术家';
  }

  function tagOf(t) {
    return (t.tag && t.tag.trim()) || '';
  }

  function extOf(t) {
    return (t.file.split('.').pop() || '').toUpperCase();
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function urlOf(file) {
    return file.split('/').map(encodeURIComponent).join('/');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setFill(input) {
    if (!input) return;
    const max = Number(input.max) || 100;
    const p = Math.max(0, Math.min(1, (Number(input.value) || 0) / max));
    input.style.setProperty('--p', (p * 100).toFixed(2) + '%');
  }

  let toastTimer = 0;
  function toast(msg) {
    let node = document.querySelector('.toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = msg;
    requestAnimationFrame(() => node.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19.2 12z"/></svg>';

  /* ---------------- 音频可视化 ---------------- */
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  /* 直接把 <audio> 接入 Web Audio 做真实频谱分析 */
  const MAX_BARS = 96;
  const MIN_BARS = 28;
  const BAR_PITCH = 10; /* 目标：每根柱加缝约 10px */

  const viz = { hue: 208, ctx: null, analyser: null, data: null, raf: 0, last: 0 };

  function ensureGraph() {
    if (viz.analyser) return true;
    if (!AudioCtx) return false;
    try {
      viz.ctx = new AudioCtx();
      const src = viz.ctx.createMediaElementSource(audio);
      const an = viz.ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.78;
      src.connect(an);
      an.connect(viz.ctx.destination);
      viz.analyser = an;
      viz.data = new Uint8Array(an.frequencyBinCount);
      return true;
    } catch (e) {
      viz.analyser = null;
      return false;
    }
  }

  function readSpectrum() {
    if (!viz.analyser || !viz.data) return false;
    viz.analyser.getByteFrequencyData(viz.data);
    return true;
  }

  function barValues(n) {
    const out = new Float32Array(n);
    const bins = viz.data ? viz.data.length : 0;
    if (!bins) return out;
    for (let i = 0; i < n; i++) {
      const j = Math.min(bins - 1, Math.floor(Math.pow(i / n, 1.35) * bins * 0.92));
      out[i] = viz.data[j] / 255;
    }
    return out;
  }

  /* 分割式频谱：上下两排对称柱，中间留出黑色空档。
     柱数随画布宽度自适应，窄屏不会糊成一片。 */
  function drawBars(canvas, gapRatio) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const n = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(rect.width / BAR_PITCH)));
    const values = barValues(n);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const gap = Math.max(1, Math.round((w / n) * 0.28));
    const bw = Math.max(1, (w - gap * (n - 1)) / n);
    const half = Math.max(1, (h - h * gapRatio) / 2);

    for (let i = 0; i < n; i++) {
      const v = Math.max(0.02, values[i]);
      const bh = Math.max(bw * 0.9, v * half);
      const x = i * (bw + gap);

      /* 下半：从底边向上生长 */
      const gb = ctx.createLinearGradient(0, h, 0, h - bh);
      gb.addColorStop(0, `hsla(${viz.hue}, 92%, 58%, .95)`);
      gb.addColorStop(1, `hsla(${viz.hue}, 92%, 68%, .42)`);
      ctx.fillStyle = gb;
      ctx.fillRect(x, h - bh, bw, bh);

      /* 上半：从顶边向下垂落（镜像） */
      const gt = ctx.createLinearGradient(0, 0, 0, bh);
      gt.addColorStop(0, `hsla(${viz.hue}, 92%, 58%, .95)`);
      gt.addColorStop(1, `hsla(${viz.hue}, 92%, 68%, .42)`);
      ctx.fillStyle = gt;
      ctx.fillRect(x, 0, bw, bh);
    }
  }

  function vizLoop(ts) {
    viz.last = ts;
    readSpectrum();
    drawBars(el.vizNow, 0.34);
    drawBars(el.vizFull, 0.24);
    viz.raf = requestAnimationFrame(vizLoop);
  }

  function startViz() {
    ensureGraph();
    if (viz.ctx && viz.ctx.state === 'suspended') viz.ctx.resume().catch(() => {});
    if (viz.raf) return;
    viz.last = 0;
    viz.raf = requestAnimationFrame(vizLoop);
  }

  function stopViz() {
    if (viz.raf) cancelAnimationFrame(viz.raf);
    viz.raf = 0;
  }

  /* ---------------- 列表 ---------------- */
  function buildList() {
    el.rows.innerHTML = '';

    if (!tracks.length) {
      el.listMeta.textContent = 'music 文件夹为空';
      el.empty.hidden = false;
      el.empty.textContent = 'music 文件夹里还没有音频文件';
      return;
    }

    tracks.forEach((t, i) => {
      const row = document.createElement('tr');
      row.className = 'track-row';
      row.tabIndex = 0;
      row.dataset.i = String(i);
      row.setAttribute('aria-label', '播放 ' + t.title);

      const tag = tagOf(t);
      row.innerHTML =
        `<td class="t-no mono">${String(i + 1).padStart(2, '0')}</td>` +
        `<td class="t-main">` +
          `<span class="t-title">${escapeHTML(t.title)}</span>` +
          (t.artist && t.artist.trim()
            ? `<span class="t-sub">${escapeHTML(t.artist)}</span>`
            : ``) +
        `</td>` +
        `<td class="t-tag"><span class="badge badge-outline">${escapeHTML(tag || extOf(t))}</span></td>` +
        `<td class="t-time mono js-time">${durations[i] ? fmt(durations[i]) : '--:--'}</td>` +
        `<td class="t-act"><span class="t-play">${PLAY_ICON}</span>` +
          `<span class="eq"><i></i><i></i><i></i><i></i></span></td>`;

      el.rows.appendChild(row);
    });

    updateListMeta();
  }

  function updateListMeta() {
    const total = durations.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
    const done = durations.filter(d => d > 0).length;
    if (!tracks.length) return;
    el.listMeta.textContent = done === tracks.length
      ? `${tracks.length} 首 · 总长 ${fmt(total)}`
      : done > 0
        ? `读取时长 ${done}/${tracks.length}…`
        : `${tracks.length} 首 · 读取时长中…`;
  }

  function markPlaying() {
    el.rows.querySelectorAll('tr.track-row').forEach(row => {
      row.classList.toggle('is-playing', Number(row.dataset.i) === state.index);
    });
  }

  /* 逐个读取音频时长（元数据） */
  function probeDurations() {
    if (!tracks.length) return;
    const probe = new Audio();
    probe.preload = 'metadata';
    let i = 0;

    const next = () => {
      if (i >= tracks.length) {
        updateListMeta();
        return;
      }
      const idx = i++;
      let done = false;

      const finish = ok => {
        if (done) return;
        done = true;
        probe.onloadedmetadata = null;
        probe.onerror = null;
        if (ok && isFinite(probe.duration) && probe.duration > 0) {
          durations[idx] = probe.duration;
          const cell = el.rows.querySelector(`tr[data-i="${idx}"] .js-time`);
          if (cell) cell.textContent = fmt(probe.duration);
          updateListMeta();
        }
        setTimeout(next, 30);
      };

      probe.onloadedmetadata = () => finish(true);
      probe.onerror = () => finish(false);
      probe.src = urlOf(tracks[idx].file);
    };

    next();
  }

  /* ---------------- 界面刷新 ---------------- */
  function paint(t) {
    if (!t) {
      el.nowTitle.textContent = '选择一首歌开始';
      el.miniTitle.textContent = '未播放';
      el.miniArtist.textContent = '—';
      el.imTitle.textContent = '—';
      return;
    }

    el.nowTitle.textContent = t.title;
    el.miniTitle.textContent = t.title;
    el.miniArtist.textContent = [tagOf(t), extOf(t)].filter(Boolean).join(' · ');
    el.imTitle.textContent = t.title;
  }

  function paintProgress() {
    /* 拖动进度时不要用播放位置覆盖预览 */
    if ([el.seekBar, el.nowSeekBar, el.imSeekBar].some(b => b && b.dataset.drag === '1')) return;

    const d = audio.duration;
    const c = audio.currentTime;
    const ok = isFinite(d) && d > 0;
    const pct = ok ? Math.min(1, c / d) : 0;

    [[el.seekBar, el.seekFill], [el.nowSeekBar, el.nowSeekFill], [el.imSeekBar, el.imSeekFill]]
      .forEach(([bar, fill]) => {
        if (!bar || !fill || bar.dataset.drag === '1') return;
        fill.style.width = (pct * 100).toFixed(2) + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      });

    const text = fmt(c) === '--:--' ? '00:00' : fmt(c);
    const total = ok ? fmt(d) : '00:00';
    el.cur.textContent = text;
    el.nowCur.textContent = text;
    el.imCur.textContent = text;
    el.dur.textContent = total;
    el.nowDur.textContent = total;
    el.imDur.textContent = total;
  }

  function paintButtons() {
    document.body.classList.toggle('is-playing', !audio.paused && !!audio.src);
    document.body.classList.toggle('is-paused', audio.paused);
    document.body.classList.toggle('is-muted', state.muted || audio.volume === 0);

    el.btnShuffle.classList.toggle('active', state.shuffle);
    el.btnShuffle.setAttribute('aria-pressed', String(state.shuffle));
    el.btnRepeat.classList.toggle('active', state.repeat !== 'off');
    el.btnRepeat.setAttribute('aria-pressed', String(state.repeat !== 'off'));
    el.repeatBadge.hidden = state.repeat !== 'one';
    setFill(el.vol);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    }
  }

  /* ---------------- 播放控制 ---------------- */
  function load(i, autoplay) {
    if (i < 0 || i >= tracks.length) return;
    state.index = i;
    const t = tracks[i];

    audio.src = urlOf(t.file);
    audio.load();

    paint(t);
    markPlaying();
    paintProgress();
    paintButtons();
    updateMediaSession(t);
    save();

    if (autoplay) audio.play().catch(() => toast('无法播放：' + t.title));
  }

  function playAudio() {
    if (state.index < 0) {
      if (!tracks.length) return;
      load(firstVisibleIndex(), true);
      return;
    }
    audio.play().catch(() => toast('无法播放：' + tracks[state.index].title));
  }

  function toggle() {
    if (state.index < 0) return playAudio();
    if (audio.paused) playAudio();
    else audio.pause();
  }

  function firstVisibleIndex() {
    const visible = [...el.rows.querySelectorAll('tr.track-row')].find(r => r.style.display !== 'none');
    return visible ? Number(visible.dataset.i) : 0;
  }

  function next(auto) {
    if (!tracks.length) return;
    if (auto && state.repeat === 'one') {
      audio.currentTime = 0;
      playAudio();
      return;
    }

    let i;
    if (state.shuffle && tracks.length > 1) {
      do { i = Math.floor(Math.random() * tracks.length); } while (i === state.index);
    } else {
      i = state.index + 1;
    }

    if (i >= tracks.length) {
      i = 0;
      if (auto && state.repeat === 'off') {
        audio.pause();
        audio.currentTime = 0;
        paintProgress();
        paintButtons();
        return;
      }
    }
    load(i, true);
  }

  function prev() {
    if (!tracks.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    let i = state.index - 1;
    if (i < 0) i = tracks.length - 1;
    load(i, true);
  }

  /* ---------------- 进度 / 音量 ---------------- */
  function bindSeekBar(bar, fill) {
    if (!bar || !fill) return;

    let dragging = false;
    let pending = null;

    const ratioOf = e => {
      const r = bar.getBoundingClientRect();
      const width = r.width || bar.offsetWidth;
      if (!width) return 0;
      return Math.max(0, Math.min(1, (e.clientX - r.left) / width));
    };

    /* 拖动过程中只更新画面，不反复改 currentTime，
       否则连续 seek 会让部分格式（尤其 mp4）跳回 0。 */
    const show = ratio => {
      fill.style.width = (ratio * 100).toFixed(2) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      const d = audio.duration;
      if (!isFinite(d) || d <= 0) return;
      const text = fmt(ratio * d);
      el.cur.textContent = text;
      el.nowCur.textContent = text;
      el.imCur.textContent = text;
    };

    const commit = () => {
      const d = audio.duration;
      if (pending == null || !isFinite(d) || d <= 0) return;
      audio.currentTime = Math.min(d - 0.1, pending * d);
    };

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      delete bar.dataset.drag;
      commit();
      pending = null;
      paintProgress();
    };

    bar.addEventListener('pointerdown', e => {
      if (typeof e.button === 'number' && e.button !== 0) return;
      dragging = true;
      bar.dataset.drag = '1';
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      pending = ratioOf(e);
      show(pending);
      e.preventDefault();
    });

    bar.addEventListener('pointermove', e => {
      if (!dragging) return;
      if (e.buttons === 0) { finish(); return; }
      pending = ratioOf(e);
      show(pending);
    });

    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', finish);
    /* 手指/鼠标在进度条外松开时也能结束拖动 */
    window.addEventListener('pointerup', finish);

    bar.addEventListener('keydown', e => {
      const d = audio.duration;
      if (!isFinite(d) || d <= 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        audio.currentTime = Math.min(d, audio.currentTime + 5);
      }
    });
  }

  function setVolume(v, persist) {
    state.volume = Math.max(0, Math.min(1, v));
    audio.volume = state.volume;
    state.muted = state.volume === 0;
    audio.muted = state.muted;
    el.vol.value = String(Math.round(state.volume * 100));
    paintButtons();
    if (persist) save();
  }

  /* ---------------- 沉浸模式 ---------------- */
  function setImmersive(on) {
    el.immersive.classList.toggle('open', on);
    el.immersive.setAttribute('aria-hidden', on ? 'false' : 'true');
    document.body.style.overflow = on ? 'hidden' : '';
  }

  /* ---------------- Media Session ---------------- */
  function updateMediaSession(t) {
    if (!('mediaSession' in navigator)) return;
    try {
      const art = artworkURL(t);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: artistOf(t),
        album: 'Be Suguru',
        artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : []
      });
    } catch (e) { /* 忽略 */ }
  }

  function artworkURL(t) {
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;

    const h = hueOf(t);
    const base = ctx.createLinearGradient(0, 0, size, size);
    base.addColorStop(0, `hsl(${h} 45% 16%)`);
    base.addColorStop(1, `hsl(${(h + 140) % 360} 50% 8%)`);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(size * .3, size * .24, 0, size * .3, size * .24, size * .8);
    glow.addColorStop(0, `hsla(${h} 76% 66% / .4)`);
    glow.addColorStop(1, 'hsla(0 0% 0% / 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '700 200px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyphOf(t), size / 2, size / 2 + 8);
    return cv.toDataURL('image/png');
  }

  /* ---------------- 存档 ---------------- */
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        index: state.index,
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat
      }));
    } catch (e) { /* 忽略 */ }
  }

  function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { data = null; }

    if (data) {
      state.shuffle = !!data.shuffle;
      state.repeat = data.repeat === 'one' || data.repeat === 'off' ? data.repeat : 'all';
      /* 旧存档可能两者同时为真，这里做一次纠正 */
      if (state.shuffle) state.repeat = 'off';
      setVolume(typeof data.volume === 'number' ? data.volume : 0.8, false);
      if (tracks.length && Number.isInteger(data.index) && data.index >= 0 && data.index < tracks.length) {
        load(data.index, false);
        return;
      }
    } else {
      setVolume(0.8, false);
    }

    paint(tracks[0] || null);
  }

  /* ---------------- 事件 ---------------- */
  el.rows.addEventListener('click', e => {
    const row = e.target.closest('tr.track-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (i === state.index) toggle();
    else load(i, true);
  });

  el.rows.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr.track-row');
    if (!row) return;
    e.preventDefault();
    const i = Number(row.dataset.i);
    if (i === state.index) toggle();
    else load(i, true);
  });

  el.playAll.addEventListener('click', () => load(firstVisibleIndex(), true));

  el.btnPlay.addEventListener('click', toggle);
  el.imPlay.addEventListener('click', toggle);
  el.btnPrev.addEventListener('click', prev);
  el.imPrev.addEventListener('click', prev);
  el.btnNext.addEventListener('click', () => next(false));
  el.imNext.addEventListener('click', () => next(false));

  /* 随机与循环互斥：开启一个会自动关闭另一个 */
  el.btnShuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    if (state.shuffle) state.repeat = 'off';
    paintButtons();
    save();
  });

  el.btnRepeat.addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    if (state.repeat !== 'off') state.shuffle = false;
    paintButtons();
    save();
  });

  el.btnMute.addEventListener('click', () => {
    if (state.muted || audio.volume === 0) {
      state.muted = false;
      audio.muted = false;
      audio.volume = state.volume || 0.8;
      el.vol.value = String(Math.round((state.volume || 0.8) * 100));
    } else {
      state.muted = true;
      audio.muted = true;
    }
    paintButtons();
    save();
  });

  el.vol.addEventListener('input', () => setVolume(Number(el.vol.value) / 100, true));

  [$('btnImmersive'), $('btnImmersive2')].forEach(btn => {
    if (btn) btn.addEventListener('click', () => setImmersive(true));
  });
  el.imClose.addEventListener('click', () => setImmersive(false));
  el.immersive.addEventListener('click', e => {
    if (e.target === el.immersive) setImmersive(false);
  });

  bindSeekBar(el.seekBar, el.seekFill);
  bindSeekBar(el.nowSeekBar, el.nowSeekFill);
  bindSeekBar(el.imSeekBar, el.imSeekFill);

  audio.addEventListener('play', () => { paintButtons(); startViz(); });
  audio.addEventListener('pause', () => { paintButtons(); stopViz(); });
  audio.addEventListener('timeupdate', paintProgress);
  audio.addEventListener('seeked', paintProgress);
  audio.addEventListener('loadedmetadata', paintProgress);
  audio.addEventListener('durationchange', paintProgress);
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('error', () => {
    if (state.index < 0) return;
    toast('播放失败：' + tracks[state.index].title + '（格式可能不被浏览器支持）');
  });

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (typing) return;
    if (e.key === ' ' && e.target.closest && e.target.closest('button')) return;
    if (e.target.classList && e.target.classList.contains('seek')) return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        toggle();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(state.volume + 0.05, true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(state.volume - 0.05, true);
        break;
      case 'm':
      case 'M':
        el.btnMute.click();
        break;
      case 'n':
      case 'N':
        next(false);
        break;
      case 'p':
      case 'P':
        prev();
        break;
      case 'f':
      case 'F':
        setImmersive(!el.immersive.classList.contains('open'));
        break;
      case 'Escape':
        setImmersive(false);
        break;
    }
  });

  if ('mediaSession' in navigator) {
    const actions = {
      play: () => playAudio(),
      pause: () => audio.pause(),
      previoustrack: prev,
      nexttrack: () => next(false),
      seekbackward: () => { audio.currentTime = Math.max(0, audio.currentTime - 10); },
      seekforward: () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); }
    };
    Object.keys(actions).forEach(k => {
      try { navigator.mediaSession.setActionHandler(k, actions[k]); } catch (e) { /* 忽略 */ }
    });
  }

  window.addEventListener('resize', () => {
    if (viz.raf) return;
    readSpectrum();
    drawBars(el.vizNow, 0.34);
    drawBars(el.vizFull, 0.24);
  });

  /* ---------------- 启动 ---------------- */
  buildList();
  restore();
  setFill(el.vol);
  paintProgress();
  paintButtons();
  probeDurations();
})();
