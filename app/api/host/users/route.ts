// app/api/host/users/route.ts — Host-only: create and list users

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/session';
import { createUser, listUsers, deleteUser } from '@/lib/redis';
import { sanitizeString, isValidUserId, isValidPassword, isValidLanguage, isValidGender } from '@/lib/validation';
import type { AppUser, Gender } from '@/types';

// GET /api/host/users — list all users
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const users = await listUsers();
    // Never expose password hashes to client
    const safeUsers = users.map(({ passwordHash: _, ...u }) => u);
    return NextResponse.json({ success: true, data: safeUsers });
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/host/users — create a new user
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const userId = sanitizeString(body.userId);
    const password = sanitizeString(body.password, 128);
    const gender = sanitizeString(body.gender).toUpperCase();
    const language = sanitizeString(body.language).toUpperCase();

    if (!isValidUserId(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid user ID (3-32 alphanumeric chars)' }, { status: 400 });
    }
    if (!isValidPassword(password)) {
      return NextResponse.json({ success: false, error: 'Password must be 6-128 characters' }, { status: 400 });
    }
    if (!isValidGender(gender)) {
      return NextResponse.json({ success: false, error: 'Gender must be MALE or FEMALE' }, { status: 400 });
    }
    if (!isValidLanguage(language)) {
      return NextResponse.json({ success: false, error: 'Language must be 2-5 uppercase letters (e.g. EN, HI)' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user: AppUser = {
      userId,
      passwordHash,
      gender: gender as Gender,
      language,
      createdAt: new Date().toISOString(),
    };

    await createUser(user);

    return NextResponse.json({ success: true, data: { userId, gender, language } }, { status: 201 });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/host/users?userId=xxx
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId || !isValidUserId(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid user ID' }, { status: 400 });
    }

    await deleteUser(userId);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
