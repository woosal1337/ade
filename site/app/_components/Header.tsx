import { NAV, REPO_URL } from "../content";
import { ArrowUpRight, Button } from "./primitives";

export function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2" aria-label="ade home">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <rect x="1" y="1" width="22" height="22" fill="none" stroke="#ededed" strokeWidth="1.5" />
        <path d="M6 8l4 4-4 4" fill="none" stroke="#ededed" strokeWidth="1.6" />
        <path d="M12 16h6" stroke="#7cf0b0" strokeWidth="1.6" />
      </svg>
      <span className="font-mono text-[17px] font-medium tracking-tight text-fg">ade</span>
    </a>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
      <a
        href="#share"
        className="block border-b border-line bg-panel py-1.5 text-center font-mono text-[12px] text-muted transition-colors hover:text-fg"
      >
        New: share a whole agent setup as one ADE.md file <ArrowUpRight />
      </a>
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-5">
        <Logo />
        <ul className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="flex w-36 items-center justify-between bg-tab px-2 py-1.5 font-mono text-[12px] uppercase tracking-wide text-fg transition-colors hover:bg-line-strong"
              >
                {item.label}
                <span className="text-faint">{item.n}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-5 font-mono text-[12px] uppercase tracking-wide">
          <a href="#harnesses" className="hidden text-muted hover:text-fg sm:inline">
            Harnesses
          </a>
          <a href="#commands" className="hidden text-muted hover:text-fg sm:inline">
            Commands
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden text-muted hover:text-fg md:inline"
          >
            GitHub
          </a>
          <Button href="#install">Install</Button>
        </div>
      </nav>
    </header>
  );
}
