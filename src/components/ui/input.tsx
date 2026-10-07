import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * 输入框（2026-09-21 精度重做）。
 *
 * h-10 → h-8：与按钮同高，工具栏里混排时基线对齐；40px 是触控尺寸，
 * 桌面数据工具里偏松。另外补齐了原实现缺失的 hover 边框反馈，
 * 并把 focus 环从实色外环改成 25% 透明的 2px 内环（在密集表单里不刺眼）。
 * 禁用态给背景色，而不只是降透明度（低对比下更易识别）。
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-foreground",
          "transition-[border-color,box-shadow,background-color] duration-150",
          "placeholder:text-muted-foreground/70",
          "hover:border-foreground/20",
          "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/50 disabled:opacity-60",
          "file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
