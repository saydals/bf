# Blackbox Freeze Fix 2 — Race condition in animationLoop

## Problem

Clicking the 3 override buttons (Expo, Smoothing, Grid) in `<LegendPanel>` causes the blackbox viewer to freeze with:

```
Uncaught TypeError: Cannot read properties of null (reading 'render')
    at J7e.render (main-...js:4281:28479)
    at s9 (main-...js:4285:13115)
```

`J7e` is `FlightLogGrapher` instance's `.render` method. The error occurs when `t.graph.render()` is called but `t.graph` is null.

## Root Cause

In `src/blackbox-viewer/playback_controls.js:animationLoop()`:

1. Line 45: `if (!graphStore.graph)` — null check exists
2. Line 69: `graphStore.graph.render(logStore.currentBlackboxTime)` — render call

**Race condition**: Between the null check on line 45 and the render call on line 69, `graphStore.graph` can be set to `null` (e.g., by `setViewerActive(false)` teardown triggering canvas unmount). The check does not protect against this because JavaScript is single-threaded but async RAF callbacks can interleave via `requestAnimationFrame`.

The stack trace `J7e.render → s9` confirms: `s9` (`animationLoop`) calls `t.graph.render(...)` (i.e., `J7e.render`) when `t.graph` is null.

## Fix

**Capture `graphStore.graph` as a local `const` early in `animationLoop`, before any potential mutation, and use that local variable for both the null check and the render call.** This prevents the race because the local variable holds a reference captured at function entry.

### Before (lines 38-69):

```js
export function animationLoop() {
    ensureThrottles();
    const now = Date.now();
    const graphStore = useGraphStore(pinia);
    const logStore = useLogStore(pinia);
    const playbackStore = usePlaybackStore(pinia);

    if (!graphStore.graph) {
        animationFrameIsQueued = false;
        return;
    }

    // ... some logic ...

    graphStore.graph.render(logStore.currentBlackboxTime);  // RACE: graph could be null here

    graphStore.seekBar.setCurrentTime(logStore.currentBlackboxTime);
    // ...
}
```

### After:

```js
export function animationLoop() {
    ensureThrottles();
    const now = Date.now();
    const graphStore = useGraphStore(pinia);
    const logStore = useLogStore(pinia);
    const playbackStore = usePlaybackStore(pinia);

    const graph = graphStore.graph;  // ← CAPTURE LOCAL: race prevented

    if (!graph) {
        animationFrameIsQueued = false;
        return;
    }

    // ... same logic ...

    graph.render(logStore.currentBlackboxTime);  // ← USE LOCAL: null deref impossible

    graphStore.seekBar.setCurrentTime(logStore.currentBlackboxTime);
    // ...
}
```

## Verification

- Build: `npm run build` — should succeed
- The local `graph` variable holds the graph reference captured at function entry
- Even if `graphStore.graph` is later set to null (e.g., by teardown), the local `graph` variable still holds the valid reference
- The render call `graph.render(...)` will either render successfully or throw a controlled error, but will NOT be `Cannot read properties of null (reading 'render')` from the RAF loop

## Related Fixes (for future)

- **P1**: In `setViewerActive(false)`, cancel pending RAF frames or set `animationFrameIsQueued = false` to prevent queued frames from executing after teardown
- **P2**: Unify `grapher.js`'s `useGraphStore()` (no pinia) to `useGraphStore(pinia)` for consistency