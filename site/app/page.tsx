import { Header } from "./_components/Header";
import {
  Commands,
  Footer,
  HarnessStrip,
  Harnesses,
  Hero,
  Install,
  Loop,
  Safety,
  Share,
} from "./_components/sections";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <HarnessStrip />
        <Loop />
        <Harnesses />
        <Share />
        <Safety />
        <Install />
        <Commands />
      </main>
      <Footer />
    </>
  );
}
