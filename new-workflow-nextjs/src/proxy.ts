import { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'wf_session';
export const SESSION_SECRET = 'wf-session-secret-2025';

const PUBLIC_PATHS = ['/api/auth-web', '/api/listener', '/api/stream'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always pass through public paths and static assets
  if (isPublicPath(pathname)) return NextResponse.next();

  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  const isValid = sessionCookie ? await verifySessionToken(sessionCookie) : false;

  if (isValid) return NextResponse.next();

  // API routes → 401 JSON (client will show login popup)
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized', code: 'SESSION_EXPIRED' }, { status: 401 });
  }

  // Page routes → pass through (Dashboard handles showing login popup)
  return NextResponse.next();
}

async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const expected = await computeToken(SESSION_SECRET);
    return token === expected;
  } catch {
    return false;
  }
}

export async function computeToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('wf-auth-v1'));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
