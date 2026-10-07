/**
 * V4 空态插画：内联 SVG 集（beacon 灯塔 / seal 印章 / scroll 卷轴）。
 * data-URI 无外部依赖，主题色用 currentColor 继承文字色。
 * 默认不渲染（EmptyState 不传 illustration 时完全向后兼容）。
 */
import React from "react";

export type EmptyIllustration = "beacon" | "seal" | "scroll";

const ICONS: Record<EmptyIllustration, React.ReactNode> = {
  // 灯塔：引导、起点（首建工作区/空总览）
  beacon: (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M32 14v6M32 22v4M22 22c-2 0-4 1-4 3 0 2 3 3 3 5 0 2-2 2-2 4h26c0-2-2-2-2-4 0-2 3-3 3-5 0-2-2-3-4-3"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        strokeOpacity="0.85"
      />
      <path d="M22 36c0 6 3 10 10 10s10-4 10-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.55" />
    </svg>
  ),
  // 印章：绑定、数据已固化
  seal: (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden>
      <rect x="14" y="14" width="36" height="36" rx="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.85" />
      <circle cx="32" cy="32" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.55" />
      <path d="M28 32l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.85" />
      <path d="M22 54h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35" />
    </svg>
  ),
  // 卷轴：历史、记录
  scroll: (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden>
      <path
        d="M18 12h28v40H18z" stroke="currentColor" strokeWidth="2" strokeOpacity="0.85"
      />
      <path d="M22 12v40" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
      <path d="M26 22h14M26 30h14M26 38h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.55" />
    </svg>
  ),
};

export function EmptyStateIllustration({ type }: { type: EmptyIllustration }) {
  return (
    <div className="mb-3 flex justify-center text-muted-foreground/70">
      {ICONS[type]}
    </div>
  );
}
