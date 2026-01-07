require('dotenv').config();
const multer = require('multer');
const path = require('path');
const { CloudinaryStorage } = require('@fluidjs/multer-cloudinary'); // Modern package for Cloudinary v2
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const isPDF = file.mimetype === 'application/pdf';

    // Clean filename: remove special characters, keep only alphanumeric, underscore, hyphen
    const originalName = path.parse(file.originalname).name;
    const cleanName = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = Date.now();
    const uniqueName = `${timestamp}-${cleanName}`;

    // Base configuration
    const baseConfig = {
      folder: 'Uploads',
      public_id: uniqueName,
    };

    if (isImage) {
      return {
        ...baseConfig,
        resource_type: 'image',
        format: 'webp', // Deliver as WebP
        // Optional: restrict allowed formats (comma-separated, no dots)
        // allowed_formats: 'jpg,jpeg,png,gif,webp,bmp,tiff,ico,heic,heif',
        transformation: [
          { quality: 'auto:best' },                  // Best quality with good compression
          { fetch_format: 'webp' },                  // Force WebP conversion
          { crop: 'limit', width: 2000, height: 2000 }, // Prevent oversized uploads
        ],
      };
    }

    if (isPDF) {
      return {
        ...baseConfig,
        resource_type: 'raw',   // Important: stores PDF without conversion
        format: 'pdf',          // Keeps the .pdf extension
      };
    }

    // Fallback for any other allowed file (though fileFilter should prevent this)
    return {
      ...baseConfig,
      resource_type: 'raw',
    };
  },
});

// Strict file type filter
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

  // Handle .jfif files sometimes misreported as octet-stream
  const ext = path.extname(file.originalname).toLowerCase();
  const isJfifHack = ext === '.jfif' && file.mimetype === 'application/octet-stream';

  if (allowedMimes.includes(file.mimetype) || isJfifHack) {
    if (isJfifHack) {
      file.mimetype = 'image/jpeg'; // Correct the mimetype
    }
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only images (JPEG, PNG, GIF, WebP, etc.) and PDFs are allowed.');
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Multer instance with limits
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max per file
    files: 10,                   // Max 10 files per request
  },
});

module.exports = upload;