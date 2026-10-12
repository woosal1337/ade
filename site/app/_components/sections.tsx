import {
  ADE_MD_SAMPLE,
  COMMANDS,
  DOCS_URL,
  FEATURES,
  HARNESSES,
  MODEL_SETTINGS,
  PACKAGE,
  QUICK_START,
  REPO_URL,
  type Support,
  TERMINAL,
} from "../content";
import { brandById, HARNESS_BRANDS, MODEL_BRANDS } from "../brands";
import { BrandIcon } from "./BrandIcon";
import { CopyCommand } from "./CopyCommand";
import { DotLogo } from "./DotLogo";
import { DotField } from "./DotField";
import { DotText } from "./DotText";
import { InstallTabs } from "./InstallTabs";
import { LoopFigure } from "./LoopFigure";
import { Button, Chevron, Eyebrow, Fig, SectionTitle, Tag } from "./primitives";
import { Terminal } from "./Terminal";

const FRAME = "mx-auto max-w-[1400px] px-5";

type Tone = "fg" | "muted" | "faint" | "add" | "warn" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  fg: "text-fg",
  muted: "text-muted",
  faint: "text-faint",
  add: "text-accent",
  warn: "text-warn",
  danger: "text-danger",
};

function keyed<T>(items: readonly T[]): { id: string; item: T; index: number }[] {
  return items.map((item, index) => ({ id: `row-${String(index)}`, item, index }));
}

function MiniFig({ lines }: { lines: readonly (readonly [Tone, string])[] }) {
  return (
    <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.75]">
      {keyed(lines).map(({ id, item: [tone, text] }) => (
        <div key={id} className={TONE_CLASS[tone]}>
          {text || " "}
        </div>
      ))}
    </pre>
  );
}

const FIGURES: Record<string, readonly (readonly [Tone, string])[]> = {
  capture: [
    ["fg", "claude"],
    ["add", "  synced   ~/.claude/settings.json"],
    ["add", "  synced   ~/.claude/hooks/"],
    ["muted", "  extra    ~/.claude/statusline.sh"],
    ["faint", "  private  ~/.claude/.credentials.json"],
    ["faint", "  runtime  ~/.claude/sessions/"],
    ["faint", ""],
    ["muted", "42 synced, 5 extra, 0 unknown, 11 private."],
  ],
  plan: [
    ["fg", "codex"],
    ["add", '  + mcp       github     {"command":"npx",…}'],
    ["warn", '  ~ setting   model      "gpt-5.5" -> "gpt-5.6"'],
    ["danger", "  ! setting   theme      changed outside ade"],
    ["faint", ""],
    ["muted", "Plan: 1 to create, 1 to update, 0 to delete."],
  ],
  apply: [
    ["fg", "$ ade history"],
    ["muted", "20261012-091500-120-c3d4  apply   12 writes"],
    ["muted", "20261012-090000-000-a1b2  apply    7 writes"],
    ["faint", ""],
    ["fg", "$ ade revert"],
    ["add", "Reverted the record 20261012-091500-120-c3d4."],
  ],
  share: [
    ["faint", "---"],
    ["muted", "ade: 1"],
    ["muted", "files: 74"],
    ["muted", 'digest: "sha256:23aadac4…"'],
    ["faint", "---"],
    ["fg", "$ ade verify ADE.md"],
    ["add", "The ADE.md is valid: 74 files."],
  ],
};

export function Hero() {
  return (
    <section id="top" className={`${FRAME} pt-16 pb-12 lg:pt-24`}>
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 space-y-6">
          <Eyebrow>The agent environment manager</Eyebrow>
          <h1 className="text-[40px] leading-[1.05] tracking-[-0.02em] text-fg sm:text-[56px]">
            Own your agent setup
          </h1>
          <p className="max-w-[34rem] text-[18px] leading-[1.55] text-muted">
            ade captures the MCP servers, skills, instructions, settings, and plugins of 10 coding
            agents. It plans each change, applies it with a backup, and shares the whole setup as
            one ADE.md file.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button href="#install">Get started</Button>
            <Button href={REPO_URL} variant="ghost" external>
              GitHub
            </Button>
          </div>
          <div className="max-w-[34rem]">
            <CopyCommand command={`npm install -g ${PACKAGE}`} size="sm" />
          </div>
        </div>
        <div className="h-[460px] min-w-0">
          <Terminal title="ade apply acme/agents" lines={TERMINAL} />
        </div>
      </div>
    </section>
  );
}

