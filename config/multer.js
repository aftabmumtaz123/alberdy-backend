require('dotenv').config();
const multer = require('multer');
const path = require('path');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'Uploads',
    allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'jfif', 'webp', 'bmp', 'tiff', 'ico'],
    transformation: [
      {
        fetch_format: 'webp',  // Automatically convert to WebP
        quality: 'auto',       // Let Cloudinary choose optimal compression
      },
    ],
    public_id: (req, file) => {
      const cleanName = path
        .parse(file.originalname)
        .name.replace(/[^a-zA-Z0-9_-]/g, "_");
      return `${Date.now()}-${cleanName}`;
    },
  },
});


const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg', // Covers .jpeg, .jpg, .jfif
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff', // Covers .tiff, .tif
    'image/x-icon'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpeg', '.jpg', '.png', '.gif', '.jfif', '.webp', '.bmp', '.tiff', '.tif', '.ico'];

  // Debug logging
  console.log('File mimetype:', file.mimetype);
  console.log('File extension:', ext);

  // Fix for .jfif: Accept 'application/octet-stream' if extension is .jfif
  let isValidMime = allowedMimes.includes(file.mimetype);
  if (ext === '.jfif' && file.mimetype === 'application/octet-stream') {
    isValidMime = true; // Override for JFIF files
  }

  if (isValidMime && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    const error = new Error('Only image files (JPEG, JPG, PNG, GIF, JFIF, WEBP, BMP, TIFF, ICO) are allowed');
    error.mimetype = file.mimetype;
    error.extension = ext;
    cb(error, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;