// routes/emailTemplates.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const EmailTemplate = require('../model/EmailTemplate');
const authMiddleware = require('../middleware/auth');

// Inline requireRole
const requireRole = roles => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, msg: 'Access denied' });
  }
  next();
};

// CREATE Email Template
router.post('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { name, type, fromName, fromEmail, replyTo, subject, content, status = 'active' } = req.body;

    // Validation
    if (!name || !type || !fromName || !fromEmail || !subject || !content) {
      return res.status(400).json({ success: false, msg: 'Required fields missing' });
    }

    const template = new EmailTemplate({
      name,
      type,
      fromName,
      fromEmail,
      replyTo,
      subject,
      content,
      status
    });

    await template.save();

    res.status(201).json({
      success: true,
      data: template,
      msg: 'Email Template created successfully'
    });
  } catch (err) {
    console.error('Email Template creation error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, msg: 'Duplicate Template name' });
    }
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// GET ALL Email Templates
router.get('/', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;
    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;

    const templates = await EmailTemplate.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await EmailTemplate.countDocuments(query);

    res.json({
      success: true,
      data: templates,
      pagination: { current: +page, pages: Math.ceil(total / limit), total }
    });
  } catch (err) {
    console.error('Email Templates fetch error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// GET ONE Email Template
router.get('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, msg: 'Email Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (err) {
    console.error('Email Template fetch error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

// UPDATE Email Template
router.put('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const updateData = req.body;
    const template = await EmailTemplate.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({ success: false, msg: 'Email Template not found' });
    }

    res.json({ success: true, data: template, msg: 'Email Template updated successfully' });
  } catch (err) {
    console.error('Email Template update error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});



router.delete('/:id', authMiddleware, requireRole(['Super Admin', 'Manager']), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, msg: 'Invalid ID' });
    }

    const template = await EmailTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, msg: 'Email Template not found' });
    }

    res.json({ success: true, msg: 'Email Template deleted successfully' });
  } catch (err) {
    console.error('Email Template delete error:', err);
    res.status(500).json({ success: false, msg: 'Server error', details: err.message });
  }
});

module.exports = router;