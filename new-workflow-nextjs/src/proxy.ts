import { NextRequest, NextResponse } from 'next/server';

const USERNAME = 'admin';
const PASSWORD = 'wf@2025!';

export function proxy(req: NextRequest) {
  // Skip auth for internal API routes called by the bot
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/listener') || pathname.startsWith('/api/stream')) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const base64 = authHeader.replace('Basic ', '');
    const decoded = atob(base64);
    const [user, pass] = decoded.split(':');
    if (user === USERNAME && pass === PASSWORD) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Workflow"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
