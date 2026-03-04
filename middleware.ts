import { NextRequest, NextResponse } from "next/server";

const COOKIE = "ct_admin";

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Only protect /admin/*
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // Already authed?
  const hasCookie = req.cookies.get(COOKIE)?.value === "1";
  if (hasCookie) return NextResponse.next();

  // Magic ?key=ADMIN_SECRET sets cookie then redirects (removes the key from URL)
  const key = searchParams.get("key");
  const secret = process.env.ADMIN_SECRET;

  if (key && secret && key === secret) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("key");

    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }

  // Not authed -> send to home
  const home = req.nextUrl.clone();
  home.pathname = "/";
  home.search = "";
  return NextResponse.redirect(home);
}

export const config = {
  matcher: ["/admin/:path*"],
};