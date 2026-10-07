import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";

// React Query 客户端：App 服务端数据已由 useAppData/mutations 按 key 缓存接管（S1-2），
// 此 provider 提供缓存上下文；retry/refetchOnWindowFocus 关闭与旧 refresh() 语义对齐
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      placeholderData: (previousData: unknown) => previousData,
    },
  },
});

// 跟随 document.documentElement 的 dark class（与 ThemeToggle 的切换机制对齐）
function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const theme = useDocumentTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {children}
        {/* bottom-right 对齐原侧栏底部消息的位置直觉；主题跟随逻辑不动（S1-3） */}
        <Toaster theme={theme} position="bottom-right" />
      </HashRouter>
    </QueryClientProvider>
  );
}
