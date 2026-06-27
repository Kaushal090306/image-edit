import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query(
      'SELECT * FROM image_history ORDER BY created_at DESC'
    );
    return NextResponse.json({ records: result.rows });
  } catch (error: any) {
    console.error('History GET API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
