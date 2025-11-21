// config/multer.js
require('dotenv').config();
const multer = require('multer');
const path = require('path');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const originalExt = path.extname(file.originalname).toLowerCase();
    const cleanName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const public_id = `${Date.now()}-${cleanName}`;

    const base = {
      folder: 'Uploads',
      public_id,
      resource_type: isImage ? 'image' : 'raw',
    };

    if (isImage) {
      return {
        ...base,
        format: 'webp',
        transformation: [
          { quality: 'auto:best' },
          { fetch_format: 'webp' },
          { width: 2000, height: 2000, crop: 'limit' },
        ],
      };
    }

    // PDF or other docs
    return {
      ...base,
      format: originalExt.slice(1) || 'pdf',
    };
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/heic', 'image/heif', 'image/tiff', 'image/bmp',
    'application/pdf',
  ];

  const ext = path.extname(file.originalname).toLowerCase();
  const isJfif = ext === '.jfif' && file.mimetype === 'application/octet-stream';

  if (allowed.includes(file.mimetype) || isJfif) {
    if (isJfif) file.mimetype = 'image/jpeg';
    cb(null, true);
  } else {
    cb(new Error('Only images and PDFs allowed'), false);
  }
};

// Two separate instances → no field name conflict!
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

module.exports = {
  uploadCreate: upload,           // CREATE: field name = 'attachments'
  uploadUpdate: upload,           // UPDATE: field name = 'files'
};