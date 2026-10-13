import type { Metadata } from "next";
import { Header } from "../_components/Header";
import { Footer } from "../_components/sections";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = {
  title: "Dashboard | ade",
  description: "Choose the parts of your agent setup that others see on your ade page.",
  alternates: { canonical: "/dashboard" },
  robots: { index: false },
};

export default function DashboardPage() {
  return (
    <>
      <Header />
      <main>
        <Dashboard />
      </main>
      <Footer />
    </>
  );
}
