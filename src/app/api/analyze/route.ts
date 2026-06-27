import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
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

    const ai = new GoogleGenAI({ apiKey });

    const instruction = `You are a professional jewelry photography expert. Look at the attached image and write a highly detailed, 1-2 sentence description of the subject, background, lighting, and materials (e.g. metal type, gemstone shape, and background setting). Use this description to fill in the [Scene Description] placeholder.
    
    CRITICAL DECISION RULE:
    Inspect the image to see if a hand, finger, or skin is present.
    - If a hand/finger/skin IS present in the image: Output the prompt using the "HAND TEMPLATE" below.
    - If NO hand/finger/skin is present in the image (e.g. it is just the ring on a table, box, flat surface, or standalone studio shot): Omit skin/finger/nail/hair guidelines entirely and output using the "STANDALONE TEMPLATE" below.
    
    Return ONLY the final filled prompt. Do not include any introductory or concluding text, or markdown codeblocks (like \`\`\`). Output should start directly with the filled scene description.
    
    HAND TEMPLATE:
    "[Scene Description]
    Imperative Instruction for Advanced Post-Processing: Flawless Execution.
    Comprehensive Imperfection Removal: Perform an advanced, localized, and context-aware purge of all micro-imperfections. This includes all trace of fine dust particles, microscopic surface scratches and scuffs on the gold metal, all fine hairs and peach fuzz on the fingers and knuckles, skin blemishes, small fibers, and all environmental noise.
    
    Strict Preservation Mandate (Non-Destructive Retouching): All core elements of the scene must remain absolutely identical and unaltered in their original form.
    
    Ring: The metal finish (the exact gold color, whether polished or brushed texture), the complex facet cut, clarity, and brilliancy of the diamond, and the ring’s geometry, size, and shape.
    
    Hand and Skin: The natural skin tone, knuckle lines, fingerprint patterns, primary skin texture, hand pose, and fingernail appearance (including any nail polish color).
    
    Clothing & Objects: The texture and form of the ribbed fabric (sweater, etc.) and background objects.
    
    Lighting and Reflections: The specific direction, softness, and color temperature of the studio lighting. Critically, all complex and unique reflections on the metal and stone surfaces must be preserved with 100% fidelity, just with the micro-noise removed.
    
    Final Output Goal: The resulting image must look exactly like the original in composition and feel, but in a state of impossible, pristine cleanliness, featuring flawless metal surfaces and a model-perfect hand. All noise, dust, and surface damage are removed."
    
    STANDALONE TEMPLATE:
    "[Scene Description]
    Imperative Instruction for Advanced Post-Processing: Flawless Execution.
    Comprehensive Imperfection Removal: Perform an advanced, localized, and context-aware purge of all micro-imperfections. This includes all trace of fine dust particles, microscopic surface scratches and scuffs on the gold metal, small fibers, and all environmental noise.
    
    Strict Preservation Mandate (Non-Destructive Retouching): All core elements of the scene must remain absolutely identical and unaltered in their original form.
    
    Ring: The metal finish (the exact gold color, whether polished or brushed texture), the complex facet cut, clarity, and brilliancy of the diamond, and the ring’s geometry, size, and shape.
    
    Clothing & Objects: The texture and form of the background surface, props, boxes, or fabrics.
    
    Lighting and Reflections: The specific direction, softness, and color temperature of the studio lighting. Critically, all complex and unique reflections on the metal and stone surfaces must be preserved with 100% fidelity, just with the micro-noise removed.
    
    Final Output Goal: The resulting image must look exactly like the original in composition and feel, but in a state of impossible, pristine cleanliness, featuring flawless metal surfaces. All noise, dust, and surface damage are removed."`;

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
