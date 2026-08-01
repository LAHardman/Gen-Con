import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface Transform {
  /** Screen-space translation, in CSS pixels. */
  x: number;
  y: number;
  /** Scale factor: screen = world * k + translation. */
  k: number;
}

export interface TapInfo {
  /** Point in the container's coordinate space. */
  x: number;
  y: number;
  /** Viewport coordinates, for hit-testing with elementFromPoint. */
  clientX: number;
  clientY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Options {
  worldWidth: number;
  worldHeight: number;
  minScale?: number;
  maxScale?: number;
  /** Fires on a single tap/click that wasn't part of a drag or pinch. */
  onTap?: (tap: TapInfo) => void;
  /** Fires on a double click (mouse) or double tap (touch/pen). */
  onDoubleTap?: (tap: TapInfo) => void;
  /**
   * The part of the map worth opening on when the whole thing would be too
   * small to read — on a phone, fitting the entire campus leaves a postage
   * stamp with every label suppressed.
   */
  primaryArea?: Rect;
  /** Fitting the whole map below this scale falls back to `primaryArea`. */
  primaryAreaBelowScale?: number;
}

/** Movement beyond this (CSS px) turns a tap into a drag. */
const DRAG_THRESHOLD = 8;
/** Two taps must land within this window (ms) and distance (px) to count as a double tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE = 40;
/** A tap held longer than this is treated as a long press, not a tap. */
const TAP_MAX_MS = 600;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Pan/zoom gesture handling for a map surface.
 *
 * Everything runs through Pointer Events, so mouse, touch and pen share one
 * code path: drag to pan, wheel or pinch to zoom, tap/click and double
 * tap/click reported back to the caller. The returned transform is meant to be
 * applied to an SVG `<g>` so the map stays crisp at any zoom level.
 */
export function usePanZoom({
  worldWidth,
  worldHeight,
  minScale = 0.08,
  maxScale = 8,
  onTap,
  onDoubleTap,
  primaryArea,
  primaryAreaBelowScale = 0.25,
}: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Mirror of `transform` that gesture handlers can read synchronously without
  // re-subscribing native listeners on every frame.
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;

  /**
   * Live pointers, keyed by pointerId, stored in *client* (viewport) space.
   *
   * Deliberately not container-local: the surrounding layout can shift while a
   * gesture is in flight (a toolbar growing, mobile browser chrome collapsing),
   * and a container-relative delta would silently absorb that shift and jump the
   * map. Client-space deltas are immune; we convert to local coordinates only at
   * the moments that genuinely need them.
   */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  /** State for the gesture currently in progress. */
  const gestureRef = useRef({
    downX: 0,
    downY: 0,
    downTime: 0,
    moved: false,
    multiTouch: false,
    /** Distance between the two pinch pointers on the previous move. */
    pinchDistance: 0,
    pinchMidX: 0,
    pinchMidY: 0,
  });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const hasFitRef = useRef(false);

  /**
   * Keeps the map from being flung off-screen: at least a quarter of the
   * smaller of (map, viewport) has to stay inside the viewport on each axis.
   */
  const clampTransform = useCallback(
    (next: Transform): Transform => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return next;

      const mapWidth = worldWidth * next.k;
      const mapHeight = worldHeight * next.k;
      const keepX = Math.min(mapWidth, width) * 0.25;
      const keepY = Math.min(mapHeight, height) * 0.25;

      return {
        k: next.k,
        x: clamp(next.x, keepX - mapWidth, width - keepX),
        y: clamp(next.y, keepY - mapHeight, height - keepY),
      };
    },
    [worldWidth, worldHeight],
  );

  /** Scales around a fixed point in container space, leaving it visually still. */
  const zoomAround = useCallback(
    (factor: number, originX: number, originY: number) => {
      setTransform((prev) => {
        const k = clamp(prev.k * factor, minScale, maxScale);
        const ratio = k / prev.k;
        return clampTransform({
          k,
          x: originX - (originX - prev.x) * ratio,
          y: originY - (originY - prev.y) * ratio,
        });
      });
    },
    [clampTransform, minScale, maxScale],
  );

