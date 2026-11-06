import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmt } from './ui';

/** Track an element's width so SVG charts render crisp at any size. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Nudge end-of-line labels apart so they never overlap. */
function spreadLabels(labels: Array<{ key: string; y: number }>, gap: number, max: number) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
  const overflow = sorted.length ? sorted[sorted.length - 1].y - max : 0;
  if (overflow > 0) for (const l of sorted) l.y -= overflow;
  return sorted;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/**
 * Multi-series line chart with a crosshair tooltip, legend and end-of-line direct labels.
 */
export function LineChart({
  labels,
  series,
  height = 240,
  format = fmt.int,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const directLabels = series.length <= 4;
  const pad = { top: 12, right: directLabels ? 44 : 12, bottom: 26, left: 44 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - (v / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}>
            <i className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart" ref={ref} style={{ height }}>
        {width > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            <g transform={`translate(${pad.left},${pad.top})`}>
              <g className="grid">
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={0} x2={w} y1={y(t)} y2={y(t)} />
                    <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                      {fmt.compact(t)}
                    </text>
                  </g>
                ))}
              </g>
              <line className="axis-line" x1={0} x2={w} y1={h} y2={h} />
              {labels.map((l, i) =>
                i % xTickEvery === 0 || i === n - 1 ? (
                  <text key={l} x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                    {fmt.date(l)}
                  </text>
                ) : null,
              )}
              {series.map((s) => (
                <path
                  key={s.key}
                  d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {directLabels &&
                spreadLabels(series.map((s) => ({ key: s.key, y: y(s.values[n - 1] ?? 0) })), 13, h).map((l) => (
                  <text key={l.key} x={w + 8} y={l.y} dy="0.32em" style={{ fill: 'var(--text-2)', fontWeight: 600 }}>
                    {l.key}
                  </text>
                ))}
              {hover != null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--axis)" strokeDasharray="3 3" />
                  {series.map((s) => (
                    <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  ))}
                </g>
              )}
              <rect width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </g>
          </svg>
        )}
        {hover != null && width > 0 && (
          <div
            className="tooltip"
            style={{
              left: Math.min(pad.left + x(hover) + 14, width - 170),
              top: pad.top,
            }}
          >
            <div className="t-title">{fmt.date(labels[hover])}</div>
            {series.map((s) => (
              <div className="t-row" key={s.key}>
                <i className="swatch" style={{ background: s.color }} />
                {s.label}
                <b>{format(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny single-series trend for tables and tiles. */
export function Sparkline({ values, color = 'var(--series-1)', width = 96, height = 28, label }: { values: number[]; color?: string; width?: number; height?: number; label: string }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => `${((i / Math.max(1, n - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <svg width={width} height={height} role="img" aria-label={`${label}: ${fmt.int(total)} over ${n} days`}>
      <title>{`${label}: ${fmt.int(total)} over the last ${n} days`}</title>
      <line x1={2} x2={width - 2} y1={height - 3} y2={height - 3} stroke="var(--grid)" />
      {total > 0 && <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/** Daily volume bars (single series). */
export function Bars({ labels, values, height = 120, color = 'var(--series-1)', format = fmt.int, ariaLabel }: { labels: string[]; values: number[]; height?: number; color?: string; format?: (n: number) => string; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...values));
  const n = values.length;
  const gap = 2;
  const bw = n ? Math.max(2, (width - gap * (n - 1)) / n) : 0;
  const h = height - 18;
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <line className="axis-line" x1={0} x2={width} y1={h} y2={h} />
          {values.map((v, i) => {
            const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (h - 4));
            const bx = i * (bw + gap);
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={bx} y={0} width={bw} height={h} fill="transparent" />
                <path
                  d={bh > 0 ? `M${bx},${h} V${h - bh + Math.min(4, bh)} Q${bx},${h - bh} ${bx + Math.min(4, bw / 2)},${h - bh} H${bx + bw - Math.min(4, bw / 2)} Q${bx + bw},${h - bh} ${bx + bw},${h - bh + Math.min(4, bh)} V${h} Z` : ''}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
              </g>
            );
          })}
          <text x={0} y={height - 2}>{labels[0] ? fmt.date(labels[0]) : ''}</text>
          <text x={width} y={height - 2} textAnchor="end">{labels[n - 1] ? fmt.date(labels[n - 1]) : ''}</text>
        </svg>
      )}
      {hover != null && (
        <div className="tooltip" style={{ left: Math.min(hover * (bw + gap), width - 160), top: -8, minWidth: 120 }}>
          <div className="t-title">{fmt.date(labels[hover])}</div>
          <div className="t-row">
            {ariaLabel}
            <b>{format(values[hover])}</b>
          </div>
        </div>
      )}
    </div>
  );
}

/** Horizontal split bar (one row per segment group), e.g. users per variant per country. */
export function SplitBar({ parts, total, title }: { parts: Array<{ key: string; label: string; value: number; color: string }>; total: number; title: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: 'relative' }} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.map((p) =>
          p.value > 0 ? <span key={p.key} style={{ width: `${(p.value / Math.max(1, total)) * 100}%`, background: p.color }} /> : null,
        )}
      </div>
      {hover && (
        <div className="tooltip" style={{ left: 0, top: 14 }}>
          <div className="t-title">{title}</div>
          {parts.map((p) => (
            <div className="t-row" key={p.key}>
              <i className="swatch" style={{ background: p.color }} />
              {p.label}
              <b>
                {fmt.int(p.value)} · {fmt.pct(p.value / Math.max(1, total), 0)}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lift with its 95% confidence interval, drawn around a zero line. */
export function CiBar({ low, high, point, color, domain }: { low: number; high: number; point: number; color: string; domain: number }) {
  const scale = (v: number) => 50 + (Math.max(-domain, Math.min(domain, v)) / domain) * 50;
  return (
    <div className="ci" title={`95% CI ${fmt.lift(low)} to ${fmt.lift(high)}`} aria-label={`Lift ${fmt.lift(point)}, 95% confidence interval ${fmt.lift(low)} to ${fmt.lift(high)}`}>
      <span className="zero" style={{ left: '50%' }} />
      <span className="range" style={{ left: `${scale(low)}%`, width: `${Math.max(1, scale(high) - scale(low))}%`, background: color, opacity: 0.35 }} />
      <span className="point" style={{ left: `${scale(point)}%`, background: color }} />
    </div>
  );
}
