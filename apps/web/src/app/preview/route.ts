import { NextResponse, type NextRequest } from 'next/server';

/** Sets (or clears) the draft-preview cookie and returns to the homepage. */
export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const res = NextResponse.redirect(new URL(req.nextUrl.searchParams.get('to') ?? '/', req.url));
  if (token && /^[A-Za-z0-9_-]{10,64}$/.test(token)) res.cookies.set('sos_preview', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 });
  else res.cookies.delete('sos_preview');
  return res;
}
