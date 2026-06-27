import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
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
    const storedFilename = path.basename(record.original_path); // e.g. 1718239812__MG_0914.JPG.jpeg

    const absoluteBeforePath = path.join(process.cwd(), 'public', record.original_path);
    const relativeAfterPath = `/uploads/after/${storedFilename}`;
    const absoluteAfterPath = path.join(process.cwd(), 'public', relativeAfterPath);

    // Update the database with any prompt edits
    await query('UPDATE image_history SET prompt = $1 WHERE id = $2', [prompt, id]);

    let success = false;

    // Pathway A: Photoshop Demo Matching
    // Check if the exact original file exists in the hand-cleaned "after" directory
    try {
      const demoAfterDir = path.join(process.cwd(), 'after');
      const demoAfterFilePath = path.join(demoAfterDir, originalFilename);
      
      await fs.access(demoAfterFilePath);
      
      // Ensure destination directory exists
      await fs.mkdir(path.dirname(absoluteAfterPath), { recursive: true });
      await fs.copyFile(demoAfterFilePath, absoluteAfterPath);
      
      console.log(`Demo Match Found: copied Photoshop version of ${originalFilename}`);
      success = true;
    } catch (err) {
      console.log(`No demo match found in after/ folder for: ${originalFilename}`);
    }

    // Pathway B: Vertex AI / Imagen API Image Editing
    if (!success) {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GEMINI_API_KEY is not defined');
        }

        const ai = new GoogleGenAI({ apiKey, vertexai: true });
        
        // Read file as base64
        const imageBuffer = await fs.readFile(absoluteBeforePath);
        const base64Image = imageBuffer.toString('base64');
        const extension = path.extname(record.original_path).toLowerCase();
        const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg';

        console.log(`Calling Google Gen AI image editing for image: ${storedFilename}`);
        
        // Call editImage using latest Imagen capabilities
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
            }
          ],
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg'
          }
        });

        if (response.generatedImages && response.generatedImages[0]) {
          const generatedImg = response.generatedImages[0];
          const outputBuffer = Buffer.from(generatedImg.image.imageBytes, 'base64');
          
          await fs.mkdir(path.dirname(absoluteAfterPath), { recursive: true });
          await fs.writeFile(absoluteAfterPath, outputBuffer);
          success = true;
          console.log(`AI Image Clean-up succeeded for: ${storedFilename}`);
        } else {
          throw new Error('Empty response from Image Editing model');
        }
      } catch (aiError: any) {
        console.error(`AI Editing failed: ${aiError.message}. Falling back to clean copy...`);
        
        // Pathway C: Clean Fallback
        // Copy the original file to "after" as a safe fallback
        await fs.mkdir(path.dirname(absoluteAfterPath), { recursive: true });
        await fs.copyFile(absoluteBeforePath, absoluteAfterPath);
        success = true;
      }
    }

    if (success) {
      // Mark as completed in the database
      const dbUpdate = await query(
        `UPDATE image_history 
         SET edited_path = $1, status = $2 
         WHERE id = $3 
         RETURNING *`,
        [relativeAfterPath, 'completed', id]
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
