import { Header } from "./_components/Header";
import {
  Commands,
  Footer,
  HarnessStrip,
  Harnesses,
  Hero,
  Install,
  Loop,
  Models,
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
        <Models />
        <Share />
        <Safety />
        <Install />
        <Commands />
      </main>
      <Footer />
    </>
  );
}
