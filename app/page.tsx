import TankGame from "@/components/TankGame";

export default function Home() {
  return (
    <main className="main">
      <h1 className="title">坦克大战</h1>
      <p className="subtitle">保护基地，消灭所有敌方坦克！</p>
      <TankGame />
    </main>
  );
}
