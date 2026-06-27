import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Missing image ID' }, { status: 400 });
    }

    // Get the record from DB
    const dbResult = await query('SELECT * FROM image_history WHERE id = $1', [id]);
    if (dbResult.rows.length === 0) {
      return NextResponse.json({ error: 'Image not found in database' }, { status: 404 });
    }

    const record = dbResult.rows[0];

    // Extract base64 and mimeType directly from the database string (data URL)
    const originalUrl = record.original_path;
    const mimeType = originalUrl.split(';base64,')[0].split('data:').pop() || 'image/jpeg';
    const base64Image = originalUrl.split(';base64,').pop() || '';

    // Initialize Google Gen AI
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey, vertexai: true });

    const instruction = `You are a professional jewelry retouching assistant. Your job is to output a clean, direct editing instruction for an image editing model (Imagen) to remove scratches and dust from this ring.
    
    Look at the image and identify:
    - The metal type and color (e.g. yellow gold, white gold, rose gold, silver, platinum).
    - The gemstone type, shape and cut (e.g. marquise diamond, emerald-cut diamond, round diamond, oval diamond, or "no gemstone" if there is none).
    - Whether a hand/skin is present.
    
    Output the instruction prompt exactly following this template, replacing the bracketed items:
    
    "Remove all scratches, micro-dust, scuffs, and blemishes from the [metal_type] metal surfaces of the ring. Polish the metal to make it completely smooth and clean. Do not change the original shape of the ring, the [metal_type] color, the [gemstone_type], or the background. Keep everything else exactly identical to the original image."
    
    If a hand/skin is present, append this sentence to the prompt:
    "Preserve the natural skin texture and fingernails exactly as they are."
    
    Return ONLY the final filled instruction text. Do not include any introductory or concluding remarks, or markdown formatting (like \`\`\`). Start the response directly with "Remove all..."`;

    console.log(`Analyzing image ID: ${id} with Gemini...`);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Image
          }
        },
        instruction
      ]
    });

    const generatedPrompt = response.text || '';
    if (!generatedPrompt) {
      throw new Error('Gemini failed to return a generated prompt');
    }

    // Update database with prompt and status 'analyzed'
    const updateResult = await query(
      `UPDATE image_history 
       SET prompt = $1, status = $2 
       WHERE id = $3 
       RETURNING *`,
      [generatedPrompt.trim(), 'analyzed', id]
    );

    const updatedRecord = updateResult.rows[0];
    return NextResponse.json({ record: updatedRecord });
  } catch (error: any) {
    console.error('Analyze API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
