import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Convert file to base64 Data URL
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';
    const base64Url = `data:${mimeType};base64,${base64Data}`;

    // Insert new pending record into database, storing the base64Url in original_path
    const dbResult = await query(
      `INSERT INTO image_history (filename, original_path, prompt, status) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [file.name, base64Url, '', 'pending']
    );

    const record = dbResult.rows[0];
    return NextResponse.json({ record });
  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
