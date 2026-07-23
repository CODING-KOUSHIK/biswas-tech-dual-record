import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { filename, base64, pairId } = await request.json();

    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || process.env.GOOGLE_APPS_SCRIPT_URL;
    const driveLink = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_LINK || process.env.GOOGLE_DRIVE_LINK;

    if (scriptUrl) {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, base64, pairId }),
      });
      const data = await response.json().catch(() => ({ status: 'ok' }));
      return NextResponse.json({ success: true, data });
    }

    if (driveLink) {
      return NextResponse.json({ success: true, driveUrl: driveLink, message: 'Google Drive folder link active.' });
    }

    return NextResponse.json({
      success: true,
      message: 'ZIP created for upload.',
    });
  } catch (error) {
    console.error('[Upload API Error]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
