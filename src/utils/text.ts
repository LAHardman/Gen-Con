/**
 * Text measurement for map labels.
 *
 * Labels are drawn inside fixed-size shapes, so we need to know how wide a
 * string will actually be before deciding whether to shrink it or drop it.
 * Estimating from a characters-per-em ratio is what makes labels spill over
 * their room and collide with the next one, so measure for real instead.
 */

const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Measured at a large size and scaled down; text width is linear in font size. */
const REFERENCE_SIZE = 100;

const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

function getContext() {
  if (context === undefined) {
    context = document.createElement('canvas').getContext('2d');
  }
  return context;
}

function widthAtReferenceSize(text: string, weight: number) {
  const key = `${weight}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const ctx = getContext();
  // Without a canvas (non-browser rendering), fall back to a rough estimate
  // rather than failing to draw labels at all.
  const width = ctx
    ? ((ctx.font = `${weight} ${REFERENCE_SIZE}px ${FONT_STACK}`), ctx.measureText(text).width)
    : text.length * REFERENCE_SIZE * 0.6;

  cache.set(key, width);
  return width;
}

export interface TextMetricsOptions {
  weight?: number;
  /** Letter spacing in em, matching the CSS applied to the label. */
  trackingEm?: number;
  /** Set when CSS uppercases the text, which changes its width. */
  uppercase?: boolean;
}

/**
 * The largest font size, in px, at which `text` still fits within `availablePx`.
 * Returns Infinity for empty text so callers fall back to their preferred size.
 */
export function fittingFontPx(
  text: string,
  availablePx: number,
  { weight = 400, trackingEm = 0, uppercase = false }: TextMetricsOptions = {},
) {
  if (text.length === 0) return Infinity;
  if (availablePx <= 0) return 0;

  const measured = uppercase ? text.toUpperCase() : text;
  // Width grows linearly with font size, and CSS letter-spacing adds a fixed
  // em-multiple after every character — so per-px-of-font-size width is:
  const widthPerFontPx =
    widthAtReferenceSize(measured, weight) / REFERENCE_SIZE + trackingEm * measured.length;

  return availablePx / widthPerFontPx;
}
