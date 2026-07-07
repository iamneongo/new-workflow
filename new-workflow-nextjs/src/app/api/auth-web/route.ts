import { NextRequest, NextResponse } from 'next/server';
import { computeToken, SESSION_COOKIE, SESSION_SECRET } from '@/proxy';

const USERNAME = 'admin';
const PASSWORD = 'wf@2025!';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function GET() {
  // Used by Dashboard to check if session is valid (proxy already validated, so if we reach here it's valid)
  return NextResponse.json({ authenticated: true });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, username, password } = body;

  if (action === 'login') {
    if (username === USERNAME && password === PASSWORD) {
      const token = await computeToken(SESSION_SECRET);
      const res = NextResponse.json({ success: true });
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });
      return res;
    }
    return NextResponse.json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' }, { status: 401 });
  }

  if (action === 'logout') {
    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' });
    return res;
  }

  return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
}
