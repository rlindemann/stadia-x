import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Assign an anonymous per-browser session id so every action is attributable in the
// audit log even before real auth exists. When SSO lands, this becomes the user id.
// (This modified Next uses the "proxy" file convention in place of "middleware".)
export function proxy(req: NextRequest) {
  if (req.cookies.get("sx_session")) return NextResponse.next();
  const res = NextResponse.next();
  res.cookies.set("sx_session", crypto.randomUUID(), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
