const NODES = [
  { label: "Capture", command: "ade capture", x: 160, y: 46, align: "top" },
  { label: "Plan", command: "ade plan", x: 274, y: 160, align: "right" },
  { label: "Apply", command: "ade apply", x: 160, y: 274, align: "bottom" },
  { label: "Share", command: "ade share", x: 46, y: 160, align: "left" },
] as const;

const PATH = "M160 46 L274 160 L160 274 L46 160 Z";

const PLACE: Record<(typeof NODES)[number]["align"], string> = {
  top: "left-1/2 top-[2%] -translate-x-1/2 -translate-y-full text-center",
  right: "left-[88%] top-1/2 -translate-y-[130%] text-left",
  bottom: "left-1/2 top-[98%] -translate-x-1/2 text-center",
  left: "right-[88%] top-1/2 -translate-y-[130%] text-right",
};

export function LoopDiagram() {
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[300px]">
      <svg viewBox="0 0 320 320" className="h-full w-full" aria-hidden="true">
        <circle cx="160" cy="46" r="62" fill="none" stroke="#1d1d1d" />
        <circle cx="274" cy="160" r="62" fill="none" stroke="#1d1d1d" />
        <circle cx="160" cy="274" r="62" fill="none" stroke="#1d1d1d" />
        <circle cx="46" cy="160" r="62" fill="none" stroke="#1d1d1d" />
        <path d={PATH} fill="none" stroke="#d6d6d6" strokeWidth="1.2" />
        <path d="M150 150 L170 170 M170 150 L150 170" stroke="#3a3a3a" strokeWidth="1" />
        {NODES.map((node) => (
          <circle
            key={node.label}
            cx={node.x}
            cy={node.y}
            r="6"
            fill="#0b0b0b"
            stroke="#ededed"
            strokeWidth="1.2"
          />
        ))}
        <circle r="2.6" fill="#7cf0b0" className="motion-reduce:hidden">
          <animateMotion dur="6s" repeatCount="indefinite" path={PATH} />
        </circle>
      </svg>
      {NODES.map((node) => (
        <figcaption
          key={node.label}
          className={`absolute whitespace-nowrap font-mono text-[11px] leading-5 ${PLACE[node.align]}`}
        >
          <span className="block uppercase tracking-wider text-fg">{node.label}</span>
          <span className="block text-muted">
            <span className="text-accent">$</span> {node.command}
          </span>
        </figcaption>
      ))}
    </figure>
  );
}
