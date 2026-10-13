import { Header } from "./_components/Header";
import { Button } from "./_components/primitives";
import { Footer } from "./_components/sections";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1100px] space-y-6 px-5 py-24">
        <p className="font-mono text-[12px] text-muted">404</p>
        <h1 className="text-[32px] leading-[1.15] text-fg">This page does not exist</h1>
        <p className="max-w-[520px] text-[16px] leading-[1.6] text-muted">
          No ade page has this name, or the address is wrong.
        </p>
        <Button href="/">Go to the home page</Button>
      </main>
      <Footer />
    </>
  );
}
