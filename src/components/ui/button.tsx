import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * 按钮元件（2026-09-21 精度重做）。
 *
 * 相较 shadcn 默认模板的四点变化：
 * 1. **尺寸整体下调一档**（默认 h-10 → h-8）。40px 是移动端触控尺寸，桌面数据工具里
 *    会让工具栏和表格行显得松散；同时补了 xs(24) / icon-sm(28) 两档，供表格行内操作使用。
 * 2. **补按压反馈** `active:translate-y-px`——原实现只有 hover，点击瞬间没有回应。
 * 3. **图标与文字间距收进元件**（`gap-1.5` + `[&_svg]:shrink-0`），替代调用方各写
 *    `className="mr-2"` / `"mr-1.5"` 的散乱写法。
 * 4. focus 环改为 `ring-ring/60` + 1px offset，在浅色卡片与深色底上都可见。
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:scale-[0.97] [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/85",
        outline:
          "border border-border bg-card text-foreground hover:border-foreground/25 hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/75",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 rounded px-2 text-[11.5px] gap-1",
        sm: "h-7 rounded-md px-2.5 text-[12px]",
        default: "h-8 px-3 text-[12.5px]",
        lg: "h-9 px-4 text-[13px]",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
