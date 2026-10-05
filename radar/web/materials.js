'use strict';
const JournalMaterials = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function svg(document, name, attributes, parent) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent?.append(node);
    return node;
  }
  // An edge-normal map: R/B encode displacement, G encodes the edge mask.
  // Only the rim bends; the center remains optically neutral.
  function lensMap(document, width, height, radius) {
    const canvas = document.createElement('canvas'),
      ratio = Math.min(1, 640 / width);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(canvas.width, canvas.height),
      rim = Math.min(16, height / 3);
    radius = Math.min(radius, width / 2, height / 2);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const px = (x + 0.5) / ratio,
          py = (y + 0.5) / ratio;
        const cx = Math.max(radius, Math.min(width - radius, px)),
          cy = Math.max(radius, Math.min(height - radius, py));
        let nx = px - cx,
          ny = py - cy,
          distance;
        const length = Math.hypot(nx, ny);
        if (length) {
          distance = radius - length;
          nx /= length;
          ny /= length;
        } else {
          const distances = [px, width - px, py, height - py];
          distance = Math.min(...distances);
          const side = distances.indexOf(distance);
          nx = side === 0 ? -1 : side === 1 ? 1 : 0;
          ny = side === 2 ? -1 : side === 3 ? 1 : 0;
        }
        const bend = distance > 0 && distance < rim ? Math.sin((Math.PI * distance) / rim) : 0,
          offset = (y * canvas.width + x) * 4;
        image.data[offset] = 128 + nx * bend * 127;
        image.data[offset + 1] = bend * 255;
        image.data[offset + 2] = 128 + ny * bend * 127;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }
  function filter(document, parent, id) {
    // Adapted from rdev/liquid-glass-react's GlassFilter: separate RGB
    // displacement, recombination, edge composite and an untouched center.
    // Copyright 2025 MAX ROVENSKY. MIT: liquid-glass-LICENSE.txt.
    const node = svg(
        document,
        'filter',
        {
          id,
          'color-interpolation-filters': 'sRGB',
          filterUnits: 'userSpaceOnUse',
          x: -16,
          y: -16,
        },
        parent,
      ),
      map = svg(
        document,
        'feImage',
        { result: 'lens-map', x: 0, y: 0, preserveAspectRatio: 'none' },
        node,
      );
    svg(
      document,
      'feColorMatrix',
      {
        in: 'lens-map',
        type: 'matrix',
        values: '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 1 0 0 0',
        result: 'rim',
      },
      node,
    );
    for (const [channel, scale, matrix] of [
      ['red', 18, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'],
      ['green', 19, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'],
      ['blue', 20, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'],
    ]) {
      svg(
        document,
        'feDisplacementMap',
        {
          in: 'SourceGraphic',
          in2: 'lens-map',
          scale: scale * 0.55,
          xChannelSelector: 'R',
          yChannelSelector: 'B',
          result: channel + '-shift',
        },
        node,
      );
      svg(
        document,
        'feColorMatrix',
        { in: channel + '-shift', type: 'matrix', values: matrix, result: channel },
        node,
      );
    }
    svg(document, 'feBlend', { in: 'green', in2: 'blue', mode: 'screen', result: 'gb' }, node);
    svg(document, 'feBlend', { in: 'red', in2: 'gb', mode: 'screen', result: 'rgb' }, node);
    svg(document, 'feGaussianBlur', { in: 'rgb', stdDeviation: 0.35, result: 'soft-rgb' }, node);
    svg(
      document,
      'feComposite',
      { in: 'soft-rgb', in2: 'rim', operator: 'in', result: 'edge' },
      node,
    );
    const inverse = svg(
      document,
      'feComponentTransfer',
      { in: 'rim', result: 'center-mask' },
      node,
    );
    svg(document, 'feFuncA', { type: 'table', tableValues: '1 0' }, inverse);
    svg(
      document,
      'feComposite',
      { in: 'SourceGraphic', in2: 'center-mask', operator: 'in', result: 'center' },
      node,
    );
    svg(document, 'feComposite', { in: 'edge', in2: 'center', operator: 'over' }, node);
    return { node, map };
  }
  function connect(document, motion) {
    const root = document.documentElement,
      transparency = matchMedia('(prefers-reduced-transparency: reduce)'),
      reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'),
      contrast = matchMedia('(prefers-contrast: more)'),
      forced = matchMedia('(forced-colors: active)');
    // rdev also documents that Safari/Firefox do not render displacement.
    // Syntax acceptance alone cannot establish that this optical path works.
    const optics =
        /Chrome|Chromium|Edg\//.test(navigator.userAgent) &&
        !/Android.*wv|CriOS/.test(navigator.userAgent) &&
        CSS.supports('backdrop-filter', 'blur(1px)'),
      surfaces = [],
      host = svg(document, 'svg', {
        class: 'glass-filters',
        'aria-hidden': 'true',
        width: 0,
        height: 0,
        focusable: 'false',
      });
    document.body.append(host);
    const defs = svg(document, 'defs', {}, host);
    const solid = () =>
      root.dataset.effects === 'reduced' ||
      transparency.matches ||
      contrast.matches ||
      forced.matches;
    function refresh() {
      for (const surface of surfaces) {
        surface.element.dataset.material = solid() ? 'solid' : optics ? 'optical' : 'frosted';
        if (motion.reduced()) surface.response.to({ x: 0, y: 0, sx: 1, sy: 1 }, true);
      }
    }
    for (const element of document.querySelectorAll(
      '.topbar, .browse-modes, .dialog-head, .reader-navigation',
    )) {
      const warp = document.createElement('span');
      warp.className = 'glass-warp';
      warp.setAttribute('aria-hidden', 'true');
      element.prepend(warp);
      element.classList.add('glass-surface');
      const id = 'radar-lens-' + surfaces.length,
        lens = optics ? filter(document, defs, id) : null,
        response = motion.spring({ x: 0, y: 0, sx: 1, sy: 1 }, (value) => {
          warp.style.transform = `translate3d(${value.x}px, ${value.y}px, 0) scale(${value.sx}, ${value.sy})`;
        });
      surfaces.push({ element, response });
      if (lens) {
        let size = '';
        new ResizeObserver(() => {
          const width = element.clientWidth,
            height = element.clientHeight,
            next = width + ':' + height;
          if (!width || !height || size === next) return;
          size = next;
          const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius);
          const url = lensMap(document, width, height, radius);
          if (!url) return;
          lens.node.setAttribute('width', width + 32);
          lens.node.setAttribute('height', height + 32);
          lens.map.setAttribute('width', width);
          lens.map.setAttribute('height', height);
          lens.map.setAttribute('href', url);
          warp.style.filter = `url("#${id}")`;
        }).observe(element);
      }
      let pointer = null,
        pending = false,
        pressed = false;
      const paintPointer = () => {
        pending = false;
        if (!pointer || solid()) return;
        const rect = element.getBoundingClientRect(),
          x = Math.max(-1, Math.min(1, ((pointer.clientX - rect.left) / rect.width) * 2 - 1)),
          y = Math.max(-1, Math.min(1, ((pointer.clientY - rect.top) / rect.height) * 2 - 1));
        element.style.setProperty('--glass-x', (x + 1) * 50 + '%');
        element.style.setProperty('--glass-y', (y + 1) * 50 + '%');
        element.style.setProperty('--glass-angle', 125 + x * 35 + 'deg');
        if (!motion.reduced())
          response.to({
            x: x * 1.4,
            y: y * 0.8,
            sx: pressed
              ? 1 - Math.min(0.02, 2 / rect.width)
              : 1 + Math.abs(x) * Math.min(0.012, 3 / rect.width),
            sy: pressed ? 0.96 : 1 + Math.abs(y) * 0.015,
          });
      };
      const track = (event) => {
        pointer = event;
        if (!pending) {
          pending = true;
          requestAnimationFrame(paintPointer);
        }
      };
      const release = () => {
        pressed = false;
        pointer = null;
        response.to({ x: 0, y: 0, sx: 1, sy: 1 }, motion.reduced());
      };
      element.addEventListener('pointermove', track, { passive: true });
      element.addEventListener(
        'pointerdown',
        (event) => {
          pressed = !!event.target.closest('button:enabled, a');
          track(event);
        },
        { passive: true },
      );
      element.addEventListener('pointerleave', release);
      element.addEventListener('pointercancel', release);
      element.addEventListener('pointerup', release);
    }
    for (const media of [transparency, reducedMotion, contrast, forced])
      media.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(root, {
      attributes: true,
      attributeFilter: ['data-effects'],
    });
    refresh();
  }
  return { connect };
})();
