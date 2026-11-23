"use client";

import { useEffect, useRef } from "react";
import { formatInvestment } from "@/lib/investment-format";
import styles from "./investments.module.css";

export function ClosingPriceChart({
  prices,
  currency,
}: {
  prices: { sessionOn: string; close: string }[];
  currency: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || prices.length < 2) return;
    const values = prices.map(({ close }) => Number(close));
    const low = Math.min(...values);
    const high = Math.max(...values);
    const inset = 12;
    const { width, height } = element;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = getComputedStyle(element).color;
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.beginPath();
    values.forEach((value, index) => {
      const x = inset + (index / (values.length - 1)) * (width - 2 * inset);
      const relativeHeight = low === high ? 0.5 : (value - low) / (high - low);
      const y = height - inset - relativeHeight * (height - 2 * inset);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }, [prices]);

  if (!prices.length) return <p>Brak zapisanych cen dziennych.</p>;
  return (
    <>
      {prices.length >= 2 && (
        <canvas
          ref={canvas}
          width={640}
          height={160}
          className={styles.priceChart}
          role="img"
          aria-label={`Kursy zamknięcia w ${currency} od ${prices[0]!.sessionOn} do ${prices.at(-1)!.sessionOn}`}
        />
      )}
      <details open={prices.length === 1 ? true : undefined}>
        <summary>Ceny według sesji</summary>
        <ul className={styles.list}>
          {prices.map((price) => (
            <li key={price.sessionOn}>
              {price.sessionOn} · {formatInvestment(price.close, 2)} {currency}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