  /** Zooms about the centre of the viewport — used by the on-screen buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      const { width, height } = sizeRef.current;
      zoomAround(factor, width / 2, height / 2);
    },
    [zoomAround],
  );

  /**
   * Centres a world-space rectangle in the viewport.
   *
   * `fill` is the fraction of the viewport the rectangle should occupy — 0.92
   * for "show me all of this", lower values to leave breathing room around a
   * small target so it keeps its surroundings for context. Returns the scale it
   * settled on so callers can react to it.
   */
  const fitToRect = useCallback(
    (rect: Rect, fill = 0.92) => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return null;
      const k = clamp(
        Math.min(width / rect.width, height / rect.height) * fill,
        minScale,
        maxScale,
      );
      setTransform(
        clampTransform({
          k,
          x: width / 2 - (rect.x + rect.width / 2) * k,
          y: height / 2 - (rect.y + rect.height / 2) * k,
        }),
      );
      return k;
    },
    [clampTransform, minScale, maxScale],
  );

  /** Scales the whole map to fit the viewport, centred. */
  const fitToView = useCallback(
    () => fitToRect({ x: 0, y: 0, width: worldWidth, height: worldHeight }),
    [fitToRect, worldWidth, worldHeight],
  );

  /** Zooms in on a single room, keeping a little of its surroundings visible. */
  const focusOnRect = useCallback((rect: Rect) => fitToRect(rect, 0.55), [fitToRect]);

  // Track the container size and fit the map the first time we know it.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);

    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasFitRef.current || size.width === 0 || size.height === 0) return;
    hasFitRef.current = true;
    const fitted = fitToView();
    if (primaryArea && fitted !== null && fitted < primaryAreaBelowScale) {
      fitToRect(primaryArea);
    }
  }, [size, fitToView, fitToRect, primaryArea, primaryAreaBelowScale]);

  // Wheel/trackpad zoom. Registered manually because React's onWheel is passive,
  // and we need preventDefault to stop the browser page-zooming instead.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      // deltaMode 1 = lines, 2 = pages; normalise both to roughly pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = event.deltaY * unit;
      zoomAround(Math.exp(-delta * 0.0018), event.clientX - rect.left, event.clientY - rect.top);
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [zoomAround]);

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);

    // Suppress the default focus/selection behaviour for pointer input. Rooms
    // are keyboard-focusable, and without this, pressing on one focuses it and
    // selects it before the drag has even started.
    event.preventDefault();

    // Capture so a drag that leaves the element still delivers move/up events.
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointers.size === 1) {
      gestureRef.current = {
        ...gestureRef.current,
        downX: point.x,
        downY: point.y,
        downTime: event.timeStamp,
        moved: false,
        multiTouch: false,
      };
      setIsPanning(true);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gestureRef.current.multiTouch = true;
      gestureRef.current.pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
      gestureRef.current.pinchMidX = (a.x + b.x) / 2;
      gestureRef.current.pinchMidY = (a.y + b.y) / 2;
    }
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointers = pointersRef.current;
      const previous = pointers.get(event.pointerId);
      if (!previous) return;

      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);

      if (pointers.size === 1) {
        const gesture = gestureRef.current;
        if (
          !gesture.moved &&
          Math.hypot(point.x - gesture.downX, point.y - gesture.downY) > DRAG_THRESHOLD
        ) {
          gesture.moved = true;
        }
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        setTransform((prev) => clampTransform({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      if (pointers.size === 2) {
        const gesture = gestureRef.current;
        gesture.moved = true;
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;

        if (gesture.pinchDistance > 0) {
          const factor = distance / gesture.pinchDistance;
          // Two-finger drag moves the map; the spread/pinch scales it about the
          // midpoint. Both are applied from the previous frame, incrementally.
          const panX = midX - gesture.pinchMidX;
          const panY = midY - gesture.pinchMidY;
          // The anchor has to be in container space; the deltas above are
          // client-space and translate one-to-one.
          const anchor = localPoint({ clientX: midX, clientY: midY });
          setTransform((prev) => {
            const k = clamp(prev.k * factor, minScale, maxScale);
            const ratio = k / prev.k;
            return clampTransform({
              k,
              x: anchor.x - (anchor.x - (prev.x + panX)) * ratio,
              y: anchor.y - (anchor.y - (prev.y + panY)) * ratio,
            });
          });
        }

        gesture.pinchDistance = distance;
        gesture.pinchMidX = midX;
        gesture.pinchMidY = midY;
      }
    },
    [clampTransform, minScale, maxScale],
  );

  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const pointers = pointersRef.current;
      const gesture = gestureRef.current;
      const wasSinglePointer = pointers.size === 1;

      pointers.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (pointers.size < 2) gesture.pinchDistance = 0;
      if (pointers.size === 0) setIsPanning(false);

      const isTap =
        !cancelled &&
        wasSinglePointer &&
        !gesture.moved &&
        !gesture.multiTouch &&
        event.timeStamp - gesture.downTime < TAP_MAX_MS;

      if (!isTap) return;

      const tap: TapInfo = {
        ...localPoint(event),
        clientX: event.clientX,
        clientY: event.clientY,
      };

      // Compared in client space so a layout shift between the two taps can't
      // push them apart and break the double tap.
      const last = lastTapRef.current;
      const isDoubleTap =
        last !== null &&
        event.timeStamp - last.time < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_DISTANCE;

      if (isDoubleTap) {
        lastTapRef.current = null;
        onDoubleTapRef.current?.(tap);
      } else {
        lastTapRef.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        onTapRef.current?.(tap);
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => endPointer(event, false),
    [endPointer],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => endPointer(event, true),
    [endPointer],
  );

  return {
    containerRef,
    transform,
    size,
    isPanning,
    zoomBy,
    fitToView,
    focusOnRect,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
  };
}
