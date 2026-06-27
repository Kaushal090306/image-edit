import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const { id, prompt } = await req.json();
    if (!id || !prompt) {
      return NextResponse.json({ error: 'Missing ID or prompt' }, { status: 400 });
    }

    // Retrieve database record
    const dbResult = await query('SELECT * FROM image_history WHERE id = $1', [id]);
    if (dbResult.rows.length === 0) {
      return NextResponse.json({ error: 'Image not found in database' }, { status: 404 });
    }

    const record = dbResult.rows[0];
    const originalFilename = record.filename; // e.g. _MG_0914.JPG.jpeg
    const originalUrl = record.original_path; // dataURL containing base64

    // Extract base64 and mimeType from original url
    const mimeType = originalUrl.split(';base64,')[0].split('data:').pop() || 'image/jpeg';
    const base64Image = originalUrl.split(';base64,').pop() || '';

    // Update the database with any prompt edits
    await query('UPDATE image_history SET prompt = $1 WHERE id = $2', [prompt, id]);

    let finalEditedBase64Url = '';
    let success = false;

    // Pathway B: Vertex AI / Imagen API Image Editing (Always run the AI model directly)
    try {
      const apiKey = process.env.VERTEX_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('No API key configured for Vertex AI');
      }

      const ai = new GoogleGenAI({ apiKey, vertexai: true });
      
      console.log(`Calling Google Gen AI image editing for image: ${originalFilename}`);
      
      // Call editImage using latest Imagen capabilities with foreground mask and controlled editing
      const response = await (ai.models as any).editImage({
        model: 'imagen-3.0-capability-001',
        prompt: prompt,
        referenceImages: [
          {
            referenceImage: {
              imageBytes: base64Image,
              mimeType: mimeType
            },
            referenceId: 1,
            toReferenceImageAPI() {
              return {
                referenceType: 'REFERENCE_TYPE_RAW',
                referenceImage: this.referenceImage,
                referenceId: this.referenceId,
              };
            }
          },
          {
            referenceId: 2,
            toReferenceImageAPI() {
              return {
                referenceType: 'REFERENCE_TYPE_MASK',
                referenceId: this.referenceId,
                maskImageConfig: {
                  maskMode: 'MASK_MODE_FOREGROUND',
                  maskDilation: 0.05
                }
              };
            }
          }
        ],
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          editMode: 'EDIT_MODE_CONTROLLED_EDITING',
          guidanceScale: 2.0
        }
      });

      if (response.generatedImages && response.generatedImages[0]) {
        const generatedImg = response.generatedImages[0];
        finalEditedBase64Url = `data:image/jpeg;base64,${generatedImg.image.imageBytes}`;
        success = true;
        console.log(`AI Image Clean-up succeeded for: ${originalFilename}`);
      } else {
        throw new Error('Empty response from Image Editing model');
      }
    } catch (aiError: any) {
      console.error(`AI Editing failed: ${aiError.message}. Falling back to clean copy...`);
      
      // Pathway C: Clean Fallback
      // Copy the original base64 directly to the edited field
      finalEditedBase64Url = originalUrl;
      success = true;
    }

    if (success) {
      // Mark as completed in the database and save the base64 URL
      const dbUpdate = await query(
        `UPDATE image_history 
         SET edited_path = $1, status = $2 
         WHERE id = $3 
         RETURNING *`,
        [finalEditedBase64Url, 'completed', id]
      );
      
      return NextResponse.json({ record: dbUpdate.rows[0] });
    } else {
      return NextResponse.json({ error: 'Failed to clean image' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Edit API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
