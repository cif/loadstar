import { useEffect, useRef, useState } from "react";

interface Node {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  icon: "worker" | "workflow" | "do" | "db" | "gateway" | "client" | "socket";
  group?: string;
}

interface Edge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  color?: string;
  bidirectional?: boolean;
}

const NODES: Node[] = [
  {
    id: "client",
    label: "Browser Client",
    sublabel: "React + @loadstar/client",
    x: 80,
    y: 300,
    w: 180,
    h: 70,
    color: "#6366f1",
    icon: "client",
  },
  {
    id: "worker",
    label: "Worker",
    sublabel: "Stateless API Router",
    x: 380,
    y: 180,
    w: 180,
    h: 70,
    color: "#f97316",
    icon: "worker",
    group: "cloudflare",
  },
  {
    id: "relay",
    label: "Relay DO",
    sublabel: "WebSocket Proxy (no state)",
    x: 380,
    y: 420,
    w: 180,
    h: 70,
    color: "#eab308",
    icon: "do",
    group: "cloudflare",
  },
  {
    id: "workflow",
    label: "Agent Workflow",
    sublabel: "Durable Execution",
    x: 680,
    y: 180,
    w: 200,
    h: 70,
    color: "#22c55e",
    icon: "workflow",
    group: "cloudflare",
  },
  {
    id: "d1",
    label: "D1",
    sublabel: "Conversations + Traces",
    x: 680,
    y: 420,
    w: 180,
    h: 70,
    color: "#3b82f6",
    icon: "db",
    group: "cloudflare",
  },
  {
    id: "gateway",
    label: "AI Gateway",
    sublabel: "Inference Router",
    x: 980,
    y: 180,
    w: 180,
    h: 70,
    color: "#a855f7",
    icon: "gateway",
    group: "cloudflare",
  },
  {
    id: "llm",
    label: "LLM Provider",
    sublabel: "Workers AI / OpenAI / etc",
    x: 980,
    y: 420,
    w: 180,
    h: 70,
    color: "#ec4899",
    icon: "gateway",
  },
];

const EDGES: Edge[] = [
  { from: "client", to: "worker", label: "REST API" },
  {
    from: "client",
    to: "relay",
    label: "WebSocket",
    bidirectional: true,
    color: "#eab308",
  },
  { from: "worker", to: "workflow", label: "create()" },
  { from: "worker", to: "relay", label: "upgrade", dashed: true },
  {
    from: "workflow",
    to: "relay",
    label: "push events",
    color: "#eab308",
    dashed: true,
  },
  { from: "workflow", to: "d1", label: "step.do()" },
  { from: "workflow", to: "gateway", label: "inference" },
  { from: "gateway", to: "llm", label: "proxy" },
  { from: "worker", to: "d1", label: "read", dashed: true },
];

const ANNOTATIONS = [
  {
    x: 680,
    y: 100,
    text: "Each step is checkpointed — survives deploys, crashes, restarts",
    color: "#22c55e",
  },
  {
    x: 380,
    y: 530,
    text: "No state, no logic — if evicted, client reconnects & catches up from API",
    color: "#eab308",
  },
];

