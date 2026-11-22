import type { TextAccent } from '../lib/loginConfig';

export function AccentedText({ text, accents }: { text: string; accents: TextAccent[] }) {
  if (!accents || accents.length === 0) return <>{text}</>;

  type Segment = { content: string; accent?: TextAccent };
  let segments: Segment[] = [{ content: text }];

  for (const accent of accents) {
    const next: Segment[] = [];
    for (const seg of segments) {
      if (seg.accent) {
        next.push(seg);
        continue;
      }
      const idx = seg.content.indexOf(accent.text);
      if (idx === -1) {
        next.push(seg);
        continue;
      }
      if (idx > 0) next.push({ content: seg.content.slice(0, idx) });
      next.push({ content: accent.text, accent });
      const rest = seg.content.slice(idx + accent.text.length);
      if (rest) next.push({ content: rest });
    }
    segments = next;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.accent) return <span key={i}>{seg.content}</span>;
        const { effect, color } = seg.accent;

        if (effect === 'underline') {
          return (
            <span
              key={i}
              style={{
                backgroundImage: `linear-gradient(120deg, ${color}44 0%, ${color}66 100%)`,
                backgroundSize: '100% 6px',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'bottom',
                paddingBottom: 2,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'paint') {
          return (
            <span
              key={i}
              className="relative inline"
              style={{ padding: '0 4px' }}
            >
              <span
                className="absolute inset-0 -skew-x-1"
                style={{ background: `${color}25`, borderRadius: 3, transform: 'skewX(-2deg) scaleY(0.85)' }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'highlight') {
          return (
            <span
              key={i}
              style={{
                background: `${color}22`,
                padding: '2px 6px',
                borderRadius: 2,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'brush') {
          return (
            <span
              key={i}
              style={{
                borderBottom: `3px solid ${color}`,
                paddingBottom: 2,
                display: 'inline',
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'splash') {
          return (
            <span
              key={i}
              style={{
                color,
                fontStyle: 'italic',
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'circle') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute pointer-events-none"
                style={{ left: '-12%', top: '-20%', width: '124%', height: '140%' }}
                viewBox="0 0 200 100"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M30 50 C30 25, 60 12, 100 10 C140 8, 175 22, 178 48 C181 74, 150 90, 105 92 C60 94, 25 78, 28 55 C29 52, 30 50, 32 48"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.85"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'starburst') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute pointer-events-none"
                style={{ left: '-25%', top: '-50%', width: '150%', height: '200%' }}
                viewBox="0 0 100 100"
                fill="none"
                preserveAspectRatio="none"
              >
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const x1 = 50 + 24 * Math.cos(rad);
                  const y1 = 50 + 24 * Math.sin(rad);
                  const x2 = 50 + 40 * Math.cos(rad);
                  const y2 = 50 + 40 * Math.sin(rad);
                  return (
                    <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                  );
                })}
                {[22, 67, 112, 157, 202, 247, 292, 337].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const x1 = 50 + 26 * Math.cos(rad);
                  const y1 = 50 + 26 * Math.sin(rad);
                  const x2 = 50 + 34 * Math.cos(rad);
                  const y2 = 50 + 34 * Math.sin(rad);
                  return (
                    <line key={`s${angle}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
                  );
                })}
                {[0, 90, 180, 270].map((angle) => {
                  const rad = (angle * Math.PI) / 180;
                  const cx = 50 + 44 * Math.cos(rad);
                  const cy = 50 + 44 * Math.sin(rad);
                  return (
                    <circle key={`d${angle}`} cx={cx} cy={cy} r="1.8" fill={color} />
                  );
                })}
              </svg>
              <span className="relative" style={{ color }}>{seg.content}</span>
            </span>
          );
        }
        if (effect === 'marker') {
          return (
            <span key={i} className="relative inline">
              <span
                className="absolute left-[-2px] right-[-2px]"
                style={{
                  background: `linear-gradient(92deg, ${color}99 0%, ${color}77 30%, ${color}88 60%, ${color}99 100%)`,
                  height: '55%',
                  bottom: '12%',
                  borderRadius: '2px 4px 3px 2px',
                  transform: 'skewX(-2deg) rotate(-0.3deg)',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'wavyUnderline') {
          return (
            <span key={i} className="relative inline-block">
              <svg
                className="absolute left-0 pointer-events-none"
                style={{ bottom: '-4px', width: '100%', height: '10px' }}
                viewBox="0 0 120 10"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 6 C5 2, 10 2, 15 6 S25 10, 30 6 S40 2, 45 6 S55 10, 60 6 S70 2, 75 6 S85 10, 90 6 S100 2, 105 6 S115 10, 120 6"
                  stroke={color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.8"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'shortUnderline') {
          return (
            <span key={i} className="relative inline-block">
              <span
                className="absolute left-1/4 right-1/4"
                style={{
                  bottom: '-2px',
                  height: '4px',
                  background: color,
                  borderRadius: '2px',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'paintStroke') {
          return (
            <span key={i} className="relative inline">
              <svg
                className="absolute pointer-events-none left-[-4px] right-[-4px]"
                style={{ top: '15%', width: 'calc(100% + 8px)', height: '70%' }}
                viewBox="0 0 200 40"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M4 20 C20 8, 50 32, 80 18 C110 4, 140 30, 170 16 C185 10, 195 22, 198 20"
                  stroke={color}
                  strokeWidth="28"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.25"
                />
              </svg>
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'strikethrough') {
          return (
            <span key={i} className="relative inline">
              <span
                className="absolute left-0 right-0"
                style={{
                  top: '50%',
                  height: '3px',
                  background: color,
                  borderRadius: '1px',
                  transform: 'rotate(-1deg)',
                }}
              />
              <span className="relative">{seg.content}</span>
            </span>
          );
        }
        if (effect === 'glow') {
          return (
            <span
              key={i}
              style={{
                color,
                textShadow: `0 0 8px ${color}66, 0 0 20px ${color}33`,
              }}
            >
              {seg.content}
            </span>
          );
        }
        if (effect === 'boxed') {
          return (
            <span
              key={i}
              style={{
                border: `2.5px solid ${color}`,
                padding: '1px 8px',
                borderRadius: '4px',
                display: 'inline',
              }}
            >
              {seg.content}
            </span>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </>
  );
}
