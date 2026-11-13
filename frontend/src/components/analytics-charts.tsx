"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { analyticsChartValues } from "@/lib/analytics-money";
import { analyticsDateLabel } from "@/lib/analytics-period";
import { formatPLN } from "@/lib/money";
import type {
  AnalyticsCategory,
  AnalyticsTrendPoint,
} from "@/lib/analytics-types";
import styles from "./analytics-panel.module.css";

export function CategoryChart({ items }: { items: AnalyticsCategory[] }) {
  const values = analyticsChartValues(items.map((item) => item.amount));
  const data = items.map((item, index) => ({ ...item, value: values[index] }));
  const height = Math.max(180, items.length * 52);
  return (
    <figure
      className={styles.chart}
      aria-label="Wykres wydatków według kategorii"
    >
      <ResponsiveContainer
        width="100%"
        height={height}
        minWidth={0}
        initialDimension={{ width: 600, height }}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
          accessibilityLayer
        >
          <XAxis type="number" hide domain={[0, 100]} />
          <YAxis
            type="category"
            dataKey="categoryName"
            width={98}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(name: string) =>
              name.length > 16 ? name.slice(0, 15) + "…" : name
            }
          />
          <Tooltip
            cursor={{ fill: "#eff6ff" }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload as
                AnalyticsCategory | undefined;
              return active && item ? (
                <div className={styles.tooltip}>
                  <strong>{item.categoryName}</strong>
                  <p>{formatPLN(item.amount)}</p>
                  <p>{item.percentage.replace(".", ",")}% wydatków</p>
                </div>
              ) : null;
            }}
          />
          <Bar
            dataKey="value"
            name="Wydatki"
            fill="#2563eb"
            radius={[0, 4, 4, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <figcaption className={styles.hint}>
        Dokładne kwoty i udziały znajdziesz w danych kategorii poniżej.
      </figcaption>
    </figure>
  );
}

export function TrendChart({ items }: { items: AnalyticsTrendPoint[] }) {
  const values = analyticsChartValues(
    items.flatMap((point) => [point.income, point.expenses]),
  );
  const data = items.map((point, index) => ({
    ...point,
    incomeValue: values[index * 2],
    expenseValue: values[index * 2 + 1],
  }));
  return (
    <figure
      className={styles.chart}
      aria-label="Wykres trendu przychodów i wydatków"
    >
      <ul className={styles.legend} aria-label="Legenda trendu">
        <li>
          <span className={styles.incomeMark} />
          Przychody
        </li>
        <li>
          <span className={styles.expenseMark} />
          Wydatki
        </li>
      </ul>
      <ResponsiveContainer
        width="100%"
        height={260}
        minWidth={0}
        initialDimension={{ width: 600, height: 260 }}
      >
        <LineChart
          data={data}
          margin={{ top: 16, right: 12, left: 12, bottom: 8 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="period"
            tickFormatter={(value: string) => analyticsDateLabel(value)}
            tick={{ fontSize: 11 }}
            minTickGap={32}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis hide domain={[0, 100]} />
          <Tooltip
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as
                AnalyticsTrendPoint | undefined;
              return active && point ? (
                <div className={styles.tooltip}>
                  <strong>{analyticsDateLabel(point.period)}</strong>
                  <p>Przychody: {formatPLN(point.income)}</p>
                  <p>Wydatki: {formatPLN(point.expenses)}</p>
                </div>
              ) : null;
            }}
          />
          <Line
            dataKey="incomeValue"
            name="Przychody"
            stroke="#15803d"
            strokeWidth={2.5}
            dot={items.length <= 31}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="expenseValue"
            name="Wydatki"
            stroke="#b45309"
            strokeWidth={2.5}
            strokeDasharray="6 3"
            dot={items.length <= 31}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <figcaption className={styles.hint}>
        Dokładne wartości każdego okresu są dostępne w danych trendu poniżej.
      </figcaption>
    </figure>
  );
}
