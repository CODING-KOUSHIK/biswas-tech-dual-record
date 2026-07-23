import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const bodyText = await request.text();
    let body: { filename?: string; base64?: string; pairId?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { filename, base64, pairId } = body;
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || process.env.GOOGLE_APPS_SCRIPT_URL;
    const driveLink = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_LINK || process.env.GOOGLE_DRIVE_LINK || 'https://drive.google.com';

    if (scriptUrl) {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, base64, pairId }),
      });
      const text = await response.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        data = { status: 'ok', raw: text };
      }
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({
      success: true,
      driveUrl: driveLink,
      message: 'Google Drive fallback active.',
    });
  } catch (error) {
    console.error('[Upload API Error]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
