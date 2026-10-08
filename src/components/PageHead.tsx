import type { ReactNode } from "react";

interface PageHeadProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="mb-4 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12.5px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