interface LogoCellProps {
  readonly href: string;
  readonly brand: (typeof HARNESS_BRANDS)[number];
  readonly caption?: string;
  readonly tag?: string;
}

function LogoCell({ href, brand, caption, tag }: LogoCellProps) {
  return (
    <a
      href={href}
      className="group relative flex h-[136px] flex-col items-center justify-center gap-3 border-r border-b border-line text-muted transition-colors duration-300 hover:bg-panel hover:text-fg"
    >
      {tag === undefined ? null : (
        <span className="absolute top-0 right-0">
          <Tag>{tag}</Tag>
        </span>
      )}
      <DotLogo
        id={`dot-${brand.id}`}
        paths={brand.paths}
        className="h-11 w-11 transition-colors duration-300"
      />
      <span className="text-center leading-tight">
        <span className="block text-[14px]">{brand.name}</span>
        {caption === undefined ? null : (
          <span className="block font-mono text-[10px] uppercase tracking-wider text-faint">
            {caption}
          </span>
        )}
      </span>
    </a>
  );
}

export function HarnessStrip() {
  return (
    <section aria-label="Supported harnesses" className={FRAME}>
      <div className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-5">
        {HARNESS_BRANDS.map((brand, index) => (
          <LogoCell
            key={brand.id}
            href="#harnesses"
            brand={brand}
            {...(index === 0 ? { tag: "10 harnesses" } : {})}
          />
        ))}
      </div>
    </section>
  );
}

