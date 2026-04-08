import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function copySupabaseCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", "/admin");
    const redirectRes = NextResponse.redirect(url);
    copySupabaseCookies(supabaseResponse, redirectRes);
    return redirectRes;
  }

  if (pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      const nextPath = `${pathname}${request.nextUrl.search}`;
      url.searchParams.set("next", nextPath);
      const redirectRes = NextResponse.redirect(url);
      copySupabaseCookies(supabaseResponse, redirectRes);
      return redirectRes;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