export function ArchitectureDiagram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 1240, h: 660 });
  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    ctx.scale(dpr, dpr);

    let frame = 0;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, dims.w, dims.h);

      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, dims.w, dims.h);

      // Cloudflare region background
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      roundRect(ctx, 340, 130, 860, 400, 16);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.font = "11px system-ui";
      ctx.fillText("Cloudflare", 360, 155);

      // Draw edges
      for (const edge of EDGES) {
        const from = NODES.find((n) => n.id === edge.from)!;
        const to = NODES.find((n) => n.id === edge.to)!;
        drawEdge(ctx, from, to, edge, frame);
      }

      // Draw nodes
      for (const node of NODES) {
        drawNode(ctx, node, hoveredNode === node.id, frame);
      }

      // Draw annotations
      for (const ann of ANNOTATIONS) {
        ctx.fillStyle = ann.color + "60";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(ann.text, ann.x, ann.y);
        ctx.textAlign = "left";
      }

      // Title
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 20px system-ui";
      ctx.fillText("loadstar architecture", 80, 50);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "14px system-ui";
      ctx.fillText(
        "Durable agent execution on Cloudflare Workflows",
        80,
        75
      );

      // Legend
      const legendY = 620;
      const legends = [
        { color: "#22c55e", label: "Durable (survives deploys)" },
        { color: "#f97316", label: "Stateless (fast, replaceable)" },
        { color: "#eab308", label: "Ephemeral (reconnectable)" },
      ];
      ctx.font = "11px system-ui";
      let lx = 80;
      for (const l of legends) {
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.arc(lx + 5, legendY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(l.label, lx + 14, legendY + 4);
        lx += ctx.measureText(l.label).width + 30;
      }

      frame++;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [dims, hoveredNode]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const found = NODES.find(
      (n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h
    );
    setHoveredNode(found?.id ?? null);
  }

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-8">
      <canvas
        ref={canvasRef}
        style={{ width: dims.w, height: dims.h }}
        className="rounded-xl"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredNode(null)}
      />
    </div>
  );
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: Node,
  hovered: boolean,
  frame: number
) {
  const { x, y, w, h, color, label, sublabel } = node;

  // Glow
  if (hovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
  }

  // Background
  ctx.fillStyle = hovered ? color + "30" : "rgba(255,255,255,0.04)";
  ctx.strokeStyle = hovered ? color : color + "60";
  ctx.lineWidth = hovered ? 2 : 1;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Icon dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 20, y + h / 2 - 4, 5, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 13px system-ui";
  ctx.fillText(label, x + 34, y + h / 2 - 1);

  // Sublabel
  if (sublabel) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "11px system-ui";
    ctx.fillText(sublabel, x + 34, y + h / 2 + 15);
  }

  // Pulse for workflow node
  if (node.id === "workflow") {
    const pulse = Math.sin(frame * 0.03) * 0.5 + 0.5;
    ctx.strokeStyle = color + Math.round(pulse * 60).toString(16).padStart(2, "0");
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 14);
    ctx.stroke();
  }
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: Node,
  to: Node,
  edge: Edge,
  _frame: number
) {
  const fx = from.x + from.w;
  const fy = from.y + from.h / 2;
  let tx = to.x;
  let ty = to.y + to.h / 2;

  // Handle edges going down
  if (Math.abs(from.x - to.x) < 50) {
    const fxc = from.x + from.w / 2;
    const fyc = from.y + from.h;
    tx = to.x + to.w / 2;
    ty = to.y;

    ctx.strokeStyle = edge.color ?? "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    if (edge.dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(fxc, fyc);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    if (edge.label) {
      const mx = (fxc + tx) / 2;
      const my = (fyc + ty) / 2;
      ctx.fillStyle = edge.color ?? "rgba(255,255,255,0.3)";
      ctx.font = "10px system-ui";
      ctx.fillText(edge.label, mx + 6, my);
    }
    return;
  }

  ctx.strokeStyle = edge.color ?? "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  if (edge.dashed) ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(fx, fy);

  // Curved path
  const cpx = (fx + tx) / 2;
  ctx.bezierCurveTo(cpx, fy, cpx, ty, tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrow
  const angle = Math.atan2(ty - fy, tx - fx);
  ctx.fillStyle = edge.color ?? "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - 8 * Math.cos(angle - 0.4), ty - 8 * Math.sin(angle - 0.4));
  ctx.lineTo(tx - 8 * Math.cos(angle + 0.4), ty - 8 * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();

  // Label
  if (edge.label) {
    const mx = (fx + tx) / 2;
    const my = (fy + ty) / 2 - 8;
    ctx.fillStyle = edge.color ?? "rgba(255,255,255,0.3)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(edge.label, mx, my);
    ctx.textAlign = "left";
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
