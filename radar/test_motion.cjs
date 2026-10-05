const test = require('node:test'),
  assert = require('node:assert/strict'),
  { Spring } = require('./web/motion.js');

function fixture(preset = 'snappy') {
  const frames = new Map();
  let id = 0;
  const spring = new Spring({ x: 0 }, () => {}, {
    preset,
    request: (callback) => {
      frames.set(++id, callback);
      return id;
    },
    cancel: (frame) => frames.delete(frame),
  });
  const frame = (time) => {
    const next = frames.entries().next().value;
    assert.ok(next, 'expected an active animation');
    frames.delete(next[0]);
    next[1](time);
  };
  return { spring, frames, frame };
}

test('an interrupted spring retains position and momentum, then settles at the latest target', () => {
  const { spring, frames, frame } = fixture();
  spring.to({ x: 100 });
  for (let time = 0; time <= 80; time += 16) frame(time);
  const position = spring.values.x,
    velocity = spring.velocity.x;
  assert.ok(position > 0 && position < 100);
  assert.ok(velocity > 0);
  spring.to({ x: -30 });
  assert.equal(spring.values.x, position);
  assert.equal(spring.velocity.x, velocity);
  assert.equal(frames.size, 1, 'repeated input must not enqueue extra animations');
  for (let time = 96; frames.size && time < 2000; time += 16) frame(time);
  assert.equal(spring.values.x, -30);
  assert.equal(spring.velocity.x, 0);
  assert.equal(frames.size, 0, 'a settled spring must stop rendering');
});

test('snappy has a restrained overshoot while smooth reading motion remains monotonic', () => {
  for (const preset of ['snappy', 'smooth']) {
    const { spring, frames, frame } = fixture(preset);
    spring.to({ x: 1 });
    const positions = [];
    for (let time = 0; frames.size && time < 2000; time += 8) {
      frame(time);
      positions.push(spring.values.x);
    }
    const peak = Math.max(...positions);
    if (preset === 'snappy')
      assert.ok(peak > 1.005 && peak < 1.1, 'selection should settle with a small bounce');
    else {
      assert.ok(peak <= 1);
      assert.ok(positions.every((position, index) => !index || position >= positions[index - 1]));
    }
    assert.equal(spring.values.x, 1);
  }
});

test('reducing effects stops an in-flight spring immediately, and a paused tab stays stable', () => {
  const { spring, frames, frame } = fixture();
  spring.to({ x: 100 });
  frame(0);
  frame(60000);
  assert.ok(Number.isFinite(spring.values.x) && Math.abs(spring.values.x) < 150);
  spring.to({ x: 20 }, true);
  assert.equal(frames.size, 0);
  assert.equal(spring.values.x, 20);
  assert.equal(spring.velocity.x, 0);
  spring.to({ x: 50 });
  for (let time = 60016; frames.size && time < 62000; time += 16) frame(time);
  assert.equal(spring.values.x, 50);
});
