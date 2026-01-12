const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Template Name is required'],
    trim: true,
    unique: true
  },
  type: {
    type: String,
    required: [true, 'Template Type is required'],
    enum: ['user_registration', 'order_placed', 'order_status_updated', 'payment_confirmation', 'low_stock_alert', 'other'],
    trim: true
  },
  fromName: {
    type: String,
    required: [true, 'From Name is required'],
    trim: true
  },
  fromEmail: {
    type: String,
    required: [true, 'From Email is required'],
    trim: true
  },
  replyTo: {
    type: String,
    trim: true
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true
  },
  content: {
    type: String,
    required: [true, 'Content is required']
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);