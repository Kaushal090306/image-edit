import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Ensure upload directories exist
    const beforeDir = path.join(process.cwd(), 'public', 'uploads', 'before');
    const afterDir = path.join(process.cwd(), 'public', 'uploads', 'after');
    await fs.mkdir(beforeDir, { recursive: true });
    await fs.mkdir(afterDir, { recursive: true });

    // Generate unique file name
    const timestamp = Date.now();
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFilename = `${timestamp}_${cleanName}`;
    
    const filePath = path.join(beforeDir, uniqueFilename);
    await fs.writeFile(filePath, buffer);

    const originalPath = `/uploads/before/${uniqueFilename}`;

    // Insert new pending record into Postgres database
    const dbResult = await query(
      `INSERT INTO image_history (filename, original_path, prompt, status) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [file.name, originalPath, '', 'pending']
    );

    const record = dbResult.rows[0];
    return NextResponse.json({ record });
  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
