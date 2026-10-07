# shadcn/ui Skill

## Project Configuration

```json
{
  "style": "new-york",
  "base": "radix",
  "rsc": false,
  "typescript": true,
  "tailwindVersion": "v3",
  "tailwindConfig": "tailwind.config.js",
  "tailwindCss": "src/index.css",
  "importAlias": "@",
  "iconLibrary": "lucide"
}
```

## Resolved Paths

- **Utils**: `src/lib/utils.ts` — `cn()` function for merging Tailwind classes
- **Components**: `src/components/ui/` — shadcn/ui component files
- **Lib**: `src/lib/` — utility functions
- **Hooks**: `src/hooks/` — custom React hooks

## Installed Components

badge, button, card, dialog, dropdown-menu, input, progress, scroll-area, select, separator, table, tabs, tooltip

## Component Usage

### Button
```tsx
import { Button } from "@/components/ui/button"

<Button variant="default">Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>
```

### Card
```tsx
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card Description</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card Content</p>
  </CardContent>
  <CardFooter>
    <p>Card Footer</p>
  </CardFooter>
</Card>
```

### Input
```tsx
import { Input } from "@/components/ui/input"

<Input type="email" placeholder="Email" />
<Input disabled placeholder="Disabled" />
```

### Select
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select an option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

### Table
```tsx
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

<Table>
  <TableCaption>A list of items</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Value</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Item 1</TableCell>
      <TableCell>Value 1</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

### Tabs
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

### Badge
```tsx
import { Badge } from "@/components/ui/badge"

<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="outline">Outline</Badge>
```

### Dialog
```tsx
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    <div>Content</div>
    <DialogFooter>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Separator
```tsx
import { Separator } from "@/components/ui/separator"

<Separator />
<Separator orientation="vertical" />
```

### Tooltip
```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

<TooltipProvider>
  <Tooltip>
    <TooltipTrigger>Hover me</TooltipTrigger>
    <TooltipContent>Tooltip content</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

## Theming

Colors are defined as CSS variables in `src/index.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 20 14% 4%;
  --primary: 24.6 95% 53.1%;        /* Orange */
  --primary-foreground: 60 9.1% 97.8%;
  --secondary: 60 4.8% 95.9%;
  --muted: 60 4.8% 95.9%;
  --muted-foreground: 25 5.3% 44.7%;
  --border: 20 5.9% 90%;
  --radius: 0.5rem;
}
```

Use `hsl(var(--primary))` in Tailwind classes to reference these variables.

## Tailwind Classes

- `bg-background` / `text-foreground` — page background/text
- `bg-card` / `text-card-foreground` — card background/text
- `bg-primary` / `text-primary-foreground` — primary action color
- `bg-muted` / `text-muted-foreground` — muted/secondary content
- `border-border` — border color
- `bg-destructive` / `text-destructive-foreground` — error/danger color

## Layout Patterns

### Page Layout
```tsx
<div className="space-y-6 p-6">
  {/* Page content */}
</div>
```

### Grid Layout
```tsx
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
  {/* Grid items */}
</div>
```

### Sidebar + Content
```tsx
<div className="flex h-screen overflow-hidden">
  <aside className="w-60 shrink-0 border-r">
    {/* Sidebar */}
  </aside>
  <main className="flex-1 overflow-auto">
    {/* Content */}
  </main>
</div>
```

## CLI Commands

```bash
# Initialize shadcn/ui
npx shadcn@latest init

# Add a component
npx shadcn@latest add button

# Add multiple components
npx shadcn@latest add button card input

# View component source
npx shadcn@latest view button

# Search components
npx shadcn@latest search "date picker"
```

## Registry

Components can be installed from the shadcn/ui registry:

```bash
npx shadcn@latest add "https://ui.shadcn.com/r/styles/new-york/button.json"
```

## Best Practices

1. **Use semantic color tokens** — `bg-primary` not `bg-orange-500`
2. **Compose components** — Use `Card` + `CardContent` + `Button` together
3. **Use `asChild`** — For custom trigger elements: `<DialogTrigger asChild>`
4. **Use `cn()` for conditional classes** — `cn("base-class", condition && "active-class")`
5. **Prefer shadcn/ui over raw HTML** — Use `Button` over `<button>`, `Input` over `<input>`
6. **Use consistent spacing** — `space-y-6` for page, `gap-4` for grids
7. **Use Badge for status** — `<Badge variant={status === "ok" ? "default" : "destructive"}>`
