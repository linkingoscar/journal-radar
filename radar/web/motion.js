'use strict';
const JournalMotion = (() => {
  // GetStream's SwiftUI examples inform the use of smooth/snappy springs and
  // velocity-preserving retargeting. This integrator uses the spring equation;
  // it does not embed the SwiftUI implementation. See docs/interface-effects.md.
  const presets = {
    smooth: { stiffness: 420, damping: 41 },
    snappy: { stiffness: 540, damping: 32 },
  };
  class Spring {
    constructor(
      values,
      paint,
      {
        preset = 'snappy',
        request = (callback) => requestAnimationFrame(callback),
        cancel = (frame) => cancelAnimationFrame(frame),
      } = {},
    ) {
      this.values = { ...values };
      this.target = { ...values };
      this.velocity = Object.fromEntries(Object.keys(values).map((key) => [key, 0]));
      this.paint = paint;
      this.options = presets[preset];
      this.request = request;
      this.cancel = cancel;
      this.frame = null;
      this.time = null;
    }
    to(target, immediate = false) {
      Object.assign(this.target, target);
      if (immediate) {
        this.stop();
        Object.assign(this.values, this.target);
        for (const key of Object.keys(this.velocity)) this.velocity[key] = 0;
        this.paint(this.values);
      } else if (this.frame === null && !this.settled()) {
        this.time = null;
        this.frame = this.request((time) => this.tick(time));
      }
    }
    settled() {
      return Object.keys(this.values).every(
        (key) =>
          Math.abs(this.target[key] - this.values[key]) < 0.001 &&
          Math.abs(this.velocity[key]) < 0.01,
      );
    }
    step(seconds) {
      // Bounded substeps keep a delayed frame stable without reading layout.
      let remaining = Math.min(Math.max(seconds, 0), 0.064);
      const { stiffness, damping } = this.options;
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 120);
        for (const key of Object.keys(this.values)) {
          this.velocity[key] +=
            (stiffness * (this.target[key] - this.values[key]) - damping * this.velocity[key]) * dt;
          this.values[key] += this.velocity[key] * dt;
        }
        remaining -= dt;
      }
    }
    tick(time) {
      this.frame = null;
      this.step(this.time === null ? 1 / 60 : (time - this.time) / 1000);
      this.time = time;
      if (this.settled()) {
        Object.assign(this.values, this.target);
        for (const key of Object.keys(this.velocity)) this.velocity[key] = 0;
      } else this.frame = this.request((next) => this.tick(next));
      this.paint(this.values);
    }
    stop() {
      if (this.frame !== null) this.cancel(this.frame);
      this.frame = null;
      this.time = null;
    }
  }
  function connect(document) {
    const root = document.documentElement,
      media = matchMedia('(prefers-reduced-motion: reduce)'),
      springs = new Set(),
      reveals = new WeakMap();
    const reduced = () => media.matches || root.dataset.effects === 'reduced';
    const refresh = () => {
      if (reduced()) for (const spring of springs) spring.to(spring.target, true);
    };
    media.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(root, {
      attributes: true,
      attributeFilter: ['data-effects'],
    });
    function spring(values, paint, options) {
      const instance = new Spring(values, paint, options);
      springs.add(instance);
      return instance;
    }
    for (const group of document.querySelectorAll(
      '#groups, .browse-modes, .catalog-layout, .tabs, .archive-modes',
    )) {
      const pill = document.createElement('span');
      pill.className = 'selection-pill';
      pill.setAttribute('aria-hidden', 'true');
      group.prepend(pill);
      group.classList.add('motion-segment');
      let movement = null,
        base = null,
        pending = false;
      const update = () => {
        pending = false;
        // The sidebar rebuilds its buttons when journal groups change.
        if (!pill.isConnected) group.prepend(pill);
        const selected = group.querySelector('[aria-pressed="true"], [aria-current="page"]');
        if (!selected || !selected.offsetWidth) return;
        const box = {
          x: selected.offsetLeft,
          y: selected.offsetTop,
          width: selected.offsetWidth,
          height: selected.offsetHeight,
        };
        if (!movement) {
          base = box;
          pill.style.width = base.width + 'px';
          pill.style.height = base.height + 'px';
          movement = spring(box, (value) => {
            pill.style.transform = `translate3d(${value.x}px, ${value.y}px, 0) scale(${value.width / base.width}, ${value.height / base.height})`;
          });
          movement.to(box, true);
          group.dataset.selectionReady = 'true';
        } else movement.to(box, reduced());
      };
      const schedule = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(update);
      };
      new MutationObserver(schedule).observe(group, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-pressed', 'aria-current'],
      });
      new ResizeObserver(schedule).observe(group);
      update();
    }
    function reveal(element, direction = 0) {
      const previous = reveals.get(element);
      if (previous) {
        previous.stop();
        springs.delete(previous);
      }
      if (reduced()) {
        element.style.removeProperty('transform');
        element.style.removeProperty('opacity');
        return;
      }
      const instance = spring(
        { progress: 0 },
        ({ progress }) => {
          const distance = (1 - progress) * (direction ? 24 : 18);
          element.style.transform = direction
            ? `translate3d(${distance * direction}px, 0, 0)`
            : `translate3d(0, ${distance}px, 0)`;
          element.style.opacity = String(Math.min(1, 0.3 + progress * 0.7));
          if (progress === 1) {
            element.style.removeProperty('transform');
            element.style.removeProperty('opacity');
            springs.delete(instance);
            reveals.delete(element);
          }
        },
        { preset: 'smooth' },
      );
      reveals.set(element, instance);
      instance.paint(instance.values);
      instance.to({ progress: 1 });
    }
    return { reduced, spring, reveal };
  }
  return { Spring, connect };
})();
if (typeof module !== 'undefined') module.exports = JournalMotion;
