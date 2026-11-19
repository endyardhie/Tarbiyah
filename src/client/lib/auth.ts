import { useMutation, useQuery } from "@tanstack/react-query";
import type { Permission } from "../../shared/permissions";
import type { Me } from "../../shared/types";
import { ApiError, api, queryClient } from "./api";
import { disablePush } from "./push";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Hanya untuk menampilkan/menyembunyikan menu; server tetap memeriksa can(). */
export function hasPermission(me: Me | null | undefined, permission: Permission) {
  return !!me && (me.isAdmin || me.permissions.includes(permission));
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await disablePush();
      await api("/auth/logout", { method: "POST" });
    },
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
    },
  });
}
