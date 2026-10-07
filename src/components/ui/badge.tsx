import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // V9：半透明底 + 描边 + 状态圆点（before 伪元素），variant 映射表不变
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 before:inline-block before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
  {
    variants: {
      variant: {
        default:
          "border-primary/25 bg-primary/10 text-primary before:bg-primary",
        secondary:
          "border-secondary-foreground/20 bg-secondary/40 text-secondary-foreground before:bg-secondary-foreground/70",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive before:bg-destructive",
        success:
          "border-success/30 bg-success/10 text-success before:bg-success",
        warning:
          "border-warning/30 bg-warning/10 text-warning before:bg-warning",
        info:
          "border-info/30 bg-info/10 text-info before:bg-info",
        outline: "border-border bg-transparent text-foreground before:bg-muted-foreground/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
