import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      // Fetch full record details including the large base64 strings
      const result = await query(
        'SELECT * FROM image_history WHERE id = $1',
        [id]
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
      return NextResponse.json({ record: result.rows[0] });
    } else {
      // Fetch only list metadata (exclude large base64 columns for instant loading)
      const result = await query(
        'SELECT id, filename, prompt, status, created_at FROM image_history ORDER BY created_at DESC'
      );
      return NextResponse.json({ records: result.rows });
    }
  } catch (error: any) {
    console.error('History GET API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
