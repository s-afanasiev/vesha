(function (global) {
  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function rgbToHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        default:
          h = ((r - g) / d + 4) / 6;
      }
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  /** Photoshop-style HSB (= HSV) */
  function rgbToHsb(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        default:
          h = ((r - g) / d + 4) / 6;
      }
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      b: Math.round(v * 100),
    };
  }

  function rgbToCmyk(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
    const c = (1 - r - k) / (1 - k);
    const m = (1 - g - k) / (1 - k);
    const y = (1 - b - k) / (1 - k);
    return {
      c: Math.round(c * 100),
      m: Math.round(m * 100),
      y: Math.round(y * 100),
      k: Math.round(k * 100),
    };
  }

  function colorFormats(r, g, b) {
    const hex = rgbToHex(r, g, b);
    const hsl = rgbToHsl(r, g, b);
    const hsb = rgbToHsb(r, g, b);
    const cmyk = rgbToCmyk(r, g, b);
    return {
      hex,
      rgb: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
      rgbValues: `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`,
      hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hslValues: `${hsl.h}, ${hsl.s}%, ${hsl.l}%`,
      hsb: `hsb(${hsb.h}, ${hsb.s}%, ${hsb.b}%)`,
      hsbValues: `${hsb.h}°, ${hsb.s}%, ${hsb.b}%`,
      cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cmykValues: `${cmyk.c}, ${cmyk.m}, ${cmyk.y}, ${cmyk.k}`,
    };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось загрузить изображение для цветов'));
      img.src = url;
    });
  }

  function normalizeBbox(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const w = Number(raw.w);
    const h = Number(raw.h);
    if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
    if (w <= 0.01 || h <= 0.01) return null;
    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      w: clamp(w, 0, 1),
      h: clamp(h, 0, 1),
    };
  }

  /**
   * Extract dominant colors via bucket quantization.
   * If bbox {x,y,w,h} in 0..1 is provided — sample ONLY inside it.
   */
  async function extractDominantColors(
    imageUrl,
    { maxColors = 6, sampleSize = 160, bbox = null } = {}
  ) {
    const img = await loadImage(imageUrl);
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    const box = normalizeBbox(bbox);

    const fullW = Math.min(sampleSize, natW);
    const fullH = Math.min(
      sampleSize,
      Math.round((natH / natW) * fullW) || sampleSize
    );

    const canvas = document.createElement('canvas');
    canvas.width = fullW;
    canvas.height = fullH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, fullW, fullH);
    const { data } = ctx.getImageData(0, 0, fullW, fullH);

    let x0 = 0;
    let y0 = 0;
    let x1 = fullW;
    let y1 = fullH;
    if (box) {
      x0 = Math.floor(box.x * fullW);
      y0 = Math.floor(box.y * fullH);
      x1 = Math.ceil((box.x + box.w) * fullW);
      y1 = Math.ceil((box.y + box.h) * fullH);
      x0 = clamp(x0, 0, fullW - 1);
      y0 = clamp(y0, 0, fullH - 1);
      x1 = clamp(x1, x0 + 1, fullW);
      y1 = clamp(y1, y0 + 1, fullH);
    }

    const buckets = new Map();
    let totalWeight = 0;
    const step = 4;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * fullW + x) * 4;
        const a = data[i + 3];
        if (a < 200) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        // Inside clothing bbox keep light/dark fabric; only skip pure white blowouts
        if (max > 252 && min > 248) continue;

        const key = (r >> step) + ',' + (g >> step) + ',' + (b >> step);
        const sat = max === 0 ? 0 : (max - min) / max;
        const weight = 1 + sat * 0.75;
        const prev = buckets.get(key);
        if (prev) {
          prev.w += weight;
          prev.r += r * weight;
          prev.g += g * weight;
          prev.b += b * weight;
        } else {
          buckets.set(key, { w: weight, r: r * weight, g: g * weight, b: b * weight });
        }
        totalWeight += weight;
      }
    }

    if (!totalWeight) return [];

    const list = Array.from(buckets.values())
      .map((c) => ({
        r: c.r / c.w,
        g: c.g / c.w,
        b: c.b / c.w,
        w: c.w,
      }))
      .sort((a, b) => b.w - a.w);

    const merged = [];
    for (const c of list) {
      const near = merged.find((m) => {
        const dr = m.r - c.r;
        const dg = m.g - c.g;
        const db = m.b - c.b;
        return dr * dr + dg * dg + db * db < 1400;
      });
      if (near) {
        const tw = near.w + c.w;
        near.r = (near.r * near.w + c.r * c.w) / tw;
        near.g = (near.g * near.w + c.g * c.w) / tw;
        near.b = (near.b * near.w + c.b * c.w) / tw;
        near.w = tw;
      } else {
        merged.push({ ...c });
      }
    }

    merged.sort((a, b) => b.w - a.w);
    const top = merged.slice(0, maxColors);
    const sum = top.reduce((s, c) => s + c.w, 0) || 1;

    return top.map((c) => {
      const r = Math.round(c.r);
      const g = Math.round(c.g);
      const b = Math.round(c.b);
      const percent = Math.round((c.w / sum) * 1000) / 10;
      return {
        r,
        g,
        b,
        percent,
        formats: colorFormats(r, g, b),
      };
    });
  }

  global.PodborkaColors = {
    extractDominantColors,
    colorFormats,
    rgbToHex,
    normalizeBbox,
  };
})(window);
