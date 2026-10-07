import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CollapsibleCard(props: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}): JSX.Element {
  const Icon = props.icon;
  const canCollapse = props.collapsible ?? false;
  const [open, setOpen] = useState(props.defaultOpen ?? !canCollapse);
  return (
    <Card>
      <CardHeader className={cn("flex flex-row items-center justify-between gap-3 p-4 pb-0", open && canCollapse && "pb-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 flex-none text-primary" />
          <CardTitle className="truncate text-sm font-semibold">{props.title}</CardTitle>
        </div>
        {canCollapse && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setOpen((c) => !c)}
            title={open ? "折叠" : "展开"}
            aria-label={`${open ? "折叠" : "展开"}${props.title}`}
            aria-expanded={open}
          >
            {open ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>}
          </Button>
        )}
      </CardHeader>
      {open && <CardContent className="p-4 pt-3">{props.children}</CardContent>}
    </Card>
  );
}
