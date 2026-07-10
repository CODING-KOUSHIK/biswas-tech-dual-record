// app/api/auth/login/route.ts — User authentication endpoint

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSession } from '@/lib/session';
import { getUser, getLockedDevice, setLockedDevice, checkRateLimit } from '@/lib/redis';
import { sanitizeString, isValidUserId, isValidPassword, isValidDeviceId, getClientIp } from '@/lib/validation';
import type { Gender } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const userId = sanitizeString(body.userId);
    // Don't sanitize password — we need it exactly as entered (just length-limit it)
    const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
    const deviceId = sanitizeString(body.deviceId, 4).toUpperCase();

    // Basic input validation
    if (!userId || !password || !isValidDeviceId(deviceId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 400 }
      );
    }

    let role: 'host' | 'guest' = 'guest';
    let gender: Gender = 'MALE';
    let language = 'EN';

    // ── Host login (checked first, before Redis) ──────────────
    const hostUserId = process.env.HOST_USER_ID ?? '';
    const hostPassword = process.env.HOST_PASSWORD ?? '';

    const isHostLogin = hostUserId && userId === hostUserId;

    if (isHostLogin) {
      if (password !== hostPassword) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }
      role = 'host';
      gender = (process.env.HOST_GENDER as Gender) ?? 'MALE';
      language = process.env.HOST_LANGUAGE ?? 'EN';
    } else {
      // ── Regular user login via Redis ───────────────────────
      if (!isValidUserId(userId)) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 400 }
        );
      }

      // Rate limit: 5 attempts per minute per IP
      try {
        const ip = getClientIp(request);
        const allowed = await checkRateLimit(`login:${ip}`, 5, 60);
        if (!allowed) {
          return NextResponse.json(
            { success: false, error: 'Too many attempts. Please wait.' },
            { status: 429 }
          );
        }
      } catch (redisErr) {
        // Rate limit check failed — log but don't block login
        console.warn('Rate limit check failed:', redisErr);
      }

      const user = await getUser(userId);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatch) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      gender = user.gender;
      language = user.language;
    }

    // ── Single-device enforcement ─────────────────────────────
    try {
      const lockedDevice = await getLockedDevice(userId);
      if (lockedDevice && lockedDevice !== deviceId) {
        return NextResponse.json(
          { success: false, error: 'This account is already active on another device.' },
          { status: 409 }
        );
      }
      if (!lockedDevice) {
        await setLockedDevice(userId, deviceId);
      }
    } catch (redisErr) {
      // Device lock check failed — log but allow login
      console.warn('Device lock check failed:', redisErr);
    }

    // ── Create session ────────────────────────────────────────
    await createSession({ userId, role, gender, language, deviceId });

    return NextResponse.json({
      success: true,
      data: { userId, role, gender, language, deviceId },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
