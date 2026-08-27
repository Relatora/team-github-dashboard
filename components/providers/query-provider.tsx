"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  // Created in state, not at module scope. A module-level client would be
  // shared between requests on the server and leak one user's cached data into
  // another's render.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The data changes only when a scan runs, so refetching on every
            // window focus is pure noise against a dashboard people leave open.
            refetchOnWindowFocus: false,
            staleTime: 60_000,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