export function Loop() {
  return (
    <section className={`${FRAME} pt-24`}>
      <div className="border border-line">
        <div className="relative overflow-hidden border-b border-line">
          <div className="absolute inset-0 opacity-90">
            <DotField />
          </div>
          <div className="relative space-y-5 p-6 pb-28 sm:p-8 sm:pb-36">
            <SectionTitle lead="Loop.">
              Capture a machine, plan the change, apply it, and share it.
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              <Button href="#install">Install ade</Button>
              <Button href={`${DOCS_URL}/runbook.md`} variant="ghost" external>
                Runbook
              </Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 border-b border-line lg:grid-cols-2">
          <div className="border-b border-line p-6 lg:border-r lg:border-b-0">
            <Fig n="1" />
            <div className="pt-8">
              <LoopFigure />
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-8 p-6">
            <Fig n="2" />
            <div className="border border-line bg-panel p-4">
              <MiniFig
                lines={[
                  ["faint", "~/.claude.json"],
                  ["muted", "{"],
                  ["faint", '  "numStartups": 41,              yours'],
                  ["faint", '  "projects": { … },               yours'],
                  ["muted", '  "mcpServers": {'],
                  ["add", '    "docs": { "type": "http", … }    ade'],
                  ["faint", '    "local": { … }                 yours'],
                  ["muted", "  }"],
                  ["muted", "}"],
                ]}
              />
            </div>
            <div className="space-y-4">
              <p className="max-w-md text-[20px] leading-[1.45] text-muted">
                <span className="text-fg">One profile folder</span> holds the setup. ade owns
                entries, not files: one server, one key, one skill. Every other key stays where it
                is.
              </p>
              <ul className="space-y-2 font-mono text-[12px] text-muted">
                <li>
                  <span className="text-faint">2.1</span> A content hash for each entry finds drift
                </li>
                <li>
                  <span className="text-faint">2.2</span> A plan fingerprint stops a stale apply
                </li>
                <li>
                  <span className="text-faint">2.3</span> Each apply writes a record for ade revert
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.id}
              id={feature.id}
              className={`flex flex-col justify-between gap-8 border-line p-6 ${
                index % 2 === 0 ? "sm:border-r" : ""
              } ${index < 2 ? "border-b" : index === 2 ? "border-b sm:border-b-0" : ""}`}
            >
              <div className="space-y-4">
                <Fig n={String(index + 3)} />
                <div className="min-h-[150px] border border-line bg-panel p-4">
                  <MiniFig lines={FIGURES[feature.id] ?? []} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-[19px] text-fg">
                    <span className="mr-2 text-faint">{feature.n}</span>
                    {feature.title}
                  </h3>
                  <p className="text-[16px] leading-[1.5] text-muted">{feature.body}</p>
                </div>
                <ul className="space-y-2 text-[13px] text-muted">
                  {feature.points.map((point, pointIndex) => (
                    <li key={point} className="flex gap-3">
                      <span className="font-mono text-faint">
                        {Number(feature.n)}.{pointIndex + 1}
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <CopyCommand command={feature.command} size="sm" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const MARK: Record<Support, { text: string; label: string; className: string }> = {
  yes: { text: "●", label: "Yes", className: "text-accent" },
  partial: { text: "◐", label: "Partly", className: "text-warn" },
  no: { text: "—", label: "No", className: "text-faint" },
};

function Cell({ value }: { value: Support }) {
  const mark = MARK[value];
  return (
    <td className="border-b border-line px-3 py-3 text-center">
      <span className={mark.className} aria-hidden="true">
        {mark.text}
      </span>
      <span className="sr-only">{mark.label}</span>
    </td>
  );
}

export function Harnesses() {
  return (
    <section id="harnesses" className={`${FRAME} pt-24`}>
      <div className="space-y-8">
        <SectionTitle lead="Ten harnesses.">
          One profile writes the native format of each agent, on macOS, Linux, and Windows.
        </SectionTitle>
        <div className="relative overflow-x-auto border border-line">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-wider text-faint">
                <th scope="col" className="border-b border-line px-4 py-3 font-normal">
                  Harness
                </th>
                {["Instructions", "MCP", "Skills", "Settings", "Plugins"].map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-line px-3 py-3 text-center font-normal"
                  >
                    {column}
                  </th>
                ))}
                <th scope="col" className="border-b border-line px-4 py-3 font-normal">
                  Also synced
                </th>
              </tr>
            </thead>
            <tbody>
              {HARNESSES.map((row) => (
                <tr key={row.name} className="transition-colors hover:bg-panel">
                  <th
                    scope="row"
                    className="border-b border-line px-4 py-3 text-[15px] font-normal text-fg"
                  >
                    <span className="flex items-center gap-3">
                      <BrandIcon
                        paths={brandById(row.id)?.paths ?? []}
                        className="h-4 w-4 shrink-0 text-muted"
                      />
                      {row.name}
                    </span>
                  </th>
                  <Cell value={row.instructions} />
                  <Cell value={row.mcp} />
                  <Cell value={row.skills} />
                  <Cell value={row.settings} />
                  <Cell value={row.plugins} />
                  <td className="border-b border-line px-4 py-3 text-[13px] text-muted">
                    {row.extras}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[11px] text-faint">
          <span className="text-accent">●</span> synced &nbsp; <span className="text-warn">◐</span>{" "}
          partly &nbsp; — not available. ade never syncs sign-ins, tokens, sessions, history, or
          caches.{" "}
          <a
            href={`${DOCS_URL}/harnesses.md`}
            className="text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
          >
            Read the full support list
          </a>
          .
        </p>
      </div>
    </section>
  );
}

export function Models() {
  return (
    <section id="models" className={`${FRAME} pt-24`}>
      <div className="space-y-8">
        <SectionTitle lead="Models.">
          Each harness keeps its own model. ade syncs that setting with the rest of the setup.
        </SectionTitle>
        <div className="border border-line">
          <div className="overflow-hidden">
            <div className="-mr-px grid grid-cols-2 sm:grid-cols-5">
              {MODEL_BRANDS.map((brand) => (
                <LogoCell
                  key={brand.id}
                  href="#models"
                  brand={brand}
                  caption={brand.provider ?? ""}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="flex flex-col justify-between gap-6 border-b border-line p-6 lg:border-r lg:border-b-0">
              <Fig n="9" />
              <p className="max-w-sm text-[16px] leading-[1.55] text-muted">
                <span className="text-fg">The model is one more key.</span> A profile can set it for
                each harness. ade does not change model names and does not sync sign-ins.
              </p>
            </div>
            <div className="overflow-x-auto p-6">
              <table className="w-full min-w-[560px] border-collapse whitespace-nowrap font-mono text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-faint">
                    <th scope="col" className="pb-3 font-normal">
                      Harness
                    </th>
                    <th scope="col" className="pb-3 font-normal">
                      File
                    </th>
                    <th scope="col" className="pb-3 font-normal">
                      Key
                    </th>
                    <th scope="col" className="pb-3 font-normal">
                      Example
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_SETTINGS.map((row) => (
                    <tr key={row.harness} className="border-t border-line">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-fg">
                        <span className="flex items-center gap-2">
                          <BrandIcon
                            paths={brandById(row.harness)?.paths ?? []}
                            className="h-3.5 w-3.5 shrink-0 text-muted"
                          />
                          {row.harness}
                        </span>
                      </th>
                      <td className="py-2 pr-4 text-faint">{row.file}</td>
                      <td className="py-2 pr-4 text-accent">{row.key}</td>
                      <td className="py-2 text-muted">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CodePanel({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <pre className="overflow-x-auto py-4 font-mono text-[12px] leading-[1.7]">
      {keyed(lines).map(({ id, item: line, index }) => {
        const tone = line.startsWith("#")
          ? "text-fg"
          : line.startsWith("```") || line === "---"
            ? "text-faint"
            : line.startsWith("ade ")
              ? "text-accent"
              : "text-muted";
        return (
          <div key={id} className="flex">
            <span className="w-10 shrink-0 select-none pr-4 text-right text-faint">
              {index + 1}
            </span>
            <span className={tone}>{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function Share() {
  const steps = [
    { title: "Write one file from your profile", command: "ade share --repo you/agents" },
    { title: "Check it, then commit it", command: "ade verify ADE.md" },
    { title: "Others apply it 1:1", command: "ade apply you/agents" },
  ];
  return (
    <section id="ade-md" className={`${FRAME} pt-24`}>
      <div className="grid grid-cols-1 border border-line lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col justify-between gap-10 border-b border-line p-6 lg:border-r lg:border-b-0 sm:p-8">
          <div className="space-y-6">
            <SectionTitle lead="ADE.md.">One Markdown file holds the whole setup.</SectionTitle>
            <p className="max-w-md text-[16px] leading-[1.6] text-muted">
              GitHub shows it as a normal page: the install steps, what the setup runs and writes,
              the secret names, and every file. Each file has a SHA-256 hash, so a hand edit fails
              the check.
            </p>
          </div>
          <ol className="space-y-4">
            {steps.map((step, index) => (
              <li key={step.command} className="space-y-2">
                <p className="text-[14px] text-fg">
                  <span className="mr-2 font-mono text-faint">{index + 1}</span>
                  {step.title}
                </p>
                <CopyCommand command={step.command} size="sm" />
              </li>
            ))}
          </ol>
          <div>
            <Button href={`${DOCS_URL}/ade-md.md`} variant="ghost" external>
              Read the ADE.md standard
            </Button>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="font-mono text-[11px] text-muted">ADE.md</span>
            <Fig n="7" />
          </div>
          <CodePanel code={ADE_MD_SAMPLE} />
        </div>
      </div>
    </section>
  );
}

export function Safety() {
  const panels = [
    {
      title: "Trust",
      body: "A Git source needs your trust before its first apply. ade lists what it runs, writes, and reads. A new program or file needs trust again.",
      lines: [
        ["warn", "! mcp     github runs: npx -y …"],
        ["warn", "! file    writes ~/.npmrc"],
        ["muted", "  skill   instructions: review"],
        ["fg", "Trust acme/agents? yes"],
      ] as const,
      href: `${DOCS_URL}/sources.md`,
    },
    {
      title: "Secrets",
      body: "A profile names secrets and never holds their values. ade reads them at apply time from the environment, a file, a command, or the Keychain.",
      lines: [
        ["muted", '"Authorization":'],
        ["add", '  "Bearer ${secret:GITHUB_TOKEN}"'],
        ["muted", '"GITHUB_TOKEN":'],
        ["muted", '  { "from": "env" }'],
      ] as const,
      href: `${DOCS_URL}/profile.md`,
    },
    {
      title: "Revert",
      body: "Every apply keeps backups and a record. A failed apply rolls back. ade revert restores the entries of one apply and leaves the rest.",
      lines: [
        ["fg", "$ ade status"],
        ["danger", "! setting model changed outside ade"],
        ["fg", "$ ade revert"],
        ["add", "Reverted the record 2026…a1b2."],
      ] as const,
      href: `${DOCS_URL}/decisions/0002-entry-ownership.md`,
    },
  ];
  return (
    <section className={`${FRAME} pt-24`}>
      <div className="space-y-8">
        <SectionTitle lead="Safe by default.">
          ade shows each change before it writes, and keeps a way back.
        </SectionTitle>
        <div className="grid grid-cols-1 border border-line md:grid-cols-3">
          {panels.map((panel, index) => (
            <article
              key={panel.title}
              className={`flex flex-col gap-6 border-line p-6 ${
                index < 2 ? "border-b md:border-r md:border-b-0" : ""
              }`}
            >
              <a
                href={panel.href}
                className="flex items-center gap-2 text-[15px] text-fg hover:text-white"
              >
                {panel.title} <Chevron className="text-muted" />
              </a>
              <div className="min-h-[124px] border border-line bg-panel p-4">
                <MiniFig lines={panel.lines} />
              </div>
              <p className="text-[15px] leading-[1.55] text-muted">{panel.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Install() {
  return (
    <section id="install" className={`${FRAME} pt-24`}>
      <div className="grid grid-cols-1 border border-line lg:grid-cols-2">
        <div className="space-y-6 border-b border-line p-6 lg:border-r lg:border-b-0 sm:p-8">
          <SectionTitle lead="Install.">Node.js 22 or later and Git. Nothing else.</SectionTitle>
          <InstallTabs />
          <p className="text-[14px] leading-[1.6] text-muted">
            ade runs on macOS, Linux, and Windows. On Windows, ade copies files instead of making
            links. To set up another machine over SSH, run{" "}
            <code className="font-mono text-[13px] text-fg">ade remote &lt;host&gt; apply</code>.
            The other machine needs only Node.js.
          </p>
        </div>
        <div className="space-y-5 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[12px] uppercase tracking-wider text-muted">
              Quick start
            </h3>
            <Fig n="8" />
          </div>
          <ol className="space-y-5">
            {QUICK_START.map((step, index) => (
              <li key={step.command} className="space-y-2">
                <p className="text-[15px] text-fg">
                  <span className="mr-2 font-mono text-faint">{index + 1}</span>
                  {step.title}
                </p>
                <CopyCommand command={step.command} size="sm" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Commands() {
  return (
    <section id="commands" className={`${FRAME} pt-24`}>
      <div className="space-y-8">
        <SectionTitle lead="Commands.">
          Every command takes --json for scripts. Run ade help &lt;command&gt; for its options.
        </SectionTitle>
        <div className="grid grid-cols-1 border border-line md:grid-cols-3">
          {COMMANDS.map((group, index) => (
            <div
              key={group.title}
              className={`border-line p-6 ${index < 2 ? "border-b md:border-r md:border-b-0" : ""}`}
            >
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-wider text-faint">
                {group.title}
              </h3>
              <dl className="space-y-3">
                {group.rows.map(([command, text]) => (
                  <div
                    key={command}
                    className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 text-[13px]"
                  >
                    <dt className="font-mono text-fg">{command}</dt>
                    <dd className="text-muted">{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  {
    title: "Product",
    links: [
      { label: "Install", href: "#install" },
      { label: "Harnesses", href: "#harnesses" },
      { label: "Models", href: "#models" },
      { label: "Commands", href: "#commands" },
      { label: "ADE.md", href: "#ade-md" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "ADE.md standard", href: `${DOCS_URL}/ade-md.md` },
      { label: "Harness support", href: `${DOCS_URL}/harnesses.md` },
      { label: "Profile reference", href: `${DOCS_URL}/profile.md` },
      { label: "Remote machines", href: `${DOCS_URL}/remote.md` },
      { label: "SDK", href: `${DOCS_URL}/sdk.md` },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: REPO_URL },
      { label: "Issues", href: `${REPO_URL}/issues` },
      { label: "Architecture", href: `${DOCS_URL}/architecture.md` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line bg-panel">
      <div className={`${FRAME} grid grid-cols-1 gap-12 py-16 lg:grid-cols-2`}>
        <div className="max-w-[420px] space-y-6">
          <DotText id="logo-footer" text="ade." label="ade" />
          <p className="font-mono text-[12px] text-faint">
            One profile. Ten harnesses. Any machine.
          </p>
          <p className="max-w-sm text-[12px] leading-[1.6] text-faint">
            Product names and logos belong to their owners. ade has no link to these companies.
            Logos come from Simple Icons and LobeHub Icons.{" "}
            <a
              href={`${REPO_URL}/blob/main/THIRD_PARTY.md`}
              className="underline decoration-line-strong underline-offset-4 hover:text-muted"
            >
              Licenses
            </a>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_LINKS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-faint">
                {group.title}
              </h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="font-mono text-[12px] uppercase tracking-wide text-muted hover:text-fg"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
