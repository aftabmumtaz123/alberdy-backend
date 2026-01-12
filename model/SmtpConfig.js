const mongoose = require('mongoose');

const smtpConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'SMTP Name is required'],
    trim: true
  },
  host: {
    type: String,
    required: [true, 'SMTP Host is required'],
    trim: true
  },
  port: {
    type: Number,
    required: [true, 'Port is required'],
    min: 1,
    max: 65535
  },
  encryption: {
    type: String,
    enum: ['NONE', 'STARTTLS', 'SSL/TLS'],
    default: 'NONE',
    required: [true, 'Encryption is required']
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password/API Key is required']
  },
  fromEmail: {
    type: String,
    required: [true, 'From Email is required'],
    trim: true
  },
  fromName: {
    type: String,
    required: [true, 'From Name is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SmtpConfig', smtpConfigSchema);