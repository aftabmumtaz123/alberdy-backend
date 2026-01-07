require('dotenv').config();
const multer = require('multer');
const path = require('path');
const  CloudinaryStorage  = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Dynamic storage configuration based on file type
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const isPDF = file.mimetype === 'application/pdf';

    // Clean filename (remove special chars, keep extension safe)
    const originalName = path.parse(file.originalname).name;
    const cleanName = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = Date.now();
    const uniqueName = `${timestamp}-${cleanName}`;

    // Base config
    const config = {
      folder: 'Uploads',
      public_id: uniqueName,
    };

    if (isImage) {
      // Only images get optimized and converted to WebP
      return {
        ...config,
        resource_type: 'image',
        format: 'webp',                    // Final delivery format
        transformation: [
          { quality: 'auto:best' },        // Optimal quality
          { fetch_format: 'webp' },        // Force WebP
          { crop: 'limit', width: 2000, height: 2000 }, // Prevent huge files
        ],
      };
    }

    if (isPDF) {
      // PDFs stay as-is, stored as raw files
      return {
        ...config,
        resource_type: 'raw',              // Critical: keeps PDF unchanged
        format: 'pdf',                     // Keeps .pdf extension
      };
    }

    // Fallback (should not happen due to fileFilter)
    return {
      ...config,
      resource_type: 'raw',
      format: path.extname(file.originalname).slice(1) || 'file',
    };
  },
});

// Strict file filter
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/x-icon',
    'image/heic',
    'image/heif',
    // Documents
    'application/pdf',
  ];

  // Special case: some browsers send .jfif as octet-stream
  const ext = path.extname(file.originalname).toLowerCase();
  const isJfifHack = ext === '.jfif' && file.mimetype === 'application/octet-stream';

  if (allowedMimes.includes(file.mimetype) || isJfifHack) {
    // Optionally force correct mimetype for jfif
    if (isJfifHack) file.mimetype = 'image/jpeg';
    cb(null, true);
  } else {
    const error = new Error(
      'Invalid file type. Only images (JPEG, PNG, GIF, WebP, etc.) and PDFs are allowed.'
    );
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 10,                  // Max 10 files per request
  },
});

module.exports = upload;