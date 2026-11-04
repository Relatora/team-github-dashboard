import { DemoDashboard } from "@/components/demo/demo-dashboard";

export const metadata = {
  title: "Live Demo - Team GitHub Dashboard",
  description:
    "See the dashboard working against synthetic data, with no GitHub organization or token required.",
};

export default function DemoPage() {
  return <DemoDashboard />;
}
