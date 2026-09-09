import { NextResponse } from 'next/server'
import { allowIp, clientIp, tooMany } from '@/lib/ip-limit'
import { extractText } from '@/lib/extract'

// CRITICAL: pdf-parse and canvas require Node.js runtime
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    // Anonymous route (the /try flow): cap uploads per IP so it cannot be used as a free OCR/PDF service.
    if (!allowIp('upload', clientIp(request), 40, 60 * 60 * 1000)) return tooMany('Too many uploads from this network. Please try again in an hour.')
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only PDFs and images (PNG, JPG, WEBP) are supported.' },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Images → send directly as vision input
    if (file.type.startsWith('image/')) {
      const base64 = buffer.toString('base64')
      return NextResponse.json({
        useVision: true,
        imageData: {
          base64,
          mimeType: file.type,
        },
      })
    }

    // PDFs → send directly as base64 document to Claude (native PDF support)
    if (file.type === 'application/pdf') {
      const base64 = buffer.toString('base64')
      return NextResponse.json({
        useVision: true,
        pdfData: {
          base64,
          mimeType: 'application/pdf',
        },
        source: 'pdf-native',
      })
    }

    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({
      error: 'Failed to process file. Please try a different file or contact support.'
    }, { status: 500 })
  }
}
