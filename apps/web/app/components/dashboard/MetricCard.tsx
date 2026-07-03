"use client";

import { memo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MiniSparkline } from "./MiniSparkline";

interface MetricCardProps {
  title: string;
  value: string;
  change?: {
    value: string;
    positive: boolean;
  };
  sparklineData?: { t: number; v: number }[];
  icon?: React.ReactNode;
  href?: string;
  className?: string;
  children?: React.ReactNode;
}

export function MetricCard({
  title,
  value,
  change,
  sparklineData,
  icon,
  href,
  className = "",
  children,
}: MetricCardProps) {
  const CardWrapper = href ? Link : "div";
  const cardContent = (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-bg-card p-5",
        "transition-all duration-300 ease-out",
        "hover:border-white/[0.12] hover:bg-bg-elevated/80",
        "hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]",
        href && "cursor-pointer",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            {title}
          </p>
          <p className="mt-2 font-display text-[28px] font-semibold tracking-tight text-text-primary tabular-nums">
            {value}
          </p>
          {change && (
            <p
              className={cn(
                "mt-1.5 text-xs font-medium tabular-nums",
                change.positive ? "text-success" : "text-error"
              )}
            >
              {change.positive ? "↑" : "↓"} {change.value}
              <span className="ml-1 text-text-muted font-normal">vs last period</span>
            </p>
          )}
          {children}
        </div>
        <div className="flex flex-col items-end gap-2">
          {icon && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] text-text-secondary">
              {icon}
            </div>
          )}
          {sparklineData && (
            <MiniSparkline data={sparklineData} width={100} height={32} />
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.02] to-transparent" />
      </div>
    </div>
  );

  if (href) {
    return (
      <CardWrapper href={href} className="block no-underline">
        {cardContent}
      </CardWrapper>
    );
  }

  return cardContent;
}

export default memo(MetricCard);
