import { NavLink } from "react-router-dom";
import { homeNavItem, navSections } from "@/app/routes";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

interface RailButtonProps {
  to: string;
  label: string;
  icon: typeof homeNavItem.icon;
}

function RailButton({ to, label, icon: Icon }: RailButtonProps) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        cn(
          "relative grid size-10 place-items-center rounded-[10px] text-muted-foreground transition-colors",
          "hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "bg-primary/10 text-primary",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
          ) : null}
          <Icon size={19} />
        </>
      )}
    </NavLink>
  );
}

export function AppIconRail() {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--hair)] bg-surface-rail py-2">
      <div className="mb-2 grid size-9 place-items-center rounded-[10px] bg-primary text-[15px] font-bold text-surface-rail">
        谋
      </div>
      <RailButton to={homeNavItem.path} label={homeNavItem.label} icon={homeNavItem.icon} />
      {navSections.map((section) => (
        <div key={section.label} className="contents">
          <span className="my-1 text-[9px] tracking-[0.14em] text-muted-foreground/50">
            {section.label.slice(0, 2)}
          </span>
          {section.items.map((item) => (
            <RailButton key={item.path} to={item.path} label={item.label} icon={item.icon} />
          ))}
        </div>
      ))}
      <div className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
