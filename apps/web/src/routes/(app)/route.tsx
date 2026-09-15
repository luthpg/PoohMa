import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/components/AuthProvider";
import { HoneyPotLoader } from "@/components/HoneyPotLoader";
import { useAccount } from "@/hooks/useAccount";

const Loader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <HoneyPotLoader size="lg" animationDurationSeconds={1.5} />
  </div>
);

export const Route = createFileRoute("/(app)")({
  pendingMs: 0,
  pendingMinMs: 300,
  pendingComponent: Loader,
  component: RouteComponent,
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { activeAccount, isLoading: isAccountLoading } = useAccount();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hasRedirectedRef = useRef(false);

  // 未認証確定時はログイン画面へリダイレクト
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      navigate({
        to: "/login",
        search: { redirect: location.href },
        replace: true,
      });
    }
    if (isAuthenticated) {
      hasRedirectedRef.current = false;
    }
  }, [isAuthLoading, isAuthenticated, navigate, location.href]);

  const currentAccount = activeAccount || user;

  useEffect(() => {
    if (
      !isAccountLoading &&
      activeAccount &&
      !activeAccount.familyId &&
      pathname !== "/family"
    ) {
      navigate({ to: "/family", replace: true });
    }
  }, [activeAccount, isAccountLoading, pathname, navigate]);

  // 認証初期化・復元中、および未認証時（ログイン画面へのリダイレクト遷移中）はローディング表示
  if (isAuthLoading || !isAuthenticated) {
    return <Loader />;
  }

  return (
    <>
      {currentAccount?.familyId && <AppHeader user={currentAccount} />}
      <main className="flex-1">
        <Outlet />
      </main>
    </>
  );
}
