const TICKER_DATA = [
  { pair: "XLM/USD", price: "0.1245", change: "+2.34" },
  { pair: "BTC/USD", price: "67,432", change: "+0.87" },
  { pair: "ETH/USD", price: "3,521", change: "-1.23" },
  { pair: "XRP/USD", price: "0.5234", change: "+1.56" },
  { pair: "SOL/USD", price: "143.20", change: "+3.45" },
  { pair: "DOGE/USD", price: "0.0892", change: "-0.45" },
  { pair: "AQUA/USD", price: "0.0023", change: "+5.67" },
  { pair: "YBX/USD", price: "0.8912", change: "+0.12" },
  { pair: "USDC/USD", price: "1.0001", change: "+0.01" },
];

export default function TerminalTicker() {
  const items = [...TICKER_DATA, ...TICKER_DATA]; // duplicate for seamless loop

  return (
    <div className="relative overflow-hidden border-b border-border bg-bg-card/80">
      {/* Gradient fades on edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg-primary to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg-primary to-transparent" />

      <div className="flex animate-ticker py-2" aria-hidden="true">
        {items.map((item, i) => (
          <span
            key={i}
            className="mx-6 flex shrink-0 items-center gap-3 font-mono text-[13px] tracking-wide"
          >
            <span className="text-text-muted">{item.pair}</span>
            <span className="text-text-primary">${item.price}</span>
            <span
              className={
                item.change.startsWith("+")
                  ? "text-success"
                  : "text-error"
              }
            >
              {item.change}%
            </span>
            <span className="text-border mx-2">|</span>
          </span>
        ))}
      </div>
    </div>
  );
}
