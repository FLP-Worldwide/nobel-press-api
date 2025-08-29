// src/types/principal.ts
export type UserPrincipal  = { userId: number };
export type GuestPrincipal = { sessionId: string };
export type Principal = UserPrincipal | GuestPrincipal;

export function isUser(p: Principal): p is UserPrincipal {
  return (p as any).userId !== undefined;
}
